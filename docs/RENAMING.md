<div dir="rtl">

# تغيير الاسم والنطاق: من `ai.for.you` إلى `celia.sh`

> **نُفّذت إعادة التسمية في 8 نوفمبر 2026.** المستودع الآن `sayedelazameydesign-crypto/celia.sh`، والموقع يعمل على `https://sayedelazameydesign-crypto.github.io/celia.sh/` بعد نشر جديد نجح فيه `quality` و`deploy` و`verify`. الرابط القديم `/ai.for.you/` صار **404** كما هو متوقع. الخطوات أدناه محفوظة كمرجع لأي تسمية قادمة.

كل ما يعتمد على مكان الاستضافة صار يأتي من البيئة. **لا يوجد اسم مستودع مكتوب في كود التطبيق.** لذلك إعادة التسمية لا تحتاج تعديل كود، وهذا ما حدث فعلاً: لم يُعدَّل أي سطر كود بعد التسمية، فقط أُعيد تشغيل النشر.

## 1. ما الذي تغيّر في الكود بالفعل

| العنصر | قبل | الآن |
| --- | --- | --- |
| `name` في `package.json` | `ai-for-you` | `celia-sh` (بلا نقاط، احترازاً من مشاكل أسماء الحزم) |
| `<title>` و`description` | نص ثابت في `index.html` | يُحقن وقت البناء من `shared/site.ts` |
| canonical و`og:url` | غير موجودين | يُحقنان من `VITE_SITE_URL` |
| رابط المستودع في الواجهة | مكتوب يدويًا في 3 مواضع | `site.repoUrl` من `VITE_REPO_URL` |
| `base` في إعداد البناء | `'./'` ثابت | `SITE_BASE` مع افتراض `'./'` |
| مسارات API | `api/status` ثابت | `api/v1/...` مع `VITE_API_BASE` اختياري |
| نطاق مخصص | غير مدعوم | `SITE_CNAME` يولّد ملف `CNAME` في `dist` |

سير العمل `.github/workflows/ci.yml` يحقن هذه القيم من سياق GitHub عند كل نشر:

```yaml
VITE_REPO_URL: ${{ github.server_url }}/${{ github.repository }}
VITE_SITE_URL: ${{ vars.SITE_URL || format('https://{0}.github.io/{1}/', github.repository_owner, github.event.repository.name) }}
```

النتيجة: بعد التسمية، أول نشر على `main` يبني بالمسار الجديد تلقائياً.

## 2. خطوات إعادة التسمية بالترتيب

1. ادمج طلب الدمج الذي يحتوي هذا الملف في `main`، وانتظر نجاح `Check and deploy`.
2. في GitHub: **Settings → General → Repository name** ← اكتب `celia.sh` ← **Rename**.
3. حدّث النسخة المحلية:

</div>

```bash
git remote set-url origin https://github.com/sayedelazameydesign-crypto/celia.sh.git
git remote -v
```

<div dir="rtl">

4. شغّل النشر: **Actions → Check and deploy → Run workflow → main**.
5. تحقق من العنوان الجديد: `https://sayedelazameydesign-crypto.github.io/celia.sh/`.
6. حدّث خانة **Website** في إعدادات المستودع إلى العنوان الجديد.

> الخطوة 2 نُفّذت من واجهة GitHub بواسطة المالك. لم يكن التنفيذ عبر API ممكناً: أعاد التكامل `403 Resource not accessible by integration` رغم أن صلاحية الحساب `admin`.

## 3. ما يتحول تلقائياً وما لا يتحول

| العنصر | يتحول؟ |
| --- | --- |
| Issues، Wikis، Stars، Watchers | نعم |
| `git clone` / `fetch` / `push` بالعنوان القديم | نعم، لكن حدّث الـ remote لتقليل الالتباس |
| روابط صفحات المستودع على الويب | نعم |
| **موقع GitHub Pages للمشروع** | **لا** — `/ai.for.you/` سيتوقف |
| Action منشور من المستودع نفسه | لا ينطبق هنا؛ لا ننشر action |

**لا تُنشئ مستودعاً جديداً بالاسم القديم `ai.for.you`** — هذا يُلغي كل التحويلات.

## 4. الرابط القديم: حل مؤقت

مواقع Projects على Pages لا تُحوَّل. لتغطية الرابط القديم أنشئ مستودعاً باسم `sayedelazameydesign-crypto.github.io` وضع فيه الملف `ai.for.you/index.html` بمحتوى جاهز في هذا المستودع:

