import type { CodeInput, CodeLanguage, CodeResult, Diagnostic } from '../../shared/types'

export const MAX_CODE_LENGTH = 20000
export const codeExamples: Record<CodeLanguage, string> = {
  javascript: `// جرّب الفحص: ابحث عن فرص التحسين\nfunction greet(user) {\n  var message = "مرحباً، " + user.name;\n  if (user.role == "admin") {\n    console.log(message);\n  }\n  return message;\n}\n\ngreet({ name: "سارة", role: "admin" });`,
  typescript: `type User = {\n  name: string;\n  active: boolean;\n};\n\nfunction welcome(user: User): string {\n  const message = \`أهلاً \${user.name}\`;\n  return message;\n}\n\nwelcome({ name: 'سارة', active: true });`,
  json: `{"project":"لك","language":"ar","free":true,"tools":["marketing","summary","code"]}`,
}

interface SyntaxErrorLike { message: string; loc?: { line: number; column: number }; code?: string; reason?: string }
interface NodeLike {
  type?: string
  loc?: { start: { line: number; column: number } }
  kind?: string
  operator?: string
  body?: NodeLike[] | NodeLike
  block?: NodeLike
  callee?: NodeLike
  object?: NodeLike
  property?: NodeLike
  name?: string
  computed?: boolean
  [key: string]: unknown
}

function formatJsonLossless(source: string): string {
  // JSON.parse validates first; format tokens without numeric conversion so
  // large integers, -0, duplicate keys and escape sequences remain intact.
  const tokens = source.match(/"(?:\\.|[^"\\])*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|[{}[\],:]/g) ?? []
  let output = ''
  let depth = 0
  const newline = () => { output += `\n${'  '.repeat(depth)}` }
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]
    if (token === '{' || token === '[') {
      output += token
      if (tokens[index + 1] === (token === '{' ? '}' : ']')) output += tokens[++index]
      else { depth++; newline() }
    } else if (token === '}' || token === ']') { depth--; newline(); output += token }
    else if (token === ',') { output += token; newline() }
    else if (token === ':') output += ': '
    else output += token
  }
  return output
}

