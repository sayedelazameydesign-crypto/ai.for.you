<div dir="rtl">

# دليل الصيانة الذاتية — celia.sh

> **مواصفة تنفيذ، لا وثيقة تعريفية.** كل بند يحمل حالة صريحة وإثباتًا يُعاد إنتاجه بأمر مكتوب بجانبه. بند بلا إثبات يُعتبر `planned` تلقائيًا. ثلاثة أوضاع فقط: `done` و`partial` و`blocked`، و`planned` لما لم يُبنَ.

## 0. ما تغيّر في هذا الإصدار

النسخة السابقة كانت خطة. هذه النسخة **تشغّل الأدوات وتُثبتها**. الفرق قابل للقياس:

| قبل | الآن |
| --- | --- |
| فحص `success/failure` فقط | تقرير بوضع ثالث: `NOT RUN` — لأن «لم يعمل» ليس «نجح» |
| لا سكربت تقرير | `npm run report:maintenance` → جدول PASS/FAIL/NOT RUN |
| وكيل صيانة مذكور في الخطة | وكيل منفّذ، **و١٤ حاجزًا مُختبَرًا آليًا** في CI |
| «الإصلاح الذاتي التلقائي غير مثبت» | الوكيل يقترح PR ولا يدمج؛ مُثبت بحواجز واختبارات |

## 1. المراحل الثلاث

| المرحلة | الحالة | ما هو موجود فعليًا |
| --- | --- | --- |
| **M1** حماية `main` وإلزام الاختبارات | `blocked` | `.github/CODEOWNERS` + قالب PR جاهزان، لكن **الحماية تحتاج صلاحية المالك** ولم تُثبت مفعّلة |
| **M2** تقرير صيانة آلي أسبوعي | `done` | `.github/workflows/maintenance-report.yml` + `scripts/maintenance-report.mjs` |
| **M3** وكيل يقترح إصلاحًا عبر PR بلا دمج أو نشر | `done` | `.github/workflows/maintenance-agent.yml` + `scripts/maintenance-agent.mjs` + `scripts/agent-guards.mjs` |

## 2. دورة الصيانة

```text
Observe → Diagnose → Fix (proposal) → Verify → Approve (human) → Merge
```

| المرحلة | المنفّذ | الحد |
| --- | --- | --- |
| **Observe** | `maintenance-report.yml` أسبوعيًا | صلاحية قراءة فقط |
| **Diagnose** | كل فحص يطبع `reason=` ورمزًا ثابتًا، بلا جسم استجابة أو سر | لا طباعة بيانات مستخدم |
| **Fix (proposal)** | الوكيل على فرع `maintenance/...` فقط | لا يلمس كود التطبيق ولا الاختبارات ولا الأسرار |
| **Verify** | الوكيل يشغّل `npm run check` قبل الاقتراح؛ CI يعيد التحقق | اقتراح يفشل الاختبارات لا يُقترح |
| **Approve** | إنسان يدمج أو يرفض | الوكيل **لا يملك** صلاحية الدمج |
| **Merge** | بعد نجاح `quality` ومراجعة المالك | — |

## 3. المراقبة: مصادر اكتشاف الأعطال

| المصدر | يكتشف | متى | الحالة |
| --- | --- | --- | --- |
| CI على كل PR | كسر في الاختبارات أو البناء أو التوثيق | فورًا | `done` |
| `verify` بعد النشر | الموقع يُبنى ولا يُقدَّم، أو canonical قديم | بعد كل نشر | `done` |
| `maintenance-report` أسبوعيًا | ثغرة ظهرت دون دفع كود، انحراف وثائق، موقع ميت | كل اثنين 04:17 UTC | `done` |
| Dependabot أسبوعيًا | حزمة متأخرة أو غير آمنة | كل اثنين | `done` |
| `server/metrics.ts` | استهلاك حصة، رفض متكرر، فشل مزوّد | لحظيًا في السجل | `done` |
| `agent-guards` في CI | إزالة حاجز أمان من الوكيل | مع كل PR | `done` |
| CodeQL | ثغرة في نمط الكود | أسبوعيًا بعد التفعيل | `blocked` |

## 4. القياس: تقرير PASS / FAIL / NOT RUN

</div>

```bash
npm run report:maintenance
# أو مع الموقع الحقيقي:
PAGE_URL=https://… API_BASE=https://… npm run report:maintenance
```

<div dir="rtl">

المخرَج الحقيقي وقت كتابة هذا الملف:

| الحالة | المجال | الفحص | التفصيل |
| --- | --- | --- | --- |
| `PASS` | tests | lint + unit tests + build | `npm run check exited 0` |
| `PASS` | tests | coverage thresholds | `statements=69.47%` |
| `PASS` | dependencies | high-severity audit | لا تنبيهات عالية |
| `PASS` | dependencies | outdated packages | حزمة واحدة متأخرة، تُسجَّل ولا تُطبَّق |
| `PASS` | documentation | drift guard | `docs_guard=passed ... limits=5 error_codes=15` |
| `PASS` | security | committed secret scan | `secret_guard=passed` |
| `PASS` | code quality | build output assertions | `build_check=passed files=35` |
| `NOT RUN` | operational health | live site smoke test | `PAGE_URL` غير مضبوط في التشغيل المحلي |
| `FAIL`/`PASS` | recovery | working tree clean | يعتمد على نظافة الشجرة لحظة التشغيل |
| `NOT RUN` | recovery | releasable checkpoint | لا وسم إصدار بعد |

