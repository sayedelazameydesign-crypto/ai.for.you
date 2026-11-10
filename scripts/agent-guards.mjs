#!/usr/bin/env node
/**
 * Proof harness for the maintenance agent's and CI workflows' safety guards.
 *
 * Safety claims are worthless if they are only comments. This harness exercises
 * each guard with adversarial inputs in isolated fixtures (never mutating the
 * live checkout) and audits the repository's GitHub Actions workflows so that
 * missing `defaults.run.shell: bash` or unsafe job/step `shell:` overrides fail
 * the build immediately.
 *
 * Usage:
 *   node scripts/agent-guards.mjs
 *   node scripts/agent-guards.mjs --workflows-dir <dir> [--json]
 */
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SELF_PATH = fileURLToPath(import.meta.url)
const REPO_ROOT = resolve(dirname(SELF_PATH), '..')
const SCRIPT = resolve(REPO_ROOT, 'scripts/maintenance-agent.mjs')
const DEFAULT_WORKFLOWS_DIR = resolve(REPO_ROOT, '.github/workflows')
const REQUIRED_WORKFLOW_FILES = [
  'ci.yml',
  'maintenance-agent.yml',
  'maintenance-report.yml',
  'groq-smoke.yml',
]
const MIN_EXCEPTION_REASON_LENGTH = 10
const META = Symbol('yamlMeta')

/* ---------- Structural GitHub Actions YAML parser & shell guard ---------- */

function countLeadingSpaces(line) {
  let i = 0
  while (i < line.length && line[i] === ' ') i++
  return i
}

function extractAllowDirective(commentLines) {
  for (let i = commentLines.length - 1; i >= 0; i--) {
    const match = /^\s*shell-guard-allow:(.*)$/i.exec(commentLines[i])
    if (match) {
      return { present: true, reason: match[1].trim() }
    }
  }
  return null
}

function splitValueAndComment(raw, lineNo, errors) {
  let inSingle = false
  let inDouble = false
  let valuePart = raw
  let commentPart = ''

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
    if (inSingle) {
      if (ch === "'" && raw[i + 1] === "'") {
        i++
        continue
      }
      if (ch === "'") inSingle = false
      continue
    }
    if (inDouble) {
      if (ch === '\\') {
        i++
        continue
      }
      if (ch === '"') inDouble = false
      continue
    }
    if (ch === "'") {
      inSingle = true
      continue
    }
    if (ch === '"') {
      inDouble = true
      continue
    }
    if (ch === '#' && (i === 0 || /\s/.test(raw[i - 1]))) {
      valuePart = raw.slice(0, i)
      commentPart = raw.slice(i + 1)
      break
    }
  }

  if (inSingle) errors.push({ code: 'unclosed_single_quote', line: lineNo, message: 'Unclosed single quote in YAML value' })
  if (inDouble) errors.push({ code: 'unclosed_double_quote', line: lineNo, message: 'Unclosed double quote in YAML value' })

  return {
    valuePart: valuePart.trim(),
    inlineAllow: commentPart ? extractAllowDirective([commentPart]) : null,
  }
}

function splitFlowTopLevel(inner, delimiter, lineNo, errors) {
  const parts = []
  let start = 0
  let depthCurly = 0
  let depthSquare = 0
  let inSingle = false
  let inDouble = false

  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]
    if (inSingle) {
      if (ch === "'" && inner[i + 1] === "'") { i++; continue }
      if (ch === "'") inSingle = false
      continue
    }
    if (inDouble) {
      if (ch === '\\') { i++; continue }
      if (ch === '"') inDouble = false
      continue
    }
    if (ch === "'") { inSingle = true; continue }
    if (ch === '"') { inDouble = true; continue }
    if (ch === '{') { depthCurly++; continue }
    if (ch === '}') { depthCurly--; continue }
    if (ch === '[') { depthSquare++; continue }
    if (ch === ']') { depthSquare--; continue }
    if (ch === delimiter && depthCurly === 0 && depthSquare === 0) {
      parts.push(inner.slice(start, i).trim())
      start = i + 1
    }
  }

  if (inSingle || inDouble || depthCurly !== 0 || depthSquare !== 0) {
    errors.push({ code: 'invalid_flow_collection', line: lineNo, message: 'Malformed flow collection in YAML' })
  }
  const tail = inner.slice(start).trim()
  if (tail.length > 0) parts.push(tail)
  return parts
}

function parseScalarOrFlow(valuePart, lineNo, errors) {
  if (valuePart === '') return null
  if (valuePart.startsWith("'") && valuePart.endsWith("'") && valuePart.length >= 2) {
    return valuePart.slice(1, -1).replace(/''/g, "'")
  }
  if (valuePart.startsWith('"') && valuePart.endsWith('"') && valuePart.length >= 2) {
    return valuePart
      .slice(1, -1)
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\')
  }
  if (valuePart.startsWith('[')) {
    if (!valuePart.endsWith(']')) {
      errors.push({ code: 'invalid_flow_collection', line: lineNo, message: 'Unclosed flow sequence' })
      return []
    }
    const inner = valuePart.slice(1, -1).trim()
    if (!inner) return []
    return splitFlowTopLevel(inner, ',', lineNo, errors).map((item) => parseScalarOrFlow(item, lineNo, errors))
  }
  if (valuePart.startsWith('{')) {
    if (!valuePart.endsWith('}')) {
      errors.push({ code: 'invalid_flow_collection', line: lineNo, message: 'Unclosed flow mapping' })
      return {}
    }
    const obj = {}
    const keyMeta = {}
    Object.defineProperty(obj, META, { value: { line: lineNo, allow: null, keyMeta }, enumerable: false })
    const inner = valuePart.slice(1, -1).trim()
    if (!inner) return obj
    for (const pair of splitFlowTopLevel(inner, ',', lineNo, errors)) {
      const parsedKey = matchMappingEntry(pair)
      if (!parsedKey) {
        errors.push({ code: 'invalid_flow_mapping_entry', line: lineNo, message: `Invalid flow entry: ${pair}` })
        continue
      }
      obj[parsedKey.key] = parseScalarOrFlow(parsedKey.rest.trim(), lineNo, errors)
      keyMeta[parsedKey.key] = { line: lineNo, allow: null }
    }
    return obj
  }
  return valuePart
}

function matchMappingEntry(trimmedLine) {
  if (!trimmedLine || trimmedLine.startsWith('{') || trimmedLine.startsWith('[')) return null
  if (trimmedLine.startsWith("'") || trimmedLine.startsWith('"')) {
    const quote = trimmedLine[0]
    let i = 1
    while (i < trimmedLine.length) {
      if (quote === '"' && trimmedLine[i] === '\\') { i += 2; continue }
      if (quote === "'" && trimmedLine[i] === "'" && trimmedLine[i + 1] === "'") { i += 2; continue }
      if (trimmedLine[i] === quote) break
      i++
    }
    if (i >= trimmedLine.length) return null
    const key = trimmedLine.slice(1, i)
    const afterQuote = trimmedLine.slice(i + 1)
    const colonMatch = /^\s*:(?:\s+(.*)|$)/.exec(afterQuote)
    if (!colonMatch) return null
    return { key, rest: colonMatch[1] ?? '' }
  }

  let inSingle = false
  let inDouble = false
  for (let i = 0; i < trimmedLine.length; i++) {
    const ch = trimmedLine[i]
    if (inSingle) {
      if (ch === "'" && trimmedLine[i + 1] === "'") { i++; continue }
      if (ch === "'") inSingle = false
      continue
    }
    if (inDouble) {
      if (ch === '\\') { i++; continue }
      if (ch === '"') inDouble = false
      continue
    }
    if (ch === "'") { inSingle = true; continue }
    if (ch === '"') { inDouble = true; continue }
    if (ch === ':' && (i === trimmedLine.length - 1 || /\s/.test(trimmedLine[i + 1]))) {
      const key = trimmedLine.slice(0, i).trim()
      if (!key) return null
      return { key, rest: trimmedLine.slice(i + 1).trimStart() }
    }
  }
  return null
}

