#!/usr/bin/env node
/**
 * Unit economics for celia.sh.
 *
 * Every input below is either read from the repository constants or is an
 * explicit, dated, overridable assumption. Nothing is estimated silently: the
 * script prints its assumptions next to its conclusions so a reader can argue
 * with the assumption instead of with the output.
 *
 * The point of computing this in code rather than in prose is that prices move.
 * When they do, one number changes and the whole model recomputes, instead of a
 * document quietly going stale and someone pricing a product on last year's cost.
 *
 * Usage:
 *   node scripts/unit-economics.mjs
 *   node scripts/unit-economics.mjs --chars 4000 --subscribers 50
 */
import { readFileSync } from 'node:fs'

const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`)
  if (index === -1) return fallback
  const value = Number(process.argv[index + 1])
  return Number.isFinite(value) ? value : fallback
}

/* ---- Constants read from the repository, not typed by hand --------------- */

const source = (path) => readFileSync(path, 'utf8')
const match = (path, pattern, label) => {
  const found = pattern.exec(source(path))
  if (!found) {
    console.error(`unit_economics=failed reason=missing_constant ${label} in ${path}`)
    process.exit(1)
  }
  return Number(found[1])
}

const CLOUD_INPUT_CHARS = match('server/tools/summary.ts', /string\(input\.text, (\d+), 80\)/, 'cloud input limit')
const DEFAULT_MAX_TOKENS = match('server/ai.ts', /boundedInt\(env\.AI_MAX_TOKENS, (\d+),/, 'default max tokens')
const RATE_PER_MINUTE = match('server/ai.ts', /const PER_MINUTE = (\d+)/, 'per-minute limit')
const DAILY_LIMIT = match('server/ai.ts', /boundedInt\(env\.AI_DAILY_LIMIT, (\d+),/, 'daily limit')

/* ---- Assumptions (dated, and meant to be challenged) -------------------- */

export const ASSUMPTIONS = {
  // Groq gpt-oss-120b, verified 2026-11-08 from multiple public price trackers.
  // Re-check at https://console.groq.com/docs/pricing before committing to a price.
  pricePerMillionInput: 0.15,
  pricePerMillionOutput: 0.60,
  // Arabic tokenizes worse than English. ~2 characters per token is a
  // deliberately conservative planning figure; English is closer to 4.
  charsPerTokenArabic: 2,
  charsPerTokenEnglish: 4,
  // These are fixed in server/tools/*.ts and not negotiable per request.
  systemPromptTokens: 220,
  jsonSchemaOverheadTokens: 180,
}

/* ---- Core model --------------------------------------------------------- */

/**
 * Token count for a request. `charsPerToken` is the only thing that differs
 * between languages, and Arabic is the expensive case, so it is the default.
 */
export function tokensFor(chars, charsPerToken = ASSUMPTIONS.charsPerTokenArabic) {
  return Math.ceil(chars / charsPerToken) + ASSUMPTIONS.systemPromptTokens + ASSUMPTIONS.jsonSchemaOverheadTokens
}

/**
 * Cost of one request in USD.
 *
 * `outputTokens` defaults to the full completion budget, which is the honest
 * ceiling: a reasoning model may spend it even when the visible answer is short.
 */
export function costPerRequest({ chars, charsPerToken, outputTokens = DEFAULT_MAX_TOKENS }) {
  const input = tokensFor(chars, charsPerToken)
  const inputCost = (input * ASSUMPTIONS.pricePerMillionInput) / 1_000_000
  const outputCost = (outputTokens * ASSUMPTIONS.pricePerMillionOutput) / 1_000_000
  return { inputTokens: input, inputCost, outputCost, total: inputCost + outputCost }
}

/* ---- Report ------------------------------------------------------------- */

const scenarios = [
  { label: 'ملخص قصير (1,000 حرف)', chars: 1000 },
  { label: 'ملخص نموذجي (3,000 حرف)', chars: 3000 },
  { label: 'مراجعة كود (6,000 حرف)', chars: 6000 },
  { label: 'الحد الأقصى (12,000 حرف)', chars: CLOUD_INPUT_CHARS },
]

const usd = (value) => `$${value.toFixed(5)}`
const usd4 = (value) => `$${value.toFixed(4)}`

const lines = []
const push = (line = '') => lines.push(line)

push('## اقتصاد الوحدة — celia.sh')
push('')
push('> محسوب من ثوابت المستودع. الأسعار والافتراضات مؤرخة، وأي تغيير فيها يُعاد حسابه هنا لا في وثيقة.')
push('')
push('### استُخرجت من الكود')
push('')
push('| الثابت | القيمة | المصدر |')
push('| --- | --- | --- |')
push(`| حد الإدخال السحابي | ${CLOUD_INPUT_CHARS.toLocaleString('en')} حرف | \`server/tools/summary.ts\` |`)
push(`| ميزانية الإكمال | ${DEFAULT_MAX_TOKENS} توكن | \`server/ai.ts\` |`)
push(`| حد المعدل | ${RATE_PER_MINUTE} طلب/دقيقة | \`server/ai.ts\` |`)
push(`| السقف اليومي الافتراضي | ${DAILY_LIMIT} طلب/نشر | \`server/ai.ts\` |`)
push('')
push('### افتراضات مؤرخة 2026-11-08')
push('')
push('| الافتراض | القيمة | ملاحظة |')
push('| --- | --- | --- |')
push(`| سعر الإدخال | $${ASSUMPTIONS.pricePerMillionInput}/مليون | gpt-oss-120b |`)
push(`| سعر الإخراج | $${ASSUMPTIONS.pricePerMillionOutput}/مليون | gpt-oss-120b |`)
push(`| حرف/توكن عربي | ${ASSUMPTIONS.charsPerTokenArabic} | تقدير متحفظ؛ الإنجليزية ~4 |`)
push(`| ثابت البرومبت | ${ASSUMPTIONS.systemPromptTokens + ASSUMPTIONS.jsonSchemaOverheadTokens} توكن | يضاف لكل طلب |`)
push('')
push('### تكلفة الطلب الواحد')
push('')
push('| السيناريو | توكن إدخال | إدخال | إخراج (بأقصى ميزانية) | **الإجمالي** |')
push('| --- | --- | --- | --- | --- |')
for (const scenario of scenarios) {
  const cost = costPerRequest({ chars: scenario.chars })
  push(`| ${scenario.label} | ${cost.inputTokens.toLocaleString('en')} | ${usd(cost.inputCost)} | ${usd(cost.outputCost)} | **${usd4(cost.total)}** |`)
}
push('')

