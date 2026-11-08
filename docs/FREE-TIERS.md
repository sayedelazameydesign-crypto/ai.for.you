<div dir="rtl">

# الحصص المجانية: أرقام متحقَّق منها

روجعت هذه الأرقام في **8 نوفمبر 2026** من توثيق GitHub الرسمي مباشرة. كثير من الملخّصات المتداولة تخلط بين أرقام قديمة وأرقام منتجات مختلفة. هذا الملف يسجّل ما تحقق فعلاً، ومصدره.

> القاعدة: لا تعتمد رقماً من مقال. افتح صفحة التوثيق الرسمية قبل أي قرار مالي.

## 1. تصحيحات لأرقام شائعة خاطئة

| الرقم الشائع | الصحيح | المصدر |
| --- | --- | --- |
| «Actions Free = 2,000 دقيقة» أو «3,000 دقيقة» | لا توجد حصة دقائق أصلاً. النص الرسمي: **$12 USD included compute usage شهرياً** لخطة Free. الدقائق تُحسب من هذا المبلغ بسعر كل runner | [product-usage-included](https://docs.github.com/en/billing/reference/product-usage-included) |
| «Git LFS = 1 GB تخزين + 1 GB bandwidth» | **10 GiB تخزين + 10 GiB bandwidth** على Free. رقم 1 GB هو **data transfer لـ Packages**، منتج مختلف تماماً | [git-lfs billing](https://docs.github.com/en/billing/concepts/product-billing/git-lfs) |
| «self-hosted runners عليها رسم $0.002/دقيقة من مارس 2026» | **لم يُطبَّق.** أُعلن في 16 ديسمبر 2025 ثم أُجّل خلال يومين بعد اعتراض المجتمع. التوثيق الرسمي ينص أن self-hosted **مجاني ولا يخصم من الحصة**. لا يوجد موعد جديد معلن | [Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions) |
| «Copilot Free = 50 chat شهرياً» | النص الحالي: **2,000 code completions** + **حصة AI credits** غير محددة الرقم في الجدول. نظام «premium requests» استُبدل بـ AI credits (1 credit = $0.01) | [Copilot plans](https://docs.github.com/en/copilot/get-started/plans) |
| «Copilot Student = 200 credit» | الرقم 200 غير مذكور في التوثيق الرسمي؛ الجدول يقول «an allowance of AI credits» بلا رقم. المتحقق: **completions غير محدودة** وauto model selection فقط | [Copilot billing](https://docs.github.com/en/copilot/concepts/billing-and-usage/individuals/billing) |
| «GitHub Models مجاني للـ prototyping» | **أُغلقت الخدمة نهائياً في 30 يوليو 2026**: playground وcatalog وinference API وBYOK | [GitHub Models](https://docs.github.com/en/github-models) |
| «Releases = 2 GB للملف» | صحيح لكن ناقص: كل ملف **أقل من 2 GiB**، حتى **1000 ملف** لكل release، و**لا حد** للحجم الكلي أو bandwidth | [About releases](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases) |

## 2. الأرقام الصحيحة كما هي

### الحصص الشهرية لكل خطة

| المنتج | Free شخصي | Pro | Free للمنظمات | Team |
| --- | --- | --- | --- | --- |
| Actions — compute | $12 | $18 | $12 | $18 |
| Actions — تخزين | 500 MB | 1 GB | 500 MB | 2 GB |
| Packages — تخزين | 500 MB | 2 GB | 500 MB | 2 GB |
| Packages — transfer | 1 GB | 10 GB | 1 GB | 10 GB |
| Codespaces — core hours | 120 | 180 | **لا شيء** | **لا شيء** |
| Codespaces — تخزين | 15 GB | 20 GB | **لا شيء** | **لا شيء** |
| Git LFS — تخزين/transfer | 10 GiB / 10 GiB | نفسه | نفسه | 250 GiB |

المصدر: [product-usage-included](https://docs.github.com/en/billing/reference/product-usage-included).

**مهمتان يغفل عنهما الكثيرون:**

- **Codespaces غير متاح إطلاقاً** لحسابات Organizations على Free أو Team. الأرقام 120/15 للحساب الشخصي فقط.
- **تخزين Actions وPackages يتشاركان نفس الحصة** (500 MB على Free). **تخزين الـ cache منفصل**: 10 GB لكل مستودع، ولا يخصم منها.

### ما يبقى مجانياً بلا خصم من الحصة

- Standard GitHub-hosted runners في **المستودعات العامة**.
- **Self-hosted runners** في كل الحالات.
- **Larger runners مدفوعة دائماً**، حتى في المستودع العام.

هذا يعني أن مستودعنا العام لا يستهلك من الـ $12 عند استخدام runners قياسية.

### كم دقيقة تعني الـ $12؟

الأسعار بعد 1 يناير 2026: Linux 2-core ‎$0.006/دقيقة، Windows ‎$0.010، macOS ‎$0.062.

- Linux: ‎$12 ÷ 0.006 ≈ **2,000 دقيقة**
- Windows: ‎$12 ÷ 0.010 = **1,200 دقيقة**
- macOS: ‎$12 ÷ 0.062 ≈ **193 دقيقة**

لهذا يبدو رقم «2,000 دقيقة» مألوفاً — لكنه **نتيجة حسابية لـ Linux فقط**، وليس حصة رسمية. يتغير مع أي تغيير سعر.

## 3. GitHub Pages

| البند | الحد |
| --- | --- |
| حجم الموقع المنشور | 1 GB |
| مهلة النشر | 10 دقائق |
| Bandwidth | 100 GB/شهر (**soft**) |
| عدد البناءات | 10/ساعة (**soft**) — **لا ينطبق** مع سير عمل Actions مخصص |
| التوفر على Free | المستودعات **العامة** فقط |

**سياسة الاستخدام:** Pages غير مخصص ولا مسموح به كاستضافة مجانية لتشغيل نشاط تجاري أو متجر إلكتروني أو SaaS تجاري، ولا لتمرير كلمات سر أو بيانات دفع.

المصدر: [GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits).

هذا يخص مشروعنا مباشرة: الواجهة ثابتة ومجانية، لكن **أي مسار ربحي فعلي يجب أن ينتقل إلى منصة تسمح بالاستخدام التجاري**. راجع خيار A في `docs/OPERATIONS.md`.

## 4. حماية من الفواتير

النظام الحالي اسمه **Budgets**، وليس «spending limits» القديم.

1. `Settings → Billing and licensing → Budgets and alerts → New budget`
2. اختر **Product-level budget** ← المنتج (Actions، Codespaces، Packages…)
3. ضع المبلغ **0**
4. **فعّل `Stop usage when budget limit is reached`** — هذه هي الخطوة الحاسمة

> بدون تفعيل هذا الخيار، يصلك بريد بالتجاوز لكن **الاستخدام لا يتوقف**.

لا تنشئ ميزانيات متداخلة (منتج + SKU لنفس الاستخدام): نفاد أي واحدة منها يوقف الاستخدام، والميزانية المتداخلة الأخرى لا تمنع الإيقاف.

المصدر: [Setting up budgets](https://docs.github.com/en/billing/how-tos/set-up-budgets).

**بلا بطاقة دفع:** عند تجاوز الحصة يُوقف الاستخدام ولا تُصدر فاتورة. هذا يجعل البناء والنشر المجانيين آمنين مالياً في وضعنا الحالي.

## 5. ما يطبّقه هذا المستودع فعلاً

| الممارسة | الحالة |
| --- | --- |
| مستودع عام → runners قياسية مجانية | ✅ |
| `cache: npm` في `setup-node` | ✅ |
| `concurrency` + `cancel-in-progress` على الفروع | ✅ |
| `concurrency: pages-production` يمنع تزاحم النشر | ✅ |
| `timeout-minutes` على كل مهمة | ✅ |
| `permissions:` بأقل صلاحية | ✅ |
| لا artifacts بلا مستهلك | ✅ بعد إزالة artifact غير المستخدم |
| فحص ما بعد النشر يطابق canonical مع العنوان المخدوم | ✅ `SMOKE_STRICT_IDENTITY=1` في مهمة `verify` |
| Dependabot لتحديث actions المثبّتة بـ SHA | ✅ `.github/dependabot.yml` |
| اختبار Groq الحي يدوي فقط، بلا `schedule` | ✅ لا يستهلك حصة دورياً |

**عن `schedule`:** سير العمل المجدول في مستودع عام **يُعطَّل تلقائياً بعد 60 يوماً بلا نشاط**، ومعطّل افتراضياً في الـ forks. لذلك لا نبني عليه شيئاً حيوياً. المصدر: [Disabling and enabling a workflow](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/disable-and-enable-workflows).

**عن `paths:` filters:** لم نُضِفها. توفير الدقائق ليس أولوية في مستودع عام runners فيه مجانية، وتخطّي الفحص على تغييرات «توثيقية» يخاطر بمرور كسر حقيقي. الأولوية هنا لتقليل **التخزين**، وهو ما فعلناه.

## 6. حدود مزوّد الذكاء الاصطناعي

لا توجد حصة ذكاء اصطناعي مجانية داخل GitHub بعد إغلاق Models. مشروعنا يستخدم **Groq**، وحصته منفصلة تماماً وتُراجَع في صفحة حسابك: [Groq rate limits](https://console.groq.com/docs/rate-limits).

المفتاح في Actions Secrets للاختبار فقط، وفي runtime الوسيط للمنتج. لا يصل إلى المتصفح أبداً.

</div>