function consumeBlockScalar(lines, startIdx, parentKeyIndent, styleChar) {
  const rawCollected = []
  let idx = startIdx

  while (idx < lines.length) {
    const line = lines[idx]
    if (line.trim() === '') {
      let lookahead = idx + 1
      while (lookahead < lines.length && lines[lookahead].trim() === '') lookahead++
      if (lookahead < lines.length && countLeadingSpaces(lines[lookahead]) > parentKeyIndent) {
        rawCollected.push(line)
        idx++
        continue
      }
      break
    }
    const indent = countLeadingSpaces(line)
    if (indent <= parentKeyIndent) break
    rawCollected.push(line)
    idx++
  }

  if (rawCollected.length === 0) {
    return { text: '', nextIdx: idx }
  }

  let contentIndent = Infinity
  for (const line of rawCollected) {
    if (line.trim() !== '') {
      contentIndent = Math.min(contentIndent, countLeadingSpaces(line))
    }
  }
  if (!Number.isFinite(contentIndent)) contentIndent = parentKeyIndent + 1

  const stripped = rawCollected.map((line) => (line.length >= contentIndent ? line.slice(contentIndent) : ''))
  if (styleChar === '>') {
    const paragraphs = []
    let current = []
    for (const line of stripped) {
      if (line.trim() === '') {
        if (current.length) {
          paragraphs.push(current.join(' '))
          current = []
        }
        paragraphs.push('')
      } else {
        current.push(line)
      }
    }
    if (current.length) paragraphs.push(current.join(' '))
    return { text: paragraphs.join('\n'), nextIdx: idx }
  }
  return { text: stripped.join('\n'), nextIdx: idx }
}

function peekNextContent(lines, startIdx, errors) {
  const comments = []
  let idx = startIdx
  while (idx < lines.length) {
    const line = lines[idx]
    const trimmed = line.trim()
    if (trimmed === '' || trimmed === '---') {
      idx++
      continue
    }
    const spaceCount = countLeadingSpaces(line)
    if (line[spaceCount] === '\t') {
      errors.push({ code: 'yaml_tab_indentation', line: idx + 1, message: 'Tabs are not permitted for YAML indentation' })
    }
    if (trimmed.startsWith('#')) {
      comments.push(trimmed.slice(1))
      idx++
      continue
    }
    return { idx, indent: spaceCount, comments }
  }
  return { idx: lines.length, indent: -1, comments }
}

function parseMappingKeyValue(lines, lineIdx, keyIndent, key, rawRest, entryAllow, errors) {
  const { valuePart, inlineAllow } = splitValueAndComment(rawRest, lineIdx + 1, errors)
  const allow = inlineAllow ?? entryAllow
  const blockScalarMatch = /^([|>])([+-]?\d*|\d*[+-]?)$/.exec(valuePart)
  if (blockScalarMatch) {
    const consumed = consumeBlockScalar(lines, lineIdx + 1, keyIndent, blockScalarMatch[1])
    return { value: consumed.text, allow, nextIdx: consumed.nextIdx }
  }
  if (valuePart === '') {
    const child = parseNode(lines, lineIdx + 1, keyIndent + 1, errors)
    return { value: child.value, allow, nextIdx: child.nextIdx }
  }
  const value = parseScalarOrFlow(valuePart, lineIdx + 1, errors)
  let nextIdx = lineIdx + 1
  if (typeof value === 'string' && !rawRest.trimStart().startsWith("'") && !rawRest.trimStart().startsWith('"')) {
    const parts = [value]
    while (nextIdx < lines.length) {
      const rawNext = lines[nextIdx]
      const trimmedNext = rawNext.trim()
      if (trimmedNext === '' || trimmedNext.startsWith('#')) break
      const nextIndent = countLeadingSpaces(rawNext)
      if (nextIndent <= keyIndent) break
      if (/^-(?:\s|$)/.test(trimmedNext) || matchMappingEntry(trimmedNext)) break
      const cont = splitValueAndComment(trimmedNext, nextIdx + 1, errors)
      if (cont.valuePart) parts.push(cont.valuePart)
      nextIdx++
    }
    return { value: parts.join(' '), allow, nextIdx }
  }
  return { value, allow, nextIdx }
}

function parseMappingEntries(lines, startIdx, mapIndent, targetObj, keyMeta, errors) {
  let idx = startIdx
  while (idx < lines.length) {
    const peek = peekNextContent(lines, idx, errors)
    if (peek.idx >= lines.length || peek.indent !== mapIndent) break
    const trimmed = lines[peek.idx].slice(peek.indent)
    if (/^-(?:\s|$)/.test(trimmed)) break

    const entry = matchMappingEntry(trimmed)
    if (!entry) {
      errors.push({ code: 'invalid_mapping_line', line: peek.idx + 1, message: `Expected mapping key at line ${peek.idx + 1}` })
      idx = peek.idx + 1
      continue
    }

    const entryAllow = extractAllowDirective(peek.comments)
    const parsed = parseMappingKeyValue(lines, peek.idx, mapIndent, entry.key, entry.rest, entryAllow, errors)
    targetObj[entry.key] = parsed.value
    keyMeta[entry.key] = { line: peek.idx + 1, allow: parsed.allow }
    idx = parsed.nextIdx
  }
  return idx
}

function parseSequence(lines, startIdx, seqIndent, errors) {
  const arr = []
  let idx = startIdx

  while (idx < lines.length) {
    const peek = peekNextContent(lines, idx, errors)
    if (peek.idx >= lines.length || peek.indent !== seqIndent) break
    const afterIndent = lines[peek.idx].slice(peek.indent)
    const dashMatch = /^-(?:(\s+)(.*))?$/.exec(afterIndent)
    if (!dashMatch) break

    const itemAllow = extractAllowDirective(peek.comments)
    const spacesAfterDash = dashMatch[1] ? dashMatch[1].length : 1
    const afterDash = dashMatch[2] ?? ''

    if (afterDash.trim() === '') {
      const child = parseNode(lines, peek.idx + 1, seqIndent + 1, errors)
      if (child.value && typeof child.value === 'object' && !Array.isArray(child.value) && child.value[META]) {
        child.value[META].allow = child.value[META].allow ?? itemAllow
      }
      arr.push(child.value)
      idx = child.nextIdx
      continue
    }

    const inlineMapEntry = matchMappingEntry(afterDash)
    if (inlineMapEntry) {
      const itemMapIndent = seqIndent + 1 + spacesAfterDash
      const obj = {}
      const keyMeta = {}
      Object.defineProperty(obj, META, {
        value: { line: peek.idx + 1, allow: itemAllow, keyMeta },
        enumerable: false,
      })
      const firstParsed = parseMappingKeyValue(
        lines,
        peek.idx,
        itemMapIndent,
        inlineMapEntry.key,
        inlineMapEntry.rest,
        null,
        errors,
      )
      obj[inlineMapEntry.key] = firstParsed.value
      keyMeta[inlineMapEntry.key] = { line: peek.idx + 1, allow: firstParsed.allow }
      idx = parseMappingEntries(lines, firstParsed.nextIdx, itemMapIndent, obj, keyMeta, errors)
      arr.push(obj)
      continue
    }

    const { valuePart, inlineAllow } = splitValueAndComment(afterDash, peek.idx + 1, errors)
    const flowOrScalar = parseScalarOrFlow(valuePart, peek.idx + 1, errors)
    if (flowOrScalar && typeof flowOrScalar === 'object' && !Array.isArray(flowOrScalar) && flowOrScalar[META]) {
      flowOrScalar[META].allow = inlineAllow ?? flowOrScalar[META].allow ?? itemAllow
    }
    arr.push(flowOrScalar)
    idx = peek.idx + 1
  }

  return { value: arr, nextIdx: idx }
}

function parseNode(lines, startIdx, minIndent, errors) {
  const peek = peekNextContent(lines, startIdx, errors)
  if (peek.idx >= lines.length || peek.indent < minIndent) {
    return { value: null, nextIdx: startIdx }
  }

  const trimmed = lines[peek.idx].slice(peek.indent)
  if (/^-(?:\s|$)/.test(trimmed)) {
    return parseSequence(lines, startIdx, peek.indent, errors)
  }

  const obj = {}
  const keyMeta = {}
  Object.defineProperty(obj, META, {
    value: { line: peek.idx + 1, allow: extractAllowDirective(peek.comments), keyMeta },
    enumerable: false,
  })
  const nextIdx = parseMappingEntries(lines, startIdx, peek.indent, obj, keyMeta, errors)
  return { value: obj, nextIdx }
}

