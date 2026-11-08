<div dir="rtl">

# لك. — celia.sh

**أدوات صغيرة. إمكانات كبيرة.** مساحة عربية RTL تجمع ثلاث أدوات عملية في تطبيق واحد خفيف، مع وضع محلي يعمل دون حساب أو مفتاح API أو بطاقة ائتمان.

> إصدار أول قابل للتشغيل والتطوير. الأدوات المحلية منفّذة فعلياً. وضع Groq اختياري ويحتاج مفتاحاً صالحاً على الخادم واختبار اتصال حقيقياً قبل إتاحته للجمهور. لا توجد مدفوعات أو اشتراكات أو أرباح مفعّلة.

## ما الذي يعمل الآن؟

| الأداة | الوضع المحلي المجاني | وضع Groq الاختياري |
| --- | --- | --- |
| مولّد المحتوى | ثلاث مسودات من قوالب تحريرية حسب المنتج والجمهور والمنصة والنبرة، بالعربية أو الإنجليزية | توليد نصوص باستخدام نموذج لغوي |
| ملخّص النصوص | تلخيص استخلاصي يختار جملاً من النص، مع نقاط وكلمات متكررة وإحصاءات؛ ليس مولّداً لغوياً | ملخص مولّد ونقاط رئيسية |
| فاحص الأكواد | فحص صياغة JavaScript / JSX / TypeScript، وفحص JSON، وملاحظات إرشادية؛ لا ينفّذ الكود | مراجعة نصية ساكنة مع توضيح حدودها |

يتضمن التطبيق أمثلة جاهزة، رفع TXT/MD وملفات كود، نسخاً وتنزيلاً، مكتبة محلية للبحث والتصفية والحذف، وضعاً داكناً، بحثاً سريعاً بـ `Ctrl/Cmd + K`، وتصميماً متجاوباً يدعم لوحة المفاتيح وتقليل الحركة.

**حدود مهمة:** فحص TypeScript ليس فحص أنواع، وفحص الكود ليس تدقيقاً أمنياً. التلخيص الاستخلاصي لا يترجم. قراءة PDF وWord غير مدعومة؛ انسخ نصهما إلى الأداة. الحد المحلي 20,000 حرف، والسحابي 12,000 حرف للنص أو الكود.

## ابدأ على جهازك

المتطلبات: Node.js 22.12 أو أحدث (الإصدار المثبّت في `.nvmrc`)، وnpm. استخدم `nvm use` ليقرأ الملف تلقائياً.

</div>

```bash
npm ci
npm run dev -- --port 5173
```

<div dir="rtl">

افتح العنوان الذي يطبعه Vite. لا تحتاج ملف `.env` لتشغيل الأدوات المحلية. الخادم يستمع إلى `0.0.0.0` لدعم معاينة Arena، ويسمح بمضيف `*.e2b.app`.

### أوامر الجودة

</div>

```bash
npm run lint             # ESLint
npm test                 # Vitest + Testing Library
npm run build            # TypeScript + production build -> dist/
npm run check            # lint + tests + build
npm run preview          # Preview the production build
npm run test:browser     # Real Chromium + accessibility checks (install browser first)
npm run test:smoke -- URL # Post-deploy check of a published site
npm run check:build      # Assert dist/ is complete and within Pages limits
npm audit --audit-level=high
```

<div dir="rtl">

## النشر بدون دفع أو بطاقة

### GitHub Pages: مناسب للأدوات المحلية

- المستودع الحالي عام. سير العمل `.github/workflows/ci.yml` يفحص المشروع على الفرع الحالي وعلى طلبات الدمج، وينشر بعد دمج التغيير في `main`.
- فعّل **Settings → Pages → Build and deployment → Source → GitHub Actions** مرة واحدة. لا ترفع `node_modules` أو `dist` إلى Git؛ ملف ignore يستبعدهما.
- المسارات النسبية وhash routing يدعمان أي مسار فرعي أو نطاقاً مخصصاً. لا يوجد اسم مستودع مكتوب في كود التطبيق.
- هوية الموقع (العنوان، canonical، رابط المستودع، `base`) تُحقن وقت البناء من سياق GitHub. راجع [docs/RENAMING.md](docs/RENAMING.md) لتغيير الاسم أو النطاق دون تعديل كود.
- الأدوات المحلية تعمل على Pages. مسارات `/api/*` ليست وظائف خادم على Pages، لذلك يظهر وضع الذكاء الاصطناعي كغير مهيّأ.
- تشغيلات runners القياسية في المستودعات العامة مجانية وفق سياسة GitHub وحصصها. راجع الفوترة إذا أصبح المستودع خاصاً.

لا تكرر `git init` ولا تضف remote آخر فوق المستودع الحالي. اعمل على الفرع المخصص، وادمجه عبر pull request بعد المراجعة.

### Vercel: يدعم الواجهة ووظائف API