**لماذا الحالة الثالثة ضرورية:** التقرير الأول الذي أنتجه هذا السكربت كشف خللين في السكربت نفسه — تمرير مصفوفة داخل مصفوفة إلى `spawnSync`، وعدّ تغييرات شجرة العمل كنجاح. لو كان التقرير يعرف `PASS/FAIL` فقط لظهر كذبًا ناجحًا.

## 5. الوكيل: ما يفعله وما يُمنع منه

**يفعل:** يقرأ الحزم المتأخرة، يطبّق **patch وminor فقط**، يضيف سطرًا في `CHANGELOG.md`، يشغّل `npm run check`، ثم ينشئ فرعًا ويرفع PR.

**لا يفعل — مفروض في الكود لا في النص:**

| الحاجز | التنفيذ | الإثبات |
| --- | --- | --- |
| لا دفع إلى `main` | يرفض العمل إن كان الفرع محميًا | `agent_guards=passed` |
| لا دمج | الوظيفة لا تملك مسار دمج أصلًا | فحص `agent=dry_run` لا يطبع `merged` |
| مسارات مسموحة فقط | `ALLOWED_PATHS` = ثلاثة ملفات، و`DENY` لكل مجلد كود | ٧ حالات معادية في الاختبار |
| لا أسرار في الفرق | ثلاث قواعد أنماط على محتوى الملفات | ٤ حالات اختبار |
| لا يعمل على `pull_request` | المشغّل جدولة أو يدوي فقط | مراجعة الـ workflow |
| صلاحيات محدودة | `contents/pull-requests/issues` فقط | لا `actions` ولا `deployments` ولا `id-token` |
| لا يلمس major | تصنيف صريح، والكبير يُسجَّل `major_skipped` | مخرج حقيقي: `major_skipped typescript: 5.9.3 -> 7.0.2` |

</div>

```bash
npm run agent:guards    # 14 فحصًا: المسارات، الأسرار، الفرع المحمي، عدم الدمج
npm run agent:dry       # يرى ماذا سيقترح دون كتابة أي شيء
```

<div dir="rtl">

## 6. الجوانب الستة

| المجال | الحالة | الدليل |
| --- | --- | --- |
| **الاختبارات** | `done` | 66 اختبار وحدة + Chromium + axe + عتبات تغطية محروسة |
| **الاعتماديات** | `done` | Dependabot مجمّع + فحص أسبوعي + وكيل مقترح |
| **جودة الكود** | `done` | ESLint + `tsc` strict + حجم الحزمة + حارس الأسرار |
| **التوثيق** | `done` | `check-docs` يفشل عند رابط مكسور أو رقم لا يطابق الكود أو رمز خطأ غير موثّق |
| **الصحة التشغيلية** | `done` | فحص موقع حقيقي بعد كل نشر وأسبوعيًا + مقاييس بلا محتوى |
| **التعافي** | `partial` | RUNBOOK كامل؛ الوسوم الدلالية `planned` وRTO غير مقيس |

## 7. البوابات التي تحتاجك **[المالك]**

| البوابة | لماذا لا تُؤتمت | كيف تُغلق |
| --- | --- | --- |
| **G1** حماية `main` | تحتاج صلاحية إدارة | Settings → Branches: منع force-push والحذف، Require PR، Require status checks → `quality`، Do not allow bypassing |
| **G2** مراجعة المالك | `CODEOWNERS` بلا تفعيل لا يُلزم | تفعيل Require review from Code Owners |
| **G3** CodeQL | تنبيهات فقط بعد التفعيل | Security → Code scanning → Default setup |
| **G4** تدوير المفاتيح | سر لا يُقرأ برمجيًا | `docs/OPERATIONS.md` كل 60–90 يومًا |

**إفصاح:** وقت كتابة هذا الملف أعاد `gh api repos/.../branches/main/protection` الرمز `403`، أي أن الحماية **غير مُثبتة**. يبقى `blocked` حتى يُثبت العكس. الفرق بين `blocked` و`done` هو الفرق بين الصيانة والدعاية.

## 8. حدود صريحة

- **لا إصلاح تلقائي منطقي.** الوكيل يحرّك أرقام إصدارات فقط. أي وكيل يعيد كتابة المنطق بلا إشراف ليس صيانة.
- **نجاح CI ليس دليل تشغيل.** `verify` و`maintenance-report` يفحصان الموقع الحقيقي، و`NOT RUN` لا يُحتسب نجاحًا.
- **لا حصة مركزية ولا مصادقة مستخدمين.** العدّادات في الذاكرة، ومعلن أنها لا تصمد عبر `serverless`.
- **`plan` بلا أداة = غير موجود.** كل بند `planned` أدناه يحتاج أثرًا في المستودع قبل ترقيته.

## 9. المتبقي

| # | العمل | الحالة |
| --- | --- | --- |
| G1–G4 | تفعيل البوابات | `blocked` |
| G5 | auto-merge لتحديثات patch/minor بعد نجاح CI | `planned` |
| G7 | نقل المحرّكات إلى `shared/engines/` وقاعدة اتجاه تبعيات | `planned` |
| G8 | مولّد `npm run new:tool` | `planned` |
| G9 | اختبار طفرة على محرّكي التلخيص والكود | `planned` |
| G10 | وسوم دلالية آلية عند الدمج في `main` | `planned` |

## 10. كيف تُحدَّث هذه الوثيقة

1. البند الجديد يبدأ `planned` مع سبب.
2. لا يُرفع إلى `done` قبل تشغيل الأمر ونسخ مخرجته الحقيقية.
3. `npm run check:docs` يفشل إن اختفى قسم الجوانب الستة أو ظهر سطر `TODO` منفرد.
4. الأوامر التشغيلية في `docs/RUNBOOK.md`، والتفاصيل التقنية في `docs/QUALITY.md`.

</div>
