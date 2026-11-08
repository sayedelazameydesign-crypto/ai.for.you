import { describe, expect, it } from 'vitest'
import { generateMarketing, marketingExample } from '../src/lib/marketing'
import { countWords, splitSentences, summarize, summaryExample, MAX_TEXT_LENGTH } from '../src/lib/summary'
import { analyzeCode, codeExamples } from '../src/lib/code'
import { parseSaved, resultToText, STORAGE_KEY } from '../src/lib/storage'

describe('local marketing templates', () => {
  it('creates three distinct grounded Arabic variants', () => {
    const result = generateMarketing(marketingExample)
    expect(result.mode).toBe('local')
    expect(result.variants).toHaveLength(3)
    expect(new Set(result.variants.map((variant) => variant.text)).size).toBe(3)
    for (const variant of result.variants) { expect(variant.text).toContain('نبتة'); expect(variant.text).toContain('#نبتة') }
  })
  it('supports English and professional tone', () => {
    const result = generateMarketing({ ...marketingExample, product: 'Nabta', audience: 'plant lovers', benefit: 'easy-care plants delivered to your door', language: 'en', tone: 'professional' })
    expect(result.variants[0].text).toContain('Get in touch')
    expect(result.variants[0].text).toContain('Nabta')
  })
  it('keeps every X variant within 280 UTF-16 characters, including hashtags', () => {
    for (let round = 0; round < 8; round++) {
      const result = generateMarketing({ ...marketingExample, product: 'ن'.repeat(80), benefit: 'ق'.repeat(400), platform: 'x' }, round)
      for (const variant of result.variants) expect(variant.text.length).toBeLessThanOrEqual(280)
    }
  })
  it('changes templates on regeneration and rejects missing fields', () => {
    expect(generateMarketing(marketingExample, 1).variants[0].text).not.toBe(generateMarketing(marketingExample).variants[0].text)
    expect(() => generateMarketing({ ...marketingExample, product: '  ' })).toThrow()
    expect(() => generateMarketing({ ...marketingExample, benefit: 'a'.repeat(401) })).toThrow()
  })
})

describe('extractive summary', () => {
  it('returns only original sentences, in original order', () => {
    const result = summarize({ text: summaryExample, language: 'ar', length: 'medium' })
    expect(result.mode).toBe('local')
    expect(result.keyPoints.length).toBeGreaterThan(0)
    expect(result.keyPoints.length).toBeLessThanOrEqual(4)
    for (const point of result.keyPoints) expect(summaryExample).toContain(point)
    expect(result.stats.reduction).toBeGreaterThan(0)
    expect(result.keywords.length).toBeGreaterThan(0)
    const indices = result.keyPoints.map((point) => summaryExample.indexOf(point))
    expect(indices).toEqual([...indices].sort((a, b) => a - b))
  })
  it('handles Arabic punctuation and English', () => {
    expect(splitSentences('هل هذا اختبار؟ نعم، هذا اختبار. النهاية!')).toHaveLength(3)
    const text = 'Teams benefit from clear priorities. Clear priorities reduce wasted effort across a project. Rest supports sustainable focus and reduces mistakes. Weekly reviews help the team improve its process. Small tools work best after responsibilities are agreed. Continuous improvement is more sustainable than replacing the entire process.'
    const result = summarize({ text, language: 'en', length: 'short' })
    expect(result.keyPoints.length).toBeLessThanOrEqual(2)
    expect(result.summary.length).toBeLessThan(text.length)
  })
  it('handles empty, short, over-limit, and single-sentence input', () => {
    expect(() => summarize({ text: '', language: 'ar', length: 'short' })).toThrow()
    expect(() => summarize({ text: 'a'.repeat(MAX_TEXT_LENGTH + 1), language: 'ar', length: 'short' })).toThrow()
    const text = 'هذه جملة واحدة طويلة enough words للاختبار '.repeat(5) + '.'
    expect(summarize({ text, language: 'ar', length: 'short' }).keyPoints).toHaveLength(1)
    expect(countWords('واحد اثنان three')).toBe(3)
    expect(countWords('  ')).toBe(0)
  })
})