/* Volume analysis: what a subscriber actually costs per month. */
const monthly = (requestsPerMonth, chars) => costPerRequest({ chars }).total * requestsPerMonth
const heavy = monthly(300, 3000)
const light = monthly(40, 1500)

push('### تكلفة المشترك شهريًا')
push('')
push('| الملف | طلبات/شهر | متوسط الطول | التكلفة |')
push('| --- | --- | --- | --- |')
push(`| خفيف | 40 | 1,500 حرف | ${usd4(light)} |`)
push(`| متوسط | 150 | 3,000 حرف | ${usd4(monthly(150, 3000))} |`)
push(`| ثقيل | 300 | 3,000 حرف | ${usd4(heavy)} |`)
push('')

/* Fixed cost floor. These are planning figures, not quotes. */
const FIXED = {
  vercelPro: arg('vercel', 20),
  domain: arg('domain', 1),
  paymentsPercent: 5,
  paymentsFixed: 0.5,
}
const fixedTotal = FIXED.vercelPro + FIXED.domain

const subscribers = arg('subscribers', 25)
const price = arg('price', 4)
const includedRequests = arg('requests', 300)

const aiCostPerSubscriber = monthly(includedRequests, 3000)
const grossPerSubscriber = price
const paymentFee = (grossPerSubscriber * FIXED.paymentsPercent) / 100 + FIXED.paymentsFixed
const netPerSubscriber = grossPerSubscriber - paymentFee - aiCostPerSubscriber
const breakEven = netPerSubscriber > 0 ? Math.ceil(fixedTotal / netPerSubscriber) : Infinity