`docs/redirect/ai.for.you-index.html`

انسخه كما هو إلى ذلك المسار. يحوّل الزائر إلى العنوان الجديد بعد ثانية، ويحمل رابطاً يدوياً و`canonical` يشير إلى الجديد. عدّل فيه `NEW_URL` إن تغيّر الاسم مرة أخرى.

هذا المستودع غير موجود حالياً على حسابك، وإنشاؤه قرار لك لأنه يصير موقع المستخدم الرئيسي.

## 5. الحل الدائم: نطاق مخصص

النطاق يثبّت الرابط مهما تغيّر اسم المستودع.

1. تحقق من توفّر `celia.sh` وسعره عند مسجّل نطاقات. `.sh` نطاق دولة (سانت هيلينا) ويُباع تجارياً؛ السعر والتوفر يتغيران ولا يمكن التحقق منهما من هنا. **لا تعتمد عليه قبل الشراء الفعلي.**
2. بعد الشراء، أضف سجلات DNS عند مزوّد النطاق:

| النوع | الاسم | القيمة |
| --- | --- | --- |
| `A` | `@` | `185.199.108.153` |
| `A` | `@` | `185.199.109.153` |
| `A` | `@` | `185.199.110.153` |
| `A` | `@` | `185.199.111.153` |
| `CNAME` | `www` | `sayedelazameydesign-crypto.github.io` |

3. في GitHub: **Settings → Pages → Custom domain** ← `celia.sh` ← احفظ، ثم فعّل **Enforce HTTPS** بعد إصدار الشهادة.
4. أضف في **Settings → Secrets and variables → Actions → Variables**:

| Variable | القيمة |
| --- | --- |
| `SITE_URL` | `https://celia.sh/` |
| `SITE_CNAME` | `celia.sh` |
| `SITE_BASE` | `/` |

5. أعد تشغيل النشر. البناء سيولّد `dist/CNAME` تلقائياً، والـ canonical سيصير `https://celia.sh/`.

عناوين IP أعلاه هي عناوين GitHub Pages المنشورة؛ راجعها في توثيق GitHub قبل الضبط لأن المنصة قد تحدّثها.

## 6. أشياء تنكسر بصمت إن لم تحدّثها

- **allowlist لـ Origin في وسيط Groq**: إن كان مكتوباً بالنطاق القديم، حدّث `AI_ALLOWED_ORIGINS` وإلا رُفض كل طلب بـ 403. القيمة الصحيحة حالياً: `https://sayedelazameydesign-crypto.github.io` (الأصل فقط، بلا مسار، فلا تتأثر بإعادة التسمية).
- **مشاريع Vercel أو Cloudflare المربوطة بالاسم القديم**: أعد ربطها بالمستودع الجديد.
- **روابط في مستودعات أخرى أو مقالات أو حسابات تواصل**: حدّثها يدوياً.
- **شارات README** التي تستخدم `owner/repo` في مسارها: حدّثها.
- **`VITE_API_BASE`** إن كنت تستخدم وسيطاً منفصلاً: تأكد أن الوسيط نفسه يسمح بالنطاق الجديد.

## 7. تحقق بعد النشر

```bash
npm run test:smoke -- https://sayedelazameydesign-crypto.github.io/celia.sh/
```

يفحص الصفحة فعلياً: وجود جذر التطبيق، اتجاه RTL، عدم بقاء placeholders غير مستبدلة، وجود حزمة JS، و**مطابقة الـ canonical للعنوان المخدوم**.

فحص الـ canonical هو ما يمسك الفشل الصامت بعد أي تسمية: الصفحة تُحمَّل بشكل طبيعي لكن محركات البحث ومعاينات التواصل تشير إلى العنوان القديم. المهمة `verify` تضبط `SMOKE_STRICT_IDENTITY=1` فتفشل عند أي اختلاف. عند التشغيل اليدوي بلا هذا المتغير يُطبع الاختلاف كتحذير فقط، لأن تشغيله محلياً عنوانه مختلف بطبيعته.

مع وسيط منفصل:

```bash
npm run test:smoke -- https://celia.sh/ https://your-proxy.example.com
```

المهمة `verify` في سير العمل تشغّل هذا الفحص تلقائياً بعد كل نشر، وتفشل إن لم يكن الموقع سليماً.

</div>