export async function analyzeCode(input: CodeInput): Promise<CodeResult> {
  if (!input.code.trim()) throw new Error('الصق بعض الكود أو استخدم المثال للبدء.')
  if (input.code.length > MAX_CODE_LENGTH) throw new Error('الحد الأقصى 20,000 حرف للكود.')
  const diagnostics: Diagnostic[] = []
  const suggestions: string[] = []
  let formatted: string | undefined
  if (input.language === 'json') {
    try {
      JSON.parse(input.code)
      formatted = formatJsonLossless(input.code)
      suggestions.push('JSON صالح. يمكنك نسخ النسخة المنسّقة بمسافتين لكل مستوى.')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'JSON غير صالح.'
      const position = /position (\d+)/i.exec(message)?.[1]
      const linePosition = /line (\d+) column (\d+)/i.exec(message)
      let line = linePosition ? Number(linePosition[1]) : 1
      let column = linePosition ? Number(linePosition[2]) : 1
      if (position) {
        const before = input.code.slice(0, Number(position))
        line = before.split('\n').length
        column = before.length - before.lastIndexOf('\n')
      }
      diagnostics.push({ line, column, severity: 'error', message: 'صيغة JSON غير صالحة. تحقق من الفواصل وعلامات الاقتباس المزدوجة والأقواس.', rule: 'json-syntax' })
    }
    return { mode: 'local', diagnostics, suggestions, formatted, note: 'تحقق من بنية JSON وتنسيقه محلياً. لا يتم تشغيل أي كود.' }
  }

  try {
    const { parse } = await import('@babel/parser')
    const ast = parse(input.code, {
      sourceType: 'unambiguous',
      allowReturnOutsideFunction: true,
      allowAwaitOutsideFunction: true,
      plugins: input.language === 'typescript' ? ['typescript', 'jsx'] : ['jsx'],
      tokens: true,
      ranges: true,
    }) as unknown as NodeLike
    const seen = new WeakSet<object>()
    function visit(node: NodeLike) {
      if (!node || typeof node !== 'object' || seen.has(node)) return
      seen.add(node)
      const start = node.loc?.start
      const add = (severity: Diagnostic['severity'], message: string, rule: string) => diagnostics.push({ line: start?.line ?? 1, column: (start?.column ?? 0) + 1, severity, message, rule })
      if (node.type === 'VariableDeclaration' && node.kind === 'var') add('warning', 'استخدم let أو const بدلاً من var لتقليل مشاكل نطاق المتغير.', 'prefer-block-scope')
      if (node.type === 'BinaryExpression' && (node.operator === '==' || node.operator === '!=')) add('warning', 'المقارنة غير الصارمة قد تحوّل نوع القيمة. راجع استخدام === أو !== مع الانتباه لدلالة null وundefined.', 'strict-equality')
      if (node.type === 'DebuggerStatement') add('warning', 'احذف debugger قبل مشاركة الكود أو نشره.', 'no-debugger')
      if (node.type === 'CatchClause') {
        const catchBody = node.body as NodeLike | undefined
        if (Array.isArray(catchBody?.body) && catchBody.body.length === 0) add('warning', 'كتلة catch فارغة تخفي الأخطاء. سجّل الخطأ أو عالجه بشكل مناسب.', 'handle-errors')
      }
      if (node.type === 'NewExpression' && node.callee?.type === 'Identifier' && node.callee.name === 'Function') add('warning', 'إنشاء دالة من نص قد يسمح بحقن الكود. استخدم مدخلات محددة وبديلاً آمناً.', 'avoid-dynamic-code')
      if (node.type === 'CallExpression') {
        const callee = node.callee
        if (callee?.type === 'MemberExpression' && callee.object?.name === 'console' && ['log', 'debug'].includes(callee.property?.name ?? '')) add('info', 'راجع رسائل التصحيح قبل النشر؛ لا تسجّل بيانات حساسة.', 'console-output')
        if (callee?.name === 'eval') add('warning', 'تنفيذ النصوص ككود قد يفتح ثغرة حقن. استخدم بديلاً آمناً وحدد المدخلات.', 'avoid-dynamic-code')
      }
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) { for (const child of value) if (child && typeof child === 'object' && 'type' in child) visit(child as NodeLike) }
        else if (value && typeof value === 'object' && 'type' in value) visit(value as NodeLike)
      }
    }
    visit(ast)
    for (const comment of ast.comments as NodeLike[] | undefined ?? []) {
      if (typeof comment.value === 'string' && /\b(TODO|FIXME)\b/.test(comment.value)) diagnostics.push({ line: comment.loc?.start.line ?? 1, column: (comment.loc?.start.column ?? 0) + 1, severity: 'info', message: 'مهمة معلّقة في تعليق. راجعها قبل تسليم العمل.', rule: 'todo-comment' })
    }
    if (!diagnostics.some((item) => item.severity === 'error')) suggestions.push(input.language === 'typescript' ? 'اجتاز الكود فحص الصياغة. هذا ليس فحص أنواع TypeScript؛ شغّل tsc للتحقق من الأنواع.' : 'اجتاز الكود فحص الصياغة. شغّل اختبارات الوحدة للتحقق من السلوك قبل النشر.')
  } catch (error) {
    const problem = error as SyntaxErrorLike
    diagnostics.push({ line: problem.loc?.line ?? 1, column: (problem.loc?.column ?? 0) + 1, severity: 'error', message: `خطأ في الصياغة: ${problem.message}`, rule: 'syntax' })
    suggestions.push('أصلح خطأ الصياغة ثم أعد الفحص. تظهر رسالة المحلل الأصلية لتحديد الموضع.')
  }
  const trimmed = input.code.endsWith('\n') ? input.code : input.code + '\n'
  if (trimmed !== input.code) {
    formatted = trimmed
    suggestions.push('النسخة الآمنة تضيف سطراً نهائياً فقط إن كان مفقوداً؛ لا تغيّر محتوى النصوص أو المنطق.')
  }
  return { mode: 'local', diagnostics: diagnostics.sort((a, b) => a.line - b.line), suggestions, formatted, note: 'فحص صياغة وقواعد إرشادية محلية، وليس تشغيلاً للكود أو تدقيقاً أمنياً شاملاً.' }
}