push('### هيكل التكلفة الثابتة (تقديرات تخطيط)')
push('')
push('| البند | $/شهر | ملاحظة |')
push('| --- | --- | --- |')
push(`| Vercel Pro | ${FIXED.vercelPro} | Hobby **غير تجاري**؛ يلزم Pro قبل أي بيع |`)
push(`| نطاق | ${FIXED.domain} | ~$12/سنة |`)
push(`| **الإجمالي** | **${fixedTotal}** | |`)
push('')
push('### الاشتراك المقترح')
push('')
push(`- السعر: **$${price}/شهر** | يتضمن **${includedRequests}** طلب ذكاء اصطناعي.`)
push(`- تكلفة الذكاء الاصطناعي للمشترك: **${usd4(aiCostPerSubscriber)}**.`)
push(`- رسوم الدفع (5% + $0.50): **${usd4(paymentFee)}**.`)
push(`- الصافي لكل مشترك: **${usd4(netPerSubscriber)}**.`)
push(`- عدد المشتركين للتعادل: **${Number.isFinite(breakEven) ? breakEven : 'غير قابل للتعادل'}** على ${subscribers} مستهدفين.`)
push('')
push(`عند **${subscribers}** مشتركًا: إيراد شهري ${usd4(subscribers * price)}، وتكلفة ذكاء اصطناعي ${usd4(subscribers * aiCostPerSubscriber)}، وصافي تقديري **${usd4(subscribers * netPerSubscriber - fixedTotal)}**.`)
push('')

/* The provider's own limits are a harder ceiling than our price. */
push('### سقف المزوّد أقسى من سقف السعر')
push('')
const worst = costPerRequest({ chars: CLOUD_INPUT_CHARS })
push(`طلب واحد عند الحد الأقصى (${CLOUD_INPUT_CHARS.toLocaleString('en')} حرف) يستهلك ~**${worst.inputTokens.toLocaleString('en')}** توكن إدخال.`)
push('الخطة المجانية لدى Groq تسمح بـ 8,000 توكن/دقيقة لهذا النموذج، أي أن **طلبًا ثقيلًا واحدًا يشبع دقيقة كاملة للحساب كله**.')
push('هذا يعني: الحد العملي اليوم ليس السعر ولا الكود، بل الحصة. أي خطة تسعير تفترض أكثر من بضعة مستخدمين متزامنين تحتاج طبقة مدفوعة لدى المزوّد أولًا.')
push('')

/* Sensitivity: the two inputs most likely to be wrong. */
push('### حساسية (أين ينكسر النموذج)')
push('')
push('| المتغير | التغيير | أثره |')
push('| --- | --- | --- |')
const base3000 = costPerRequest({ chars: 3000 })
const doubled = base3000.total * 2
push(`| سعر المزوّد | ×2 | تكلفة الطلب تصبح ${usd4(doubled)}؛ هامش المشترك ينخفض لكنه يبقى موجبًا |`)
push(`| طول الإدخال | من 3,000 إلى ${CLOUD_INPUT_CHARS.toLocaleString('en')} حرف | ${usd4(costPerRequest({ chars: 3000 }).total)} → ${usd4(worst.total)} (+${Math.round((worst.total / costPerRequest({ chars: 3000 }).total - 1) * 100)}%) |`)
push('| الفشل في تقييد الحصة | طلب واحد متكرر من مستخدم واحد | يستنزف الحصة دون إيراد؛ لهذا الحصة المركزية شرط لا تحسين |')
push('')

process.stdout.write(`${lines.join('\n')}\n`)

export const MODEL = { CLOUD_INPUT_CHARS, DEFAULT_MAX_TOKENS, RATE_PER_MINUTE, DAILY_LIMIT, FIXED }