1. اربط المستودع نفسه بمشروع Vercel بإعداد **Vite**. يحدد `vercel.json` أمر البناء `npm run build` ومجلد الإخراج `dist`.
2. أضف متغيرات البيئة التالية في إعدادات الخادم، ثم أعد النشر.
3. اختبر `/api/v1/status` وطلباً حقيقياً صغيراً، وراقب استهلاك الحصة قبل مشاركة الرابط. عقد API موثّق في [docs/API.md](docs/API.md).

**تنبيه تجاري:** خطة Hobby للاستخدام الشخصي غير التجاري وفق سياسة Vercel. الإعلانات والروابط الربحية الأساسية وبيع الخدمات قد تستلزم خطة مدفوعة. طلب التبرعات وحده لا يقع ضمن الاستخدام التجاري في السياسة التي روجعت. المجانية لا تعني السماح التجاري بلا قيود.

## تفعيل الذكاء الاصطناعي بأمان

انسخ `.env.example` إلى `.env` للتطوير المحلي فقط، واملأ القيم:

</div>

```dotenv
GROQ_API_KEY=your_server_only_provider_key
GROQ_MODEL=openai/gpt-oss-120b
AI_ACCESS_CODE=your_random_application_access_code_12_chars_or_more
AI_DAILY_LIMIT=40
AI_ALLOWED_ORIGINS=
```

<div dir="rtl">

- `GROQ_API_KEY`: مفتاح المزوّد. يبقى على الخادم ويرسل فقط إلى عنوان Groq الثابت. **لا تستخدم بادئة `VITE_` ولا تضعه في الواجهة أو المستودع.**
- `AI_ACCESS_CODE`: رمز مختلف عن مفتاح API، بطول 12–200 حرف. يحدده المالك ويشاركه مع المستخدمين المسموح لهم. تدخله الواجهة في الإعدادات ويحفظ في ذاكرة الجلسة فقط، لا localStorage. تتحقق الخادم من صحته عند إرسال طلب.
- `GROQ_MODEL`: نموذج متاح لحسابك ويدعم JSON. تحقق من التوثيق والحصص؛ لا نفترض توفر نموذج أو حصة مجانية للجميع إلى الأبد.
- `AI_ALLOWED_ORIGINS`: أصول مسموحة صراحةً إن كان الوسيط على نطاق مختلف، مفصولة بفواصل. فارغة تعني نفس الأصل فقط. CORS ليس حماية؛ رمز الوصول وحدود الطلبات هي الحماية.
- `AI_DAILY_LIMIT`: سقف احترازي يومي لكل نسخة خادم عاملة، وحد ستة طلبات في الدقيقة لكل عميل. عدادات الذاكرة **ليست حصة موزعة أو نظام فوترة**؛ تُصفّر عند إعادة التشغيل وقد تتعدد عبر نسخ serverless. قبل فتح الخدمة للجمهور، أضف حصة مركزية ومراقبة ومصادقة مناسبة.
- الطلب السحابي يحتاج موافقة صريحة على إرسال النص. لا ترسل المدخلات في الوضع المحلي. راجع سياسة المزوّد قبل إدخال معلومات حساسة.

لا توجد مفاتيح حقيقية في المستودع. اختبار Groq الحي من GitHub Actions نجح بمفتاح المالك (`reason=ok`) بعد ضبط ميزانية الإكمال لنماذج الاستدلال. اختبارات الخادم في المستودع تستخدم اتصالاً وهمياً وتتحقق من المسار والترويسات والأخطاء والحدود. راجع [docs/OPERATIONS.md](docs/OPERATIONS.md).

## الخصوصية وحدود المجانية

- لا تحليلات أو إعلانات أو تتبع مضاف في التطبيق. الخطوط والحزم تقدم من بناء الموقع، لا من Google Fonts.
- المدخلات غير المحفوظة تبقى في ذاكرة الواجهة. المكتبة تحفظ فقط ما يختاره المستخدم في localStorage، بحد 50 نتيجة. مسح بيانات المتصفح يمسحها؛ نزّل النتائج المهمة.
- يُحفظ تفضيل المظهر في localStorage. لا يحفظ رمز التطبيق هناك. قد يحتفظ مضيف النشر بسجلات طلبات تقنية وفق سياسته.
- معالجة الأدوات المحلية لا تحتاج مزوّد AI. تحميل موارد الواجهة وأول استخدام لمحلل الكود يحتاجان اتصالاً لتنزيل الملفات. التطبيق **ليس PWA مثبتة** ولا يعد بإقلاع كامل دون إنترنت.
- مجاني هنا يعني عدم اشتراط دفع لتشغيل البناء والأدوات المحلية. للاستضافة والمزوّدات شروط وحصص قابلة للتغيير، وقد يختلف توفر الحسابات حسب البلد وقد تلزم بطاقة عند التوسع. لم ننشئ حسابات نيابة عنك.

## مسار مقترح للربح