export function parseWorkflowYaml(source) {
  const normalized = String(source ?? '').replace(/\r\n/g, '\n')
  const lines = normalized.split('\n')
  const errors = []
  const parsed = parseNode(lines, 0, 0, errors)
  return { doc: parsed.value, errors }
}

/**
 * A deliberately narrow subset of actions/runner's COMMAND [ARGS] templates.
 * The runner splits the executable at a literal space, looks up defaults by
 * the exact built-in name (not basename), and requires a {0} format argument.
 * Never synthesize an invocation for a rejected template.
 */
function parseRunnerShell(value) {
  const raw = typeof value === 'string' ? value : null
  const result = (kind, safePipefail, allowException, command = null, args = []) =>
    ({ kind, raw, safePipefail, allowException, command, args })
  if (value == null || value === '') return result('missing', false, false, 'bash', ['-e', '{0}'])
  // Reject quoting, tabs/newlines, format-string tricks and noncanonical spacing
  // rather than pretending our argv tokenizer is the runner's process parser.
  if (typeof value !== 'string' || value !== value.trim() || /[^\x20-\x7e]/.test(value) || value.includes('  ')) {
    return result('unsupported', false, false)
  }
  const tokens = value.split(' ')
  const command = tokens.shift()
  if (command === 'bash' && !tokens.length) {
    return result('bash-default', true, false, command, ['--noprofile', '--norc', '-e', '-o', 'pipefail', '{0}'])
  }
  if (['bash', '/usr/bin/bash', '/bin/bash'].includes(command)) {
    const reject = () => result('bash-unprotected', false, false)
    if (tokens.at(-1) !== '{0}' || tokens.filter((t) => t === '{0}').length !== 1) return reject()
    let errexit = false
    let pipefail = false
    let sawShortOption = false
    for (let i = 0; i < tokens.length - 1; i++) {
      const flag = tokens[i]
      if (flag === '--noprofile' || flag === '--norc') {
        if (sawShortOption) return reject() // Bash long options must precede short ones.
        continue
      }
      sawShortOption = true
      if (['-e', '-u', '-eu', '-ue'].includes(flag)) {
        errexit ||= flag.includes('e')
      } else if (['-o', '-eo', '-oe', '-euo'].includes(flag)) {
        // Bash consumes the NEXT argument for -o even in a short-option group.
        const option = tokens[++i]
        if (!['pipefail', 'errexit', 'nounset'].includes(option)) return reject()
        errexit ||= flag.includes('e') || option === 'errexit'
        pipefail ||= option === 'pipefail'
      } else return reject() // Includes -c, --, positional arguments, +e, etc.
    }
    const safe = errexit && pipefail
    return result(safe ? 'bash-custom-safe' : 'bash-unprotected', safe, false, command, tokens)
  }
  if (command === 'sh') {
    const args = tokens.length ? tokens : ['-e', '{0}']
    if (['-e {0}', '-eu {0}'].includes(args.join(' '))) return result('posix-sh', false, true, command, args)
  }
  if (command === 'python' || command === 'python3') {
    // python3 is NOT a runner built-in; bare python3 has no argument format.
    const args = command === 'python' && !tokens.length ? ['{0}'] : tokens
    if (args.length === 1 && args[0] === '{0}') return result('python', false, true, command, args)
  }
  if (command === 'pwsh' && !tokens.length) {
    return result('pwsh', false, true, command, ['-command', ". '{0}'"])
  }
  return result('unsupported', false, false)
}

export function classifyShell(shellValue) {
  const { kind, raw, safePipefail, allowException } = parseRunnerShell(shellValue)
  return { kind, raw, safePipefail, allowException }
}

/** null means rejected by the allowlist, NOT a runnable fallback. */
export function resolveRunnerInvocation(effectiveShell, scriptPath) {
  const { command, args } = parseRunnerShell(effectiveShell)
  return command ? { command, args: args.map((arg) => arg.replace('{0}', scriptPath)) } : null
}

/**
 * Whole-script lexical analysis, not a Bash interpreter or a safety proof for
 * arbitrary programs. Quotes/escapes, substitution contexts and pending heredocs
 * survive newlines. Unsupported lexical constructs fail closed. Literal text is
 * never reinterpreted as syntax; executable substitutions are scanned recursively.
 */
