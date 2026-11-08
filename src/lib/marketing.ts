import type { MarketingInput, MarketingResult } from '../../shared/types'

export const marketingExample: MarketingInput = {
  product: 'نبتة',
  audience: 'أصحاب المساحات الصغيرة ومحبي النباتات',
  benefit: 'نباتات داخلية سهلة العناية، تصل إلى بابك مع دليل بسيط للعناية بها',
  platform: 'instagram',
  tone: 'friendly',
  language: 'ar',
}

const arabicHooks = [
  ['فكرتك أقرب للواقع.', 'القليل من التفاصيل يصنع فرقاً كبيراً.'],
  ['فكرتك تستحق بداية أفضل.', 'أحياناً، كل ما تحتاجه هو خطوة بسيطة.'],
  ['شيء جميل ليومك.', 'خلّي يومك ألطف، وأسهل.'],
]

export function generateMarketing(input: MarketingInput, round = 0): MarketingResult {
  const product = input.product.trim()
  const audience = input.audience.trim()
  const benefit = input.benefit.trim()
  if (!product || !audience || !benefit) throw new Error('أضف اسم المنتج والجمهور والميزة الأساسية أولاً.')
  if (product.length > 80 || audience.length > 160 || benefit.length > 400) throw new Error('يرجى الالتزام بحدود الحقول.')
  const english = input.language === 'en'
  const tag = product.replace(/[^\p{L}\p{N}]/gu, '_').replace(/_+/g, '_').replace(/^_|_$/g, '')
  const safeTag = tag || (english ? 'ForYou' : 'لك')
  const platformTag = input.platform === 'linkedin' ? '#أعمال' : input.platform === 'x' ? '#أفكار' : '#اكتشف_المزيد'
  const hashtags = english ? `#${safeTag} #MadeForYou` : `#${safeTag} ${platformTag}`
  const offset = ((round % 3) + 3) % 3
  const texts = english ? makeEnglish(input, product, audience, benefit, offset) : makeArabic(input, product, audience, benefit, offset)
  const labels = english ? ['Story-led', 'Benefit-first', 'Conversation starter'] : ['ابدأ بقصة', 'ركّز على القيمة', 'افتح حواراً']
  return {
    mode: 'local',
    variants: texts.map((text, i) => {
      let body = text
      if (input.platform === 'x') {
        const limit = 280 - hashtags.length - 2
        const suffix = english ? '… Discover more.' : '… اكتشف المزيد.'
        if (body.length > limit) body = `${product} — ${benefit.slice(0, Math.max(0, limit - product.length - 3 - suffix.length))}${suffix}`
        if (body.length > limit) body = body.slice(0, limit)
      }
      return { id: `v-${round}-${i}`, label: labels[i], text: `${body}\n\n${hashtags}` }
    }),
  }
}

function makeArabic(input: MarketingInput, product: string, audience: string, benefit: string, round: number): string[] {
  const hooks = arabicHooks.map((pair, i) => pair[(i + round) % 2])
  hooks[0] = round % 2 === 0 ? `مع ${product}، فكرتك أقرب للواقع.` : `${product} يستحق أن يكون جزءاً من يومك.`
  const cta = input.tone === 'professional' ? 'تواصل معنا لمعرفة التفاصيل.' : input.tone === 'bold' ? 'لا تؤجل فكرتك. جرّبها اليوم!' : 'أخبرنا، هل جرّبت شيئاً مشابهاً؟'
  const intro = input.tone === 'professional' ? `نقدّم ${product}، مصمماً خصيصاً لـ${audience}.` : input.tone === 'bold' ? `حان وقت التغيير مع ${product}!` : `إذا كنت من ${audience}، فهذا لك.`
  return [
    `${hooks[0]}\n\n${intro}\n${benefit}.\n\n${cta}`,
    `${product} ✨\n\nلماذا؟ لأن ${benefit}.\n\nاختيار يناسب ${audience}. تفاصيل أقل تعقيداً، وتجربة تستحق الاكتشاف.\n\n${cta}`,
    `${hooks[2]}\n\nما أكثر شيء يهمّك عندما تختار منتجاً لـ${audience}؟\n\nفي ${product} نركّز على شيء واحد: ${benefit}.\n\nشاركنا رأيك، ثم اكتشف التفاصيل.`,
  ]
}

function makeEnglish(input: MarketingInput, product: string, audience: string, benefit: string, round: number): string[] {
  const hooks = ['Small details. A meaningful difference.', `Meet ${product}. Made with you in mind.`, 'A little inspiration for your everyday.']
  const cta = input.tone === 'professional' ? 'Get in touch to learn more.' : input.tone === 'bold' ? 'Make your next move. Try it today!' : 'What matters most to you? Let’s talk.'
  return [
    `${hooks[round % 3]}\n\nFor ${audience}: ${product}.\n${benefit}.\n\n${cta}`,
    `${product} ✨\n\nThe idea is simple: ${benefit}.\nThoughtfully made for ${audience}.\n\n${cta}`,
    `Here’s a question for ${audience}: what would make your day a little better?\n\nWith ${product}, we focus on ${benefit}.\n\n${cta}`,
  ]
}