1. أطلق النسخة المحلية واجمع ملاحظات فعلية بموافقة المستخدمين.
2. طور أكثر الأدوات استخداماً، وأضف قيمة متخصصة تستحق الدفع.
3. اختر تبرعات شفافة أو رعاية أو اشتراكاً. أضف روابط حساباتك الحقيقية فقط بعد إنشائها.
4. قبل الاشتراكات: ابنِ حسابات ومصادقة وحصة مركزية وفوترة وسياسة استرداد وخصوصية ومراقبة تكلفة الطلب. راجع الضرائب والمدفوعات وشروط الاستضافة في بلدك.

هذا مسار مقترح، ليس وعداً بدخل. لا توجد أزرار دفع أو إعلانات أو روابط عمولة وهمية في هذا الإصدار.

## البنية

</div>

```text
src/
  tools/          Tool registry: one entry per tool, drives nav/search/cards
  pages/          Dashboard, tool pages, library, settings, guide
  components/     RTL shell, dialogs, result actions, original CSS hero art
  hooks/          Request lifecycle, cancellation and consent
  lib/            Local engines, storage, downloads, resolved site identity
shared/           Tool ids, versioned API contract, hosting identity
server/
  tools/          Per-tool validation, prompt and post-processing
  providers/      Provider adapters (Groq today), swappable server-side
  ai.ts           Generic proxy: limits, validation, error mapping
api/v1/           Versioned Vercel Node function adapters
config/           Build-time identity injection and CNAME emission
scripts/          Post-deploy smoke test, repository secret guard
tests/            Engines, UI workflows, server security, hosting identity
.github/workflows CI, deploy, post-deploy verification, live Groq smoke
```

<div dir="rtl">

التقنيات: React 19، TypeScript، Vite، Tailwind CSS 4، Lucide، Babel parser، Vitest وTesting Library. الخطان IBM Plex Sans Arabic وManrope يأتيان عبر Fontsource ويحتفظ كل منهما بترخيصه. رخصة كود المشروع: MIT.

### كيف تضيف أداة دون تعديل النواة

أضف المعرّف في `shared/tools.ts`، أنشئ وحدة في `server/tools/` وصفحة في `src/pages/`، ثم سجّل كلاً منهما بسطر واحد في سجلّي الأدوات. التنقل والبحث والتوجيه وبطاقات الرئيسية ومرشّحات المكتبة مشتقة من السجل تلقائياً. التفاصيل في [docs/API.md](docs/API.md).

راجع [SECURITY.md](SECURITY.md) للحدود الأمنية وطريقة الإبلاغ عن الثغرات، و[docs/QUALITY.md](docs/QUALITY.md) لتفاصيل الاختبارات وقائمة ما قبل الإطلاق، و[docs/OPERATIONS.md](docs/OPERATIONS.md) لتدوير المفاتيح واختبار Groq الحي، و[docs/API.md](docs/API.md) لعقد API، و[docs/RENAMING.md](docs/RENAMING.md) لتغيير الاسم أو النطاق (نُفّذت التسمية إلى `celia.sh` في 8 نوفمبر 2026)، و[docs/FREE-TIERS.md](docs/FREE-TIERS.md) للحصص المجانية المتحقَّق منها بالأرقام ومصادرها.

الصيانة الذاتية موثّقة كمواصفة قابلة للتحقق في [docs/SELF-MAINTAINING.md](docs/SELF-MAINTAINING.md): ستة مجالات (اختبارات، اعتماديات، جودة، توثيق، صحة تشغيلية، تعافي) ودورة `Observe → Diagnose → Propose → Validate → Approve → Apply → Verify`، مع حالة صريحة `done/partial/planned` وإثبات لكل بند. الأوامر التشغيلية في [docs/RUNBOOK.md](docs/RUNBOOK.md)، والتغييرات في [CHANGELOG.md](CHANGELOG.md).

الهوية البصرية وطبقة الموشن وقواعد التباين موثّقة في [docs/DESIGN.md](docs/DESIGN.md).

تدقيق سمات 2026 مقابل الكود فعلياً — ما طُبّق وما رُفض ولماذا — في [docs/FRONTEND-2026.md](docs/FRONTEND-2026.md). لتشغيل اختبارات المتصفح لأول مرة: `npx playwright install chromium`.

## مراجع رسمية تمت مراجعتها في 8 نوفمبر 2026

- [فوترة GitHub Actions](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
- [إعداد مصدر نشر GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
- [سياسة الاستخدام التجاري لدى Vercel](https://vercel.com/docs/limits/fair-use-guidelines#commercial-usage)
- [حدود طلبات Groq](https://console.groq.com/docs/rate-limits)
- [إعادة تسمية مستودع وما يتحول تلقائياً](https://docs.github.com/en/repositories/creating-and-managing-repositories/renaming-a-repository)
- [حدود GitHub Pages والاستخدام التجاري](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)
- [الحصص المضمّنة في كل خطة](https://docs.github.com/en/billing/reference/product-usage-included)
- [الميزانيات ومنع التجاوز](https://docs.github.com/en/billing/how-tos/set-up-budgets)

قد تتغير هذه السياسات؛ راجعها قبل النشر التجاري أو شراء حصة.

</div>