export function analyzeShellScript(script) {
  const text = String(script ?? '')
  let i = 0
  let hasPipeline = false
  let disablesSafety = false
  const errors = []
  const fail = (reason) => { throw new Error(reason) }

  function scan(stop = null, depth = 0) {
    if (depth > 64) fail('Shell nesting exceeds supported depth')
    let quote = null
    let word = ''
    let wordStarted = false
    let words = []
    let parens = 0
    const pending = []
    const flushWord = () => {
      if (wordStarted) {
        if (stop && word === 'case') fail('case within command substitution is unsupported')
        words.push(word)
      }
      word = ''
      wordStarted = false
    }
    const flushCommand = () => {
      flushWord()
      // Quote removal joins se"t", 'set', and escaped option spellings.
      // Conservative: inspect set even after control keywords or command/builtin.
      for (let n = 0; n < words.length; n++) {
        if (['eval', 'source', '.'].includes(words[n])) fail('Indirect shell evaluation is outside the supported subset')
        if (words[n] !== 'set') continue
        if (words.slice(n + 1).some((arg) => /[$?`]/.test(arg))) fail('Dynamic set options cannot be proven safe')
        for (let j = n + 1; j < words.length; j++) {
          if (/^\+[a-zA-Z]*e[a-zA-Z]*$/.test(words[j]) ||
              (words[j] === '+o' && ['pipefail', 'errexit'].includes(words[j + 1]))) disablesSafety = true
        }
      }
      words = []
    }
    const substitution = () => {
      flushWord()
      if (text.startsWith('$((', i)) fail('Arithmetic expansion is outside the supported lexical subset')
      if (text.startsWith('$(', i)) { i += 2; scan(')', depth + 1) }
      else { i++; scan('`', depth + 1) }
      wordStarted = true
      word += '?' // An expansion cannot join two static words unnoticed.
    }
    const consumeHeredocs = () => {
      for (const doc of pending) {
        let closed = false
        while (i < text.length) {
          const end = text.indexOf('\n', i)
          const next = end < 0 ? text.length : end
          const line = text.slice(i, next)
          if ((doc.stripTabs ? line.replace(/^\t+/, '') : line) === doc.delimiter) {
            i = end < 0 ? next : next + 1
            closed = true
            break
          }
          if (doc.quoted) i = next
          else {
            // Unquoted heredocs expand command substitutions, but their text,
            // quotes and pipe characters are data, not shell commands.
            while (i < next) {
              if (text[i] === '\\' && /[$`\\\n]/.test(text[i + 1] ?? '')) { i += 2; continue }
              if (text.startsWith('$(', i) || text[i] === '`') substitution()
              else i++
            }
          }
          if (end >= 0 && i === next) i++
        }
        if (!closed) fail('Unterminated heredoc')
      }
      pending.length = 0
    }
    while (i < text.length) {
      const ch = text[i]
      if (quote === "'") {
        if (ch === "'") quote = null
        else word += ch
        i++; continue
      }
      if (quote === "$'") {
        if (ch === "'") { quote = null; i++; continue }
        if (ch === '\\') {
          const escaped = text[++i]
          const escapes = { n: '\n', r: '\r', t: '\t', '\\': '\\', "'": "'", '"': '"' }
          if (!(escaped in escapes)) fail('Unsupported ANSI-C escape')
          word += escapes[escaped]; i++; continue
        }
        word += ch; i++; continue
      }
      if (ch === '\\') {
        if (stop === '`') fail('Escapes in legacy backtick substitutions are unsupported')
        const next = text[i + 1]
        if (next === undefined) fail('Trailing escape')
        if (next === '\n') { i += 2; continue }
        if (quote === '"' && !/[$`"\\]/.test(next)) { word += ch; i++; continue }
        wordStarted = true; word += next; i += 2; continue
      }
      if (quote === '"' && ch === '"') { quote = null; i++; continue }
      if (text.startsWith('$(', i) || (ch === '`' && !(stop === '`' && quote === null))) {
        substitution(); continue
      }
      if (text.startsWith('$"', i)) fail('Locale-translated quoting is unsupported')
      if (text.startsWith('${', i)) fail('Parameter expansion is outside the supported lexical subset')
      if (quote === '"') { word += ch; i++; continue }
      if (ch === stop && (stop !== ')' || parens === 0)) {
        if (pending.length) fail('Heredoc without body before substitution close')
        flushCommand(); i++; return
      }
      if (text.startsWith("$'", i)) { quote = "$'"; wordStarted = true; i += 2; continue }
      if (ch === "'" || ch === '"') { quote = ch; wordStarted = true; i++; continue }
      if (ch === '#' && !wordStarted) {
        while (i < text.length && text[i] !== '\n') i++
        continue
      }
      if (text.startsWith('<<<', i)) { flushWord(); i += 3; continue }
      if (text.startsWith('<<', i)) {
        flushWord(); i += 2
        const stripTabs = text[i] === '-'
        if (stripTabs) i++
        while (text[i] === ' ' || text[i] === '\t') i++
        let delimiter = ''
        let quoted = false
        const q = text[i] === "'" || text[i] === '"' ? text[i++] : null
        if (q) {
          quoted = true
          while (i < text.length && text[i] !== q && text[i] !== '\n') {
            // Deliberately refuse expansion/escape tricks in delimiter words.
            if (/[\\$`]/.test(text[i])) fail('Ambiguous heredoc delimiter')
            delimiter += text[i++]
          }
          if (text[i++] !== q) fail('Unterminated heredoc delimiter quote')
        } else {
          if (text[i] === '\\') { quoted = true; i++ }
          while (i < text.length && !/[\s;&|<>()[\]]/.test(text[i])) {
            if (!/[A-Za-z0-9_]/.test(text[i])) fail('Dynamic or unsupported heredoc delimiter')
            delimiter += text[i++]
          }
        }
        if (!delimiter || (i < text.length && !/[\s;&|<>)]/.test(text[i]))) fail('Ambiguous heredoc delimiter')
        pending.push({ delimiter, stripTabs, quoted }); continue
      }
      if (text.startsWith('<(', i) || text.startsWith('>(', i) || text.startsWith('((', i) || text.startsWith('${', i)) {
        fail('Unsupported expansion or process/arithmetic substitution')
      }
      if (ch === '\n') { flushCommand(); i++; consumeHeredocs(); continue }
      if (/\s/.test(ch)) { flushWord(); i++; continue }
      if (ch === '|') {
        if (text[i + 1] === '|') i++
        else hasPipeline = true
        flushCommand(); i++; continue
      }
      if (';&()<>'.includes(ch)) {
        if (ch === '(') parens++
        if (ch === ')' && parens > 0) parens--
        flushCommand(); i++; continue
      }
      wordStarted = true; word += ch; i++
    }
    if (quote) fail('Unterminated shell quote')
    if (stop) fail('Unterminated command substitution')
    if (pending.length) fail('Unterminated heredoc')
    if (parens) fail('Unterminated subshell')
    flushCommand()
  }
  try { scan() } catch (error) { errors.push(error.message) }
  return { hasPipeline, disablesSafety, ambiguous: errors.length > 0, errors }
}

export function detectShellPipeline(script) {
  return analyzeShellScript(script).hasPipeline
}

export function detectDisabledShellSafety(script) {
  return analyzeShellScript(script).disablesSafety
}

function getNodeMeta(node) {
  return (node && typeof node === 'object' && node[META]) || { line: 1, allow: null, keyMeta: {} }
}

function getKeyAllow(node, key) {
  return getNodeMeta(node).keyMeta?.[key]?.allow ?? null
}

function getKeyLine(node, key) {
  return getNodeMeta(node).keyMeta?.[key]?.line ?? getNodeMeta(node).line ?? 1
}

export function auditWorkflowYaml(source, fileName = 'workflow.yml') {
  const violations = []
  const parsedJobs = {}
  let stepsChecked = 0
  let pipelineStepsChecked = 0

  const { doc, errors } = parseWorkflowYaml(source)
  for (const err of errors) {
    violations.push({
      file: fileName,
      line: err.line,
      rule: err.code,
      detail: err.message,
    })
  }

  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    violations.push({ file: fileName, line: 1, rule: 'invalid_workflow_root', detail: 'Workflow root must be a YAML mapping' })
    return { ok: false, file: fileName, workflowDefaultShell: null, stepsChecked, pipelineStepsChecked, violations, parsedJobs }
  }

  const workflowDefaults = doc.defaults
  const workflowRunDefaults =
    workflowDefaults && typeof workflowDefaults === 'object' && !Array.isArray(workflowDefaults)
      ? workflowDefaults.run
      : null
  const hasWorkflowShell = Boolean(
    workflowRunDefaults && typeof workflowRunDefaults === 'object' && !Array.isArray(workflowRunDefaults) && 'shell' in workflowRunDefaults,
  )
  const workflowShell = hasWorkflowShell ? workflowRunDefaults.shell : null
  const workflowShellInfo = classifyShell(workflowShell)

  if (!hasWorkflowShell) {
    violations.push({
      file: fileName,
      line: 1,
      rule: 'missing_workflow_default_shell',
      detail: 'Workflow must declare top-level `defaults.run.shell: bash` so all run steps inherit `-e -o pipefail`',
    })
  } else if (!workflowShellInfo.safePipefail) {
    violations.push({
      file: fileName,
      line: getKeyLine(workflowRunDefaults, 'shell'),
      rule: 'unsafe_workflow_default_shell',
      detail: `Workflow top-level defaults.run.shell (${JSON.stringify(workflowShell)}) does not enforce bash -e -o pipefail`,
    })
  }

  const jobs = doc.jobs
  if (!jobs || typeof jobs !== 'object' || Array.isArray(jobs) || Object.keys(jobs).length === 0) {
    violations.push({ file: fileName, line: 1, rule: 'missing_jobs', detail: 'Workflow must define at least one job under `jobs:`' })
    return { ok: false, file: fileName, workflowDefaultShell: workflowShell, stepsChecked, pipelineStepsChecked, violations, parsedJobs }
  }

  for (const [jobId, job] of Object.entries(jobs)) {
    if (!job || typeof job !== 'object' || Array.isArray(job)) {
      violations.push({ file: fileName, line: getKeyLine(jobs, jobId), rule: 'invalid_job', detail: `Job ${jobId} must be a mapping` })
      continue
    }

    if (typeof job.uses === 'string' && !('steps' in job)) {
      parsedJobs[jobId] = { reusableUses: job.uses, jobDefaultShell: null, steps: [] }
      continue
    }

    const jobDefaults = job.defaults
    const jobRunDefaults =
      jobDefaults && typeof jobDefaults === 'object' && !Array.isArray(jobDefaults)
        ? jobDefaults.run
        : null
    const hasJobShell = Boolean(
      jobRunDefaults && typeof jobRunDefaults === 'object' && !Array.isArray(jobRunDefaults) && 'shell' in jobRunDefaults,
    )
    const jobShell = hasJobShell ? jobRunDefaults.shell : null
    const jobAllow =
      (hasJobShell ? getKeyAllow(jobRunDefaults, 'shell') : null) ??
      (jobDefaults ? getKeyAllow(job, 'defaults') : null) ??
      getKeyAllow(jobs, jobId) ??
      getNodeMeta(job).allow

    if (hasJobShell) {
      const jobShellInfo = classifyShell(jobShell)
      const jobShellLine = getKeyLine(jobRunDefaults, 'shell')
      if (!jobShellInfo.safePipefail) {
        if (jobShellInfo.kind === 'bash-unprotected') {
          violations.push({
            file: fileName,
            line: jobShellLine,
            rule: 'unprotected_bash_job_override',
            detail: `Job "${jobId}" overrides shell with unprotected bash (${JSON.stringify(jobShell)})`,
          })
        } else if (!jobShellInfo.allowException) {
          violations.push({
            file: fileName,
            line: jobShellLine,
            rule: 'unsafe_job_shell_override',
            detail: `Job "${jobId}" sets unsupported defaults.run.shell (${JSON.stringify(jobShell)})`,
          })
        } else if (!jobAllow || !jobAllow.present) {
          violations.push({
            file: fileName,
            line: jobShellLine,
            rule: 'unsafe_job_shell_override',
            detail: `Job "${jobId}" overrides defaults.run.shell to ${JSON.stringify(jobShell)} without a # shell-guard-allow justification`,
          })
        } else if (jobAllow.reason.length < MIN_EXCEPTION_REASON_LENGTH) {
          violations.push({
            file: fileName,
            line: jobShellLine,
            rule: 'empty_exception_justification',
            detail: `Job "${jobId}" # shell-guard-allow justification must explain why the override is safe (>= ${MIN_EXCEPTION_REASON_LENGTH} chars)`,
          })
        }
      }
    }

    if (!Array.isArray(job.steps) || job.steps.length === 0) {
      violations.push({
        file: fileName,
        line: getKeyLine(jobs, jobId),
        rule: 'missing_job_steps',
        detail: `Job "${jobId}" has no steps`,
      })
      continue
    }

    const resolvedSteps = []
    for (let idx = 0; idx < job.steps.length; idx++) {
      const step = job.steps[idx]
      if (!step || typeof step !== 'object' || Array.isArray(step)) {
        violations.push({
          file: fileName,
          line: getKeyLine(job, 'steps'),
          rule: 'invalid_step',
          detail: `Job "${jobId}" step #${idx + 1} is not a mapping`,
        })
        continue
      }

      const stepLine = getNodeMeta(step).line
      const stepLabel = typeof step.name === 'string' ? step.name : `step #${idx + 1}`

      if ('uses' in step && 'run' in step) {
        violations.push({
          file: fileName,
          line: stepLine,
          rule: 'step_has_both_uses_and_run',
          detail: `Job "${jobId}" (${stepLabel}) defines both uses and run`,
        })
        continue
      }

      if (!('run' in step)) {
        if (!('uses' in step)) {
          violations.push({
            file: fileName,
            line: stepLine,
            rule: 'step_missing_run_or_uses',
            detail: `Job "${jobId}" (${stepLabel}) defines neither uses nor run`,
          })
          continue
        }
        if ('shell' in step) {
          violations.push({
            file: fileName,
            line: getKeyLine(step, 'shell'),
            rule: 'shell_on_uses_step',
            detail: `Job "${jobId}" (${stepLabel}) sets shell on a non-run step`,
          })
        }
        resolvedSteps.push({
          index: idx,
          name: stepLabel,
          id: typeof step.id === 'string' ? step.id : null,
          ifCondition: typeof step.if === 'string' ? step.if : null,
          uses: typeof step.uses === 'string' ? step.uses : null,
          hasRun: false,
        })
        continue
      }

      stepsChecked++
      const runScript = typeof step.run === 'string' ? step.run : String(step.run ?? '')
      const hasStepShell = 'shell' in step
      const effectiveShell = hasStepShell ? step.shell : hasJobShell ? jobShell : workflowShell
      const shellInfo = classifyShell(effectiveShell)
      // Non-Bash exception languages are not parsed as Bash. sh uses this
      // conservative shared lexical subset too; exceptions never waive ambiguity.
      const scriptAnalysis = ['python', 'pwsh'].includes(shellInfo.kind)
        ? { hasPipeline: false, disablesSafety: false, ambiguous: false, errors: [] }
        : analyzeShellScript(runScript)
      const { hasPipeline } = scriptAnalysis
      if (scriptAnalysis.ambiguous) {
        violations.push({ file: fileName, line: getKeyLine(step, 'run'), rule: 'ambiguous_shell_syntax',
          detail: `Job "${jobId}" (${stepLabel}): ${scriptAnalysis.errors.join('; ')}` })
      }
      if (hasPipeline) pipelineStepsChecked++

      const stepAllow =
        (hasStepShell ? getKeyAllow(step, 'shell') : null) ??
        getNodeMeta(step).allow ??
        (!hasStepShell ? jobAllow : null)

      if (scriptAnalysis.disablesSafety) {
        violations.push({
          file: fileName,
          line: getKeyLine(step, 'run'),
          rule: 'script_disables_shell_safety',
          detail: `Job "${jobId}" (${stepLabel}) disables errexit or pipefail inside run script`,
        })
      }

      let documentedException = false
      if (!shellInfo.safePipefail) {
        const errLine = hasStepShell ? getKeyLine(step, 'shell') : stepLine
        if (shellInfo.kind === 'bash-unprotected') {
          violations.push({
            file: fileName,
            line: errLine,
            rule: 'unprotected_bash_step_shell',
            detail: `Job "${jobId}" (${stepLabel}) resolves to unprotected bash (${JSON.stringify(effectiveShell)})`,
          })
        } else if (shellInfo.kind === 'posix-sh' && hasPipeline) {
          violations.push({
            file: fileName,
            line: errLine,
            rule: 'posix_sh_forbidden_on_pipeline',
            detail: `Job "${jobId}" (${stepLabel}) uses POSIX sh on a pipeline step; pipe exit codes would be lost`,
          })
        } else if (!shellInfo.allowException) {
          violations.push({
            file: fileName,
            line: errLine,
            rule: hasStepShell ? 'unsafe_step_shell_override' : 'step_effective_shell_unprotected',
            detail: `Job "${jobId}" (${stepLabel}) resolves to unprotected shell (${JSON.stringify(effectiveShell)})`,
          })
        } else if (!stepAllow || !stepAllow.present) {
          violations.push({
            file: fileName,
            line: errLine,
            rule: 'unsafe_step_shell_override',
            detail: `Job "${jobId}" (${stepLabel}) resolves to ${JSON.stringify(effectiveShell)} without a # shell-guard-allow justification`,
          })
        } else if (stepAllow.reason.length < MIN_EXCEPTION_REASON_LENGTH) {
          violations.push({
            file: fileName,
            line: errLine,
            rule: 'empty_exception_justification',
            detail: `Job "${jobId}" (${stepLabel}) # shell-guard-allow justification must be >= ${MIN_EXCEPTION_REASON_LENGTH} chars`,
          })
        } else {
          documentedException = true
        }
      }

      const runner = resolveRunnerInvocation(effectiveShell, '{0}')
      resolvedSteps.push({
        index: idx,
        name: stepLabel,
        id: typeof step.id === 'string' ? step.id : null,
        ifCondition: typeof step.if === 'string' ? step.if : null,
        continueOnError: step['continue-on-error'] === true || step['continue-on-error'] === 'true',
        hasRun: true,
        run: runScript,
        explicitStepShell: hasStepShell ? step.shell : null,
        effectiveShell,
        safePipefail: shellInfo.safePipefail,
        documentedException,
        hasPipeline,
        disablesSafety: scriptAnalysis.disablesSafety,
        ambiguousShellSyntax: scriptAnalysis.ambiguous,
        runnerCommand: runner?.command ?? null,
        runnerArgsTemplate: runner?.args ?? null,
      })
    }

    parsedJobs[jobId] = {
      jobDefaultShell: jobShell,
      steps: resolvedSteps,
    }
  }

  return {
    ok: violations.length === 0,
    file: fileName,
    workflowDefaultShell: workflowShell,
    stepsChecked,
    pipelineStepsChecked,
    violations,
    parsedJobs,
  }
}

export function auditWorkflowDirectory(workflowsDir = DEFAULT_WORKFLOWS_DIR, options = {}) {
  const { requireStandardFiles = true } = options
  const violations = []
  const filesReport = {}
  let totalStepsChecked = 0
  let totalPipelineStepsChecked = 0

  if (!existsSync(workflowsDir)) {
    return {
      ok: false,
      workflowsChecked: 0,
      stepsChecked: 0,
      pipelineStepsChecked: 0,
      violations: [{ file: workflowsDir, line: 0, rule: 'missing_workflows_directory', detail: 'Workflows directory does not exist' }],
      files: {},
    }
  }

  const entries = readdirSync(workflowsDir)
    .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
    .sort()

  if (requireStandardFiles) {
    for (const requiredFile of REQUIRED_WORKFLOW_FILES) {
      if (!entries.includes(requiredFile)) {
        violations.push({
          file: requiredFile,
          line: 0,
          rule: 'missing_required_workflow',
          detail: `Expected workflow ${requiredFile} is missing from ${workflowsDir}`,
        })
      }
    }
  }

  if (entries.length === 0) {
    violations.push({
      file: workflowsDir,
      line: 0,
      rule: 'no_workflow_files_found',
      detail: 'No .yml or .yaml workflow files found',
    })
  }

  for (const fileName of entries) {
    const source = readFileSync(join(workflowsDir, fileName), 'utf8')
    const result = auditWorkflowYaml(source, fileName)
    filesReport[fileName] = result
    totalStepsChecked += result.stepsChecked
    totalPipelineStepsChecked += result.pipelineStepsChecked
    violations.push(...result.violations)
  }

  return {
    ok: violations.length === 0,
    workflowsChecked: entries.length,
    stepsChecked: totalStepsChecked,
    pipelineStepsChecked: totalPipelineStepsChecked,
    violations,
    files: filesReport,
  }
}

/* ---------- CLI mode for targeted workflow-directory audits ---------- */

function parseCliFlagValue(args, flag) {
  const idx = args.indexOf(flag)
  if (idx !== -1 && idx + 1 < args.length) return args[idx + 1]
  const prefixed = args.find((arg) => arg.startsWith(`${flag}=`))
  return prefixed ? prefixed.slice(flag.length + 1) : null
}

function runFullGuardHarness() {
  const cases = []
  const check = (name, condition, detail = '') => cases.push({ name, pass: Boolean(condition), detail })

  const runDryInRepo = () => {
    const result = spawnSync(process.execPath, [SCRIPT, '--dry-run'], { encoding: 'utf8', env: process.env })
    return { ok: result.status === 0, out: `${result.stdout ?? ''}${result.stderr ?? ''}` }
  }

  // Protected-branch recovery & write-blocking checks run inside isolated temp
  // git repositories so `--apply` never mutates the caller's working directory.
  {
    const withIsolatedMainRepo = (fn) => {
      const dir = mkdtempSync(join(tmpdir(), 'celia-agent-main-'))
      try {
        spawnSync('git', ['init', '-b', 'main'], { cwd: dir, encoding: 'utf8' })
        mkdirSync(join(dir, 'node_modules', 'vite'), { recursive: true })
        writeFileSync(join(dir, '.gitignore'), 'node_modules/\nbin/\n.empty-home/\n')
        writeFileSync(join(dir, 'package.json'), JSON.stringify({
          name: 'guard-main-fixture',
          version: '0.1.0',
          scripts: { check: 'node -e "process.exit(0)"' },
          dependencies: { vite: '^8.0.8' },
        }, null, 2) + '\n')
        writeFileSync(join(dir, 'package-lock.json'), JSON.stringify({
          name: 'guard-main-fixture',
          version: '0.1.0',
          lockfileVersion: 3,
        }, null, 2) + '\n')
        writeFileSync(join(dir, 'CHANGELOG.md'), '# Changelog\n\n## [Unreleased]\n')
        spawnSync('git', ['add', '.'], { cwd: dir, encoding: 'utf8' })
        spawnSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'base'], { cwd: dir, encoding: 'utf8' })
        const baseSha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).stdout.trim()
        return fn({ dir, baseSha })
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    }

    const makeNpmShim = (dir, scriptBody) => {
      const binDir = join(dir, 'bin')
      const emptyHome = join(dir, '.empty-home')
      mkdirSync(binDir, { recursive: true })
      mkdirSync(emptyHome, { recursive: true })
      const shim = join(binDir, 'npm')
      writeFileSync(shim, `#!/usr/bin/env node\n${scriptBody}\n`)
      chmodSync(shim, 0o755)
      const cleanEnv = { ...process.env }
      delete cleanEnv.GIT_AUTHOR_NAME
      delete cleanEnv.GIT_AUTHOR_EMAIL
      delete cleanEnv.GIT_COMMITTER_NAME
      delete cleanEnv.GIT_COMMITTER_EMAIL
      return {
        ...cleanEnv,
        HOME: emptyHome,
        GIT_CONFIG_NOSYSTEM: '1',
        PATH: `${binDir}:${process.env.PATH ?? ''}`,
      }
    }

    withIsolatedMainRepo(({ dir, baseSha }) => {
      const env = makeNpmShim(dir, `process.stdout.write('{}'); process.exit(0)`)
      const noop = spawnSync(process.execPath, [SCRIPT, '--apply'], { cwd: dir, env, encoding: 'utf8' })
      const headBranch = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir, encoding: 'utf8' }).stdout.trim()
      const mainSha = spawnSync('git', ['rev-parse', 'refs/heads/main'], { cwd: dir, encoding: 'utf8' }).stdout.trim()
      const maintBranches = spawnSync('git', ['branch', '--list', 'maintenance/*'], { cwd: dir, encoding: 'utf8' }).stdout.trim()
      check(
        'exits 0 as noop on main without branching when zero routine updates exist',
        noop.status === 0 &&
          /agent=noop reason=no_routine_updates_available branch=main/.test(noop.stdout) &&
          headBranch === 'main' &&
          mainSha === baseSha &&
          maintBranches === '',
        `status=${noop.status} branch=${headBranch}`,
      )
    })

    withIsolatedMainRepo(({ dir, baseSha }) => {
      const env = makeNpmShim(dir, `process.stdout.write('{}'); process.exit(0)`)
      const commitTargetMain = spawnSync(process.execPath, [SCRIPT, '--apply', '--proposal-branch=main'], { cwd: dir, env, encoding: 'utf8' })
      const pushTargetMain = spawnSync(process.execPath, [SCRIPT, '--push', 'main'], { cwd: dir, env, encoding: 'utf8' })
      const mainSha = spawnSync('git', ['rev-parse', 'refs/heads/main'], { cwd: dir, encoding: 'utf8' }).stdout.trim()
      check(
        'refuses to commit or push directly on a protected branch',
        commitTargetMain.status === 1 &&
          /agent=blocked reason=protected_branch/.test(commitTargetMain.stdout) &&
          pushTargetMain.status === 1 &&
          /agent=blocked reason=protected_branch operation=push branch=main/.test(pushTargetMain.stdout) &&
          mainSha === baseSha,
        'both --proposal-branch=main and --push main blocked',
      )
    })

    withIsolatedMainRepo(({ dir, baseSha }) => {
      const env = makeNpmShim(
        dir,
        `const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[0] === 'outdated') {
  process.stdout.write(JSON.stringify({ vite: { current: '8.0.8', wanted: '8.0.9', latest: '8.0.9' } }));
  process.exit(1);
}
if (args[0] === 'update') {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  pkg.dependencies.vite = '^8.0.9';
  fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\\n');
  process.exit(0);
}
process.exit(0);`,
      )
      const prop = spawnSync(process.execPath, [SCRIPT, '--apply'], { cwd: dir, env, encoding: 'utf8' })
      const headBranch = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir, encoding: 'utf8' }).stdout.trim()
      const mainSha = spawnSync('git', ['rev-parse', 'refs/heads/main'], { cwd: dir, encoding: 'utf8' }).stdout.trim()
      const parentSha = spawnSync('git', ['rev-parse', 'HEAD~1'], { cwd: dir, encoding: 'utf8' }).stdout.trim()
      check(
        'creates isolated maintenance/* branch from main without mutating main',
        prop.status === 0 &&
          /agent=proposed branch=maintenance\/routine-dependencies-/.test(prop.stdout) &&
          /^maintenance\/routine-dependencies-/.test(headBranch) &&
          mainSha === baseSha &&
          parentSha === baseSha,
        `branch=${headBranch} main_intact=${mainSha === baseSha}`,
      )
    })
  }

  const dry = runDryInRepo()
  check('dry run never writes', /agent=dry_run_changes=0|agent=noop/.test(dry.out), dry.out.split('\n')[0] ?? '')
  check('dry run never claims a merge', !/agent=merged/.test(dry.out), 'merge is not a capability')

  const pathGuard = `
const ALLOWED_PATHS = new Set(['package.json', 'package-lock.json', 'CHANGELOG.md'])
const DENY = [/^\\.github\\//, /^src\\//, /^server\\//, /^shared\\//, /^api\\//, /^tests\\//, /^scripts\\//, /^config\\//, /^\\.env/, /^SECURITY\\.md$/]
const allowed = (paths) => paths.every((p) => ALLOWED_PATHS.has(p) && !DENY.some((r) => r.test(p)))
const results = {
  src_blocked: !allowed(['src/lib/summary.ts']),
  workflow_blocked: !allowed(['.github/workflows/ci.yml']),
  server_blocked: !allowed(['server/ai.ts']),
  tests_blocked: !allowed(['tests/engine.test.ts']),
  secret_file_blocked: !allowed(['.env']),
  pkg_allowed: allowed(['package.json']),
  mixed_blocked: !allowed(['package.json', 'src/App.tsx']),
}
console.log(JSON.stringify(results))
`
  const guardRun = spawnSync(process.execPath, ['--input-type=module', '-e', pathGuard], { encoding: 'utf8' })
  const guardResults = (() => {
    try { return JSON.parse(guardRun.stdout.trim()) } catch { return {} }
  })()
  for (const [key, value] of Object.entries(guardResults)) {
    check(`path guard: ${key.replace(/_/g, ' ')}`, value === true, value === true ? 'blocked as required' : 'GUARD FAILED')
  }

  const secretGuard = `
const BEGIN = '-----BEGIN ' + 'RSA ' + 'PRIVATE KEY-----'
const patterns = [/\\bgsk_[A-Za-z0-9]{20,}/, /^\\s*VITE_[A-Z0-9_]*(?:API_KEY|SECRET|TOKEN|ACCESS_CODE)\\s*=\\s*\\S+/m, new RegExp('-----BEGIN [A-Z ]*PRIVATE KEY-----')]
const dirty = (s) => patterns.some((re) => re.test(s))
const results = {
  groq_key_blocked: dirty('const k = "gsk_' + 'a'.repeat(30) + '"'),
  vite_secret_blocked: dirty('VITE_GROQ_API_KEY=abc123'),
  private_key_blocked: dirty(BEGIN),
  clean_package_allowed: !dirty('{"name":"celia-sh","version":"0.1.0"}'),
}
console.log(JSON.stringify(results))
`
  const secretRun = spawnSync(process.execPath, ['--input-type=module', '-e', secretGuard], { encoding: 'utf8' })
  const secretResults = (() => {
    try { return JSON.parse(secretRun.stdout.trim()) } catch { return {} }
  })()
  for (const [key, value] of Object.entries(secretResults)) {
    check(`secret guard: ${key.replace(/_/g, ' ')}`, value === true, value === true ? 'blocked as required' : 'GUARD FAILED')
  }

  // Classification completeness: every outdated package must land in exactly one
  // reported bucket.
  {
    const classify = `
const semver = /^\\d+\\.\\d+\\.\\d+/
const majorOf = (v) => String(v ?? '').split('.')[0]
const parsed = {
  routinePkg: { current: '1.2.3', wanted: '1.2.5', latest: '1.2.5' },
  majorPkg:   { current: '5.9.3', wanted: '6.0.0', latest: '6.0.0' },
  rangePkg:   { current: '5.9.3', wanted: '5.9.3', latest: '7.0.2' },
  nonSemver:  { current: 'workspace:*', wanted: 'x', latest: 'y' },
}
const buckets = []
for (const [name, info] of Object.entries(parsed)) {
  const { current, wanted } = info ?? {}
  if (!semver.test(current ?? '')) continue
  if (majorOf(current) !== majorOf(wanted ?? current)) { buckets.push(name + ':major'); continue }
  if ((wanted ?? current) === current) { buckets.push(name + ':satisfied'); continue }
  buckets.push(name + ':routine')
}
console.log(JSON.stringify(buckets))
`
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', classify], { encoding: 'utf8' })
    const buckets = (() => {
      try { return JSON.parse(result.stdout.trim()) } catch { return [] }
    })()
    check('classifies routine, major and range-satisfied separately',
      buckets.includes('routinePkg:routine') && buckets.includes('majorPkg:major') && buckets.includes('rangePkg:satisfied'),
      buckets.join(',') || 'no buckets')
    check('never drops a semver package without a bucket',
      buckets.filter((b) => b.startsWith('rangePkg')).length === 1 && !buckets.some((b) => b.startsWith('nonSemver')),
      'rangePkg present once, non-semver excluded')
  }

  // End-to-end failure-mode guards on the real script: missing `node_modules`,
  // missing `current` in `npm outdated --json`, and missing/rejected npm
  // credentials (`ENEEDAUTH`) must halt loudly instead of pretending 0 updates.
  {
    const runIsolated = ({ withNodeModules, npmScript }) => {
      const dir = mkdtempSync(join(tmpdir(), 'celia-agent-guard-'))
      try {
        spawnSync('git', ['init', '-b', 'feature/test'], { cwd: dir, encoding: 'utf8' })
        spawnSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-m', 'init'], { cwd: dir, encoding: 'utf8' })
        writeFileSync(join(dir, 'package.json'), JSON.stringify({
          name: 'guard-fixture',
          version: '0.1.0',
          dependencies: { vite: '8.3.6' },
        }))
        if (withNodeModules) mkdirSync(join(dir, 'node_modules', 'vite'), { recursive: true })
        let env = { ...process.env }
        if (npmScript) {
          const binDir = join(dir, 'bin')
          mkdirSync(binDir, { recursive: true })
          const shim = join(binDir, 'npm')
          writeFileSync(shim, `#!/usr/bin/env node\n${npmScript}\n`)
          chmodSync(shim, 0o755)
          env = { ...env, PATH: `${binDir}:${process.env.PATH ?? ''}` }
        }
        const res = spawnSync(process.execPath, [SCRIPT, '--dry-run'], { cwd: dir, env, encoding: 'utf8' })
        return { ok: res.status === 0, status: res.status, out: `${res.stdout ?? ''}\n${res.stderr ?? ''}`.trim() }
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    }

    const noNodeModules = runIsolated({ withNodeModules: false })
    check('halts loudly when node_modules is missing',
      !noNodeModules.ok && /agent=blocked reason=missing_node_modules/.test(noNodeModules.out),
      noNodeModules.out.split('\n')[0] ?? '')

    const missingCurrent = runIsolated({
      withNodeModules: true,
      npmScript: `process.stdout.write(JSON.stringify({ vite: { wanted: '8.3.6', latest: '8.4.0' } })); process.exit(1)`,
    })
    check('halts loudly when npm outdated omits current version',
      !missingCurrent.ok && /agent=blocked reason=missing_installed_version packages=vite/.test(missingCurrent.out),
      missingCurrent.out.split('\n')[0] ?? '')

    const authFailure = runIsolated({
      withNodeModules: true,
      npmScript: `process.stdout.write(JSON.stringify({ error: { code: 'ENEEDAUTH', summary: 'This command requires you to be logged in.' } })); process.exit(1)`,
    })
    check('halts loudly on npm registry credential failure (ENEEDAUTH)',
      !authFailure.ok && /agent=blocked reason=npm_outdated_error code=ENEEDAUTH/.test(authFailure.out),
      authFailure.out.split('\n')[0] ?? '')

    const brokenOutdated = runIsolated({
      withNodeModules: true,
      npmScript: `process.stderr.write('npm ERR! network failure\\n'); process.exit(1)`,
    })
    check('halts loudly when npm outdated fails without JSON',
      !brokenOutdated.ok && /agent=blocked reason=outdated_query_failed/.test(brokenOutdated.out),
      brokenOutdated.out.split('\n')[0] ?? '')
  }

  // Workflow shell & pipefail integrity guards across all GitHub Actions workflows
  // plus adversarial self-tests on effective shell resolution & overrides.
  {
    const liveAudit = auditWorkflowDirectory(DEFAULT_WORKFLOWS_DIR, { requireStandardFiles: true })
    const ciVerifySmoke = liveAudit.files['ci.yml']?.parsedJobs?.verify?.steps?.find(
      (s) => s.hasRun && s.name === 'Smoke test the published site',
    )
    const maintPropose = liveAudit.files['maintenance-agent.yml']?.parsedJobs?.propose?.steps?.find(
      (s) => s.hasRun && s.name === 'Propose routine updates',
    )
    check(
      'workflow guard: all 4 workflows enforce effective bash pipefail',
      liveAudit.ok &&
        liveAudit.workflowsChecked >= 4 &&
        Boolean(ciVerifySmoke?.safePipefail && ciVerifySmoke?.hasPipeline) &&
        Boolean(maintPropose?.safePipefail && maintPropose?.hasPipeline),
      liveAudit.ok
        ? `workflows=${liveAudit.workflowsChecked} run_steps=${liveAudit.stepsChecked} pipelines=${liveAudit.pipelineStepsChecked}`
        : liveAudit.violations.map((v) => `${v.file}:${v.line}:${v.rule}`).join(', '),
    )

    const unsafeTemplate = 'bash -c exit -e -o pipefail {0}'
    check('workflow guard: rejects -c and absolute-path runner mismatches',
      !classifyShell(unsafeTemplate).safePipefail && resolveRunnerInvocation(unsafeTemplate, '{0}') === null &&
      !classifyShell('/usr/bin/bash').safePipefail && resolveRunnerInvocation('/usr/bin/bash', '{0}') === null &&
      classifyShell('/usr/bin/bash -e -o pipefail {0}').safePipefail &&
      resolveRunnerInvocation('bash', '{0}').args.join(' ') === '--noprofile --norc -e -o pipefail {0}',
      'one strict allowlist shared by classification and invocation')

    const multiline = analyzeShellScript(`printf '%s\\n' "start
<<HIDE
end"
set +o pipefail
node scripts/smoke-deploy.mjs | tee out.txt`)
    check('workflow guard: multiline quotes cannot hide disabling commands or pipes',
      multiline.hasPipeline && multiline.disablesSafety && !multiline.ambiguous)
    const heredoc = analyzeShellScript("cat <<'EOF'\nset +o pipefail\nfalse | cat\nEOF\necho ok")
    check('workflow guard: literal heredoc bodies are not executable shell',
      !heredoc.hasPipeline && !heredoc.disablesSafety && !heredoc.ambiguous)
    check('workflow guard: ambiguous shell syntax fails closed',
      ["echo 'open", 'echo "$(echo ok', 'cat <<EOF\nmissing', 'cat <<$VAR\necho ok']
        .every((script) => analyzeShellScript(script).ambiguous))

    const missingDefaultAudit = auditWorkflowYaml(
      [
        'name: Missing default',
        '# defaults:',
        '#   run:',
        '#     shell: bash',
        'on: push',
        'jobs:',
        '  verify:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - run: |',
        '          echo "defaults: run: shell: bash" | tee out.txt',
      ].join('\n'),
      'missing-default.yml',
    )
    check(
      'workflow guard: rejects missing workflow-level defaults.run.shell',
      !missingDefaultAudit.ok &&
        missingDefaultAudit.violations.some((v) => v.rule === 'missing_workflow_default_shell') &&
        missingDefaultAudit.violations.some((v) => v.rule === 'step_effective_shell_unprotected'),
      'blocked decoy comment/echo without real defaults.run.shell',
    )

    const jobOverrideAudit = auditWorkflowYaml(
      [
        'name: Unsafe job override',
        'on: push',
        'defaults:',
        '  run:',
        '    shell: bash',
        'jobs:',
        '  verify:',
        '    runs-on: ubuntu-latest',
        '    defaults:',
        '      run:',
        '        shell: sh',
        '    steps:',
        '      - run: node scripts/smoke-deploy.mjs | tee out.txt',
      ].join('\n'),
      'job-override.yml',
    )
    const stepOverrideAudit = auditWorkflowYaml(
      [
        'name: Unsafe step override',
        'on: push',
        'defaults:',
        '  run:',
        '    shell: bash',
        'jobs:',
        '  verify:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - name: Custom bash without pipefail',
        '        shell: bash -e {0}',
        '        run: node scripts/smoke-deploy.mjs | tee out.txt',
        '      - name: In-script pipefail disable',
        '        run: |',
        '          echo "<<FAKE_EOF" # <<COMMENT_EOF',
        '          cat <<<HERE_STRING',
        '          set +o pipefail',
        '          node scripts/smoke-deploy.mjs | tee out.txt',
        '      - { run: "node scripts/smoke-deploy.mjs | tee out.txt", shell: sh }',
      ].join('\n'),
      'step-override.yml',
    )
    check(
      'workflow guard: rejects unsafe job-level or step-level shell overrides',
      !jobOverrideAudit.ok &&
        jobOverrideAudit.violations.some((v) => v.rule === 'unsafe_job_shell_override') &&
        jobOverrideAudit.violations.some((v) => v.rule === 'posix_sh_forbidden_on_pipeline') &&
        !stepOverrideAudit.ok &&
        stepOverrideAudit.violations.some((v) => v.rule === 'unprotected_bash_step_shell') &&
        stepOverrideAudit.violations.some((v) => v.rule === 'script_disables_shell_safety') &&
        stepOverrideAudit.violations.some((v) => v.rule === 'posix_sh_forbidden_on_pipeline'),
      'blocked job/flow sh overrides, bash -e {0}, and set +o pipefail',
    )

    const documentedSafeException = auditWorkflowYaml(
      [
        'name: Documented safe exception',
        'on: push',
        'defaults:',
        '  run:',
        '    shell: bash',
        'jobs:',
        '  check:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - name: Standard pipefail pipeline',
        '        run: echo ok | tee out.txt',
        '      # shell-guard-allow: Pure Python inline helper with no shell pipelines',
        '      - name: Python check',
        '        shell: python',
        '        run: print("ok")',
        '      # shell-guard-allow: POSIX sh single-command check without any shell pipe',
        '      - name: POSIX sh non-pipe check',
        '        shell: sh',
        '        run: test -f package.json',
      ].join('\n'),
      'documented-exception.yml',
    )
    const forbiddenPipeShException = auditWorkflowYaml(
      [
        'name: Forbidden sh on pipe despite comment',
        'on: push',
        'defaults:',
        '  run:',
        '    shell: bash',
        'jobs:',
        '  verify:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      # shell-guard-allow: Attempting to allow sh on a pipeline must still fail',
        '      - name: Broken pipe under sh',
        '        shell: sh',
        '        run: node scripts/smoke-deploy.mjs | tee out.txt',
      ].join('\n'),
      'forbidden-pipe-sh.yml',
    )
    check(
      'workflow guard: accepts documented non-pipe exceptions and blocks sh on pipelines',
      documentedSafeException.ok &&
        !forbiddenPipeShException.ok &&
        forbiddenPipeShException.violations.some((v) => v.rule === 'posix_sh_forbidden_on_pipeline'),
      'documented python/non-pipe sh allowed; sh on pipeline blocked',
    )
  }

  const failed = cases.filter((entry) => !entry.pass)
  for (const entry of cases) console.log(`${entry.pass ? 'PASS' : 'FAIL'}  ${entry.name}${entry.detail ? `  (${entry.detail})` : ''}`)
  console.log(`agent_guards=${failed.length ? 'failed' : 'passed'} checks=${cases.length}`)
  if (failed.length) {
    for (const entry of failed) console.error(`::error title=Agent guard failed::${entry.name}`)
    process.exit(1)
  }
}

const cliArgs = process.argv.slice(2)
const customWorkflowsDir = parseCliFlagValue(cliArgs, '--workflows-dir')
if (customWorkflowsDir !== null) {
  const requireStandard = !cliArgs.includes('--no-require-standard')
  const result = auditWorkflowDirectory(resolve(customWorkflowsDir), { requireStandardFiles: requireStandard })
  if (cliArgs.includes('--json')) {
    console.log(JSON.stringify(result, null, 2))
  } else if (result.ok) {
    console.log(
      `workflow_shell_guard=passed workflows=${result.workflowsChecked} steps=${result.stepsChecked} pipelines=${result.pipelineStepsChecked}`,
    )
  } else {
    for (const v of result.violations) {
      console.error(`FAIL  ${v.file}:${v.line} [${v.rule}] ${v.detail}`)
    }
    console.error(`workflow_shell_guard=failed violations=${result.violations.length}`)
  }
  process.exit(result.ok ? 0 : 1)
} else if (process.argv[1] && resolve(process.argv[1]) === SELF_PATH) {
  runFullGuardHarness()
}