describe('safe code analysis', () => {
  it('formats JSON without changing numeric precision, negative zero or duplicate keys', async () => {
    const source = '{"big":9007199254740993,"zero":-0,"dup":1,"dup":2,"escaped":"\\u0061"}'
    const result = await analyzeCode({ code: source, language: 'json' })
    expect(result.formatted).toContain('9007199254740993')
    expect(result.formatted).toContain('-0')
    expect(result.formatted?.match(/"dup"/g)).toHaveLength(2)
    expect(result.formatted).toContain('\\u0061')
    expect(JSON.parse(result.formatted!)).toEqual(JSON.parse(source))
  })
  it('finds real JavaScript issues without executing code', async () => {
    const result = await analyzeCode({ code: codeExamples.javascript, language: 'javascript' })
    expect(result.diagnostics.map((item) => item.rule)).toEqual(expect.arrayContaining(['prefer-block-scope', 'strict-equality', 'console-output']))
    expect(result.diagnostics.find((item) => item.rule === 'prefer-block-scope')?.line).toBe(3)
  })
  it('reports syntax positions', async () => {
    const result = await analyzeCode({ code: 'const x = ;', language: 'javascript' })
    expect(result.diagnostics[0].severity).toBe('error')
    expect(result.diagnostics[0].line).toBe(1)
  })
  it('parses TypeScript and JSX syntax', async () => {
    expect((await analyzeCode({ code: codeExamples.typescript, language: 'typescript' })).diagnostics).toHaveLength(0)
    expect((await analyzeCode({ code: 'const App = () => <div>Hello</div>;', language: 'javascript' })).diagnostics).toHaveLength(0)
  })
  it('does not report operators inside strings or comments', async () => {
    const result = await analyzeCode({ code: 'const text = "var x == y; debugger; eval(z)"; // var foo == bar', language: 'javascript' })
    expect(result.diagnostics).toHaveLength(0)
  })
  it('detects dynamic code, debugger and empty catch', async () => {
    const result = await analyzeCode({ code: 'debugger; eval("x"); new Function("x"); try {} catch(e) {}', language: 'javascript' })
    expect(result.diagnostics.map((item) => item.rule)).toEqual(expect.arrayContaining(['no-debugger', 'avoid-dynamic-code', 'handle-errors']))
  })
  it('formats valid JSON without evaluating it', async () => {
    const result = await analyzeCode({ code: codeExamples.json, language: 'json' })
    expect(result.diagnostics).toHaveLength(0)
    expect(JSON.parse(result.formatted!)).toEqual({ project: 'لك', language: 'ar', free: true, tools: ['marketing', 'summary', 'code'] })
  })
  it('reports malformed JSON', async () => {
    const result = await analyzeCode({ code: '{\n"x": nope\n}', language: 'json' })
    expect(result.diagnostics[0].severity).toBe('error')
    expect(result.formatted).toBeUndefined()
  })
  it('never strips spaces inside template literals', async () => {
    const code = 'const value = `line  \nnext`;'
    const result = await analyzeCode({ code, language: 'javascript' })
    expect(result.formatted).toBe(code + '\n')
    expect(result.formatted).toContain('line  \n')
  })
})

describe('local library', () => {
  it('ignores malformed or hostile storage data', () => {
    expect(parseSaved(null)).toEqual([])
    expect(parseSaved('bad json')).toEqual([])
    expect(parseSaved('{}')).toEqual([])
    expect(parseSaved('[{"id":"x","title":"x","content":"x","createdAt":"bad","tool":"code","mode":"local"}]')).toEqual([])
    expect(parseSaved('[{"id":"x","title":"x","content":"x","createdAt":"2026-01-01","tool":"unknown","mode":"local"}]')).toEqual([])
  })
  it('caps saved items and exports readable text', () => {
    const item = { id: 'x', title: 'فكرة', content: 'محتوى', createdAt: '2026-01-01', tool: 'code', mode: 'local' }
    expect(parseSaved(JSON.stringify(Array(70).fill(item)))).toHaveLength(50)
    expect(resultToText(generateMarketing(marketingExample))).toContain('نبتة')
    expect(STORAGE_KEY).toBe('lek.saved.v1')
  })
})
