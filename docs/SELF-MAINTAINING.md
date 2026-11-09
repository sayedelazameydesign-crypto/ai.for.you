<div dir="rtl">

# دليل الصيانة الذاتية — celia.sh

> **مواصفة تنفيذ، لا وثيقة تعريفية.** كل بند يحمل حالة صريحة وإثباتًا يُعاد إنتاجه بأمر مكتوب بجانبه. بند بلا إثبات يُعتبر `planned` تلقائيًا. أربعة أوضاع فقط: `done` و`partial` و`blocked`، و`planned` لما لم يُبنَ بعد.

## 0. ما تغيّر في هذا الإصدار

النسخة السابقة كانت خطة أو تصف جزئيًا سلوكًا تغيّر في الكود. هذه النسخة **تعكس السلوك الفعلي المُنفَّذ والمُثبَت بالاختبارات وسجلات GitHub Actions**:

| قبل | الآن (مُقاس فعليًا) |
| --- | --- |
| فحص `success/failure` فقط | تقرير بثلاث حالات: `PASS` / `FAIL` / `NOT RUN` — لأن «لم يعمل» ليس «نجح» |
| `npm outdated --json` يبتلع أخطاء الشبكة والمصادقة ويعدّها `PASS` | فصل `stdout` عن `stderr`، وتحويل أخطاء الشبكة والمصادقة والتلف وغياب `current` إلى `FAIL` برمز سبب صريح ورمز خروج `1` |
| غياب `check:sql` واختبارات التقرير | ربط `scripts/check-sql.mjs` في التقرير + `9` اختبارات عزل فعلية في `tests/maintenance-report.test.ts` |
| ادّعاء `done` كامل لوكيل الصيانة المجدول | فصل صريح: الحواجز العشرون و`--dry-run` تعمل (`done`)، بينما التشغيل المجدول `--apply` على `main` يتعطل عند `protected_branch` (`partial` — التذكرة `#11`) |

## 1. المراحل الثلاث

| المرحلة | الحالة | ما هو موجود فعليًا |
| --- | --- | --- |
| **M1** حماية `main` وإلزام الاختبارات | `blocked` | `.github/CODEOWNERS` + قالب PR جاهزان، لكن **تفعيل الحماية في إعدادات المستودع يحتاج صلاحية المالك** ولم يُثبت مفعّلًا |
| **M2** تقرير صيانة آلي أسبوعي | `done` | `.github/workflows/maintenance-report.yml` + `scripts/maintenance-report.mjs` + `tests/maintenance-report.test.ts`؛ أُثبت تشغيله يدويًا (`42529354539`) وبالجدولة التلقائية على `main` (`42621538980`) |
| **M3** وكيل يقترح إصلاحًا عبر PR بلا دمج أو نشر | `partial` | `scripts/maintenance-agent.mjs` + `scripts/agent-guards.mjs` (`20` فحصًا ناجحًا) + وضع `--dry-run` يعمل؛ أما تشغيل `schedule` بوضع `--apply` على `main` فيتوقف حاليًا عند حاجز `protected_branch` قبل تفريع `maintenance/...` (التشغيل `42624824040` والتذكرة `#11`) |

## 2. دورة الصيانة

```text
Observe → Diagnose → Fix (proposal) → Verify → Approve (human) → Merge
```

| المرحلة | المنفّذ | الحد الفعلي في الكود |
| --- | --- | --- |
| **Observe** | `maintenance-report.yml` أسبوعيًا + داخل `ci.yml` على كل PR | صلاحية قراءة للمحتوى (`contents: read`) وفتح/تحديث تذكرة عند الفشل (`issues: write`) |
| **Diagnose** | كل فحص يطبع `reason=` ورمزًا ثابتًا، بلا جسم استجابة أو سر | لا طباعة بيانات مستخدم ولا مفاتيح |
| **Fix (proposal)** | `maintenance-agent.mjs` على فرع ميزة/صيانة فقط | لا يلمس كود التطبيق ولا الاختبارات ولا الأسرار؛ يعمل يدويًا من فرع غير محمي، وما زال مسار `schedule` المباشر على `main` محجوبًا بترتيب الحاجز |
| **Verify** | الوكيل يشغّل `npm run check` قبل الالتزام؛ CI يعيد التحقق الكامل | اقتراح يفشل الاختبارات لا يُلتزم به أصلًا |
| **Approve** | إنسان يراجع ويدمج أو يرفض | الوكيل **لا يملك** مسار دمج |
| **Merge + Post-Deploy** | بعد نجاح `quality` وموافقة المالك، يليها `deploy` ثم `verify` على `main` | لا يُعدّ الدمج مغلقًا قبل نجاح `verify` على الموقع المنشور |

## 3. المراقبة: مصادر اكتشاف الأعطال

| المصدر | يكتشف | متى | الحالة |
| --- | --- | --- | --- |
| CI (`quality`) على كل PR ودفع لـ `main` | كسر في الاختبارات أو التغطية أو البناء أو التوثيق أو مخطط SQL أو تطابق الأدلة | فورًا | `done` |
| `verify` بعد النشر (`smoke-deploy.mjs`) | الموقع يُبنى ولا يُقدَّم، أو هوية البناء/canonical غير مطابقة | بعد كل نشر على `main` | `done` |
| `maintenance-report.yml` أسبوعيًا | ثغرات اعتماديات، فشل سجل `npm` أو حزم متأخرة، انحراف وثائق، خرق سياسة SQL، تسرب سر شكلي، أو تعطل الموقع الحي | كل اثنين 04:17 UTC (مُثبت في التشغيل `42621538980`) | `done` |
| Dependabot أسبوعيًا | تحديثات الحزم وإجراءات GitHub Actions | كل اثنين | `done` |
| `server/metrics.ts` | استهلاك حصة، رفض متكرر، فشل مزوّد أو مهلة | لحظيًا في السجل | `done` |
| `agent-guards` في CI (`20` فحصًا) | إزالة حاجز أمان أو تصنيف حزم ناقص في الوكيل | مع كل PR | `done` |
| `tests/maintenance-report.test.ts` + خطوة `ci.yml` | عطب في `maintenance-report.mjs` أو إخفاء فشل `npm outdated` أو `check:sql` | مع كل `npm test` وكل PR | `done` |
| CodeQL | ثغرة في نمط الكود | أسبوعيًا بعد التفعيل | `blocked` |

## 4. القياس: تقرير PASS / FAIL / NOT RUN

</div>

```bash
npm run report:maintenance
# أو لإعادة استخدام نتيجة الفحص والبناء داخل CI:
node scripts/maintenance-report.mjs --reuse-quality --json maintenance-report.json
# أو مع فحص الموقع المنشور والوسيط:
PAGE_URL=https://… API_BASE=https://… npm run report:maintenance
```

<div dir="rtl">

المخرَج الفعلي لجدول التقرير على الشجرة النظيفة (`11` صفًا، رمز الخروج `0` عند غياب `FAIL` و`1` عند وجود أي `FAIL`):

| الحالة | المجال | الفحص | التفصيل الفعلي |
| --- | --- | --- | --- |
| `PASS` | `tests` | `lint + unit tests + build` | `npm run check exited 0` (أو `NOT RUN` عند غياب `node_modules`) |
| `PASS` | `tests` | `coverage thresholds` | `statements=74.61% (thresholds enforced)` |
| `PASS` | `dependencies` | `high-severity audit` | `no high or critical advisories` (أو `FAIL: reason=network_error (...)` عند انقطاع السجل) |
| `PASS` | `dependencies` | `outdated packages` | `4 package(s) behind (0 routine, 4 major/range-pinned); reported, never auto-applied` |
| `PASS` | `documentation` | `drift guard` | `docs_guard=passed markdown=16 links=17 limits=5 error_codes=15` |
| `PASS` | `security` | `quota SQL policy` | `sql_check=passed files=1` (يشغّل `scripts/check-sql.mjs` فعليًا) |
| `PASS` | `security` | `committed secret scan` | `secret_guard=passed` |
| `PASS` | `code quality` | `build output assertions` | `build_check=passed files=46 size_mb=2.13 pages_limit_mb=1024` (أو `NOT RUN` قبل `npm run build`) |
| `NOT RUN` | `operational health` | `live site smoke test` | `PAGE_URL is not set for this run` |
| `PASS`/`FAIL` | `recovery` | `working tree clean` | `no uncommitted changes` على الشجرة النظيفة |
| `NOT RUN` | `recovery` | `releasable checkpoint` | `no version tag yet; rollback falls back to re-running a successful workflow` |

### قواعد الصدق التشخيصي في `scripts/maintenance-report.mjs`

1. **فصل `stdout` عن `stderr`:** تحذيرات `npm` على `stderr` لا تُدمج مع JSON القياسي على `stdout` فلا تُفسد التحليل.
2. **لا يتحول أي فشل في `npm outdated --json` إلى `PASS`:**
   - لا حزم متأخرة (`{}` مع رمز خروج `0`) ← `PASS` (`all dependencies current`).
   - حزم متأخرة صالحة مكتملة الحقل `current` ← `PASS` مع تفصيل الروتيني مقابل المثبّت/الرئيسي.
   - خطأ شبكة (`ENOTFOUND`, `EAI_AGAIN`, `ETIMEDOUT`, `ECONNREFUSED`, ...) ← `FAIL` مع `reason=network_error (<CODE>)` ورمز خروج `1`.
   - خطأ سجل/مصادقة من `npm` مثل `ENEEDAUTH` ← `FAIL` مع `reason=npm_outdated_error (ENEEDAUTH)` ورمز خروج `1`.
   - مخرج غير صالح للتحليل (`JSON` تالف) ← `FAIL` مع `reason=outdated_parse_failed` ورمز خروج `1`.
   - رمز خروج غير صفري بلا بيانات حزم صالحة ← `FAIL` مع `reason=outdated_command_failed (exit=...)` ورمز خروج `1`.
   - غياب الحقل `current` لحزمة ← `FAIL` مع `reason=missing_installed_version (...)` ورمز خروج `1`.
   - غياب مجلد `node_modules` ← `NOT RUN` (`node_modules missing; run npm ci`)، لا `PASS`.
3. **حراسة مخطط SQL فعليًا (`quota SQL policy`):** يشغّل التقرير `scripts/check-sql.mjs` مباشرةً على `supabase/migrations/*.sql`، وأي إخلال بـ `SECURITY DEFINER` أو `search_path = ''` أو عزل `private` أو صلاحيات الأدوار يسجّل `FAIL` مع `reason=<rule_id>` ويخرج بالرمز `1`.

## 5. الوكيل: ما يفعله وما يُمنع منه

**يفعل (في وضعه المصمّم):** يقرأ الحزم المتأخرة، يطبّق **patch وminor فقط**، يضيف سطرًا في `CHANGELOG.md`، يشغّل `npm run check`، ثم ينشئ التزامًا على فرع `maintenance/...` ليُفتح به PR دون دمج.

**لا يفعل — مفروض في الكود ومحروس آليًا:**

| الحاجز | التنفيذ | الإثبات |
| --- | --- | --- |
| لا التزام على `main` | يرفض العمل إن كان الفرع الحالي محميًا (`main`/`master`) | `agent_guards=passed` |
| لا دمج | السكربت والـ workflow لا يملكان خطوة دمج أصلًا | فحص `dry run never claims a merge` |
| مسارات مسموحة فقط | `ALLOWED_PATHS` = `package.json`, `package-lock.json`, `CHANGELOG.md`، مع قائمة `DENY` صريحة | `7` حالات مسارات معادية في `agent-guards.mjs` |
| لا أسرار في الفرق | `3` قواعد أنماط على محتوى الملفات المعدّلة | `4` حالات اختبار في `agent-guards.mjs` |
| لا يعمل على `pull_request` | المشغّل `schedule` أو `workflow_dispatch` فقط | مراجعة `.github/workflows/maintenance-agent.yml` |
| صلاحيات محدودة | `contents/pull-requests/issues` فقط | لا `actions` ولا `deployments` ولا `id-token` |
| لا يسقط حزمة بصمت ولا يقبل فشل `npm outdated` | تصنيف شامل (`routine` / `major_skipped` / `range_satisfied`) ورفض غياب `node_modules` أو `current` أو `ENEEDAUTH` | `6` فحوص في `agent-guards.mjs` (المجموع الكلي `20` فحصًا) |

</div>

```bash
npm run agent:guards    # 20 فحصًا: المسارات، الأسرار، الفرع المحمي، شمول التصنيف، وأعطال npm outdated
npm run agent:dry       # يعرض التصنيف الفعلي للحزم المتأخرة دون كتابة أي ملف
```

<div dir="rtl">

## 6. الجوانب الستة

> الأعداد الدقيقة للاختبارات والحدود والتغطية محروسة آليًا في [docs/EVIDENCE.md](EVIDENCE.md) عبر `npm run check:evidence -- --full`؛ أي انحراف بين الرقم المنشور والقياس يُفشل البناء.

| المجال | الحالة | الدليل الفعلي |
| --- | --- | --- |
| **الاختبارات** | `done` | اختبارات وحدة وتكامل (Vitest، من بينها `tests/maintenance-report.test.ts` و`tests/sql.test.ts`) + اختبارات Chromium و`axe` + اختبارات PostgreSQL 16 + عتبات تغطية محروسة (راجع `docs/EVIDENCE.md`) |
| **الاعتماديات** | `partial` | Dependabot أسبوعي (`done`) + تقرير `maintenance-report` يكشف المتأخر وأعطال السجل (`done`) + حواجز الوكيل و`--dry-run` (`done`)؛ بينما اقتراح الوكيل المجدول `--apply` على `main` ما زال معطلًا بترتيب حاجز الفرع المحمي (`G12`) |
| **جودة الكود والأمان** | `done` | ESLint + `tsc -b` strict + ميزانيات الحزم (`check:build`) + `guard-secrets` + `check:sql` في كلٍّ من CI والتقرير الأسبوعي |
| **التوثيق** | `done` | `check:docs` و`check:evidence` يرفضان الروابط المكسورة وانحراف الحدود والأعداد ورموز الأخطاء غير الموثّقة |
| **الصحة التشغيلية** | `done` | فحص الموقع المنشور وهوية البناء بعد كل نشر (`verify`) وأسبوعيًا (`maintenance-report.yml`) + مقاييس JSON بلا بيانات مستخدم |
| **التعافي** | `partial` | `docs/RUNBOOK.md` موثّق؛ الوسوم الدلالية (`git tag`) ما زالت `planned` وRTO غير مقيس |

## 7. البوابات التي تحتاجك **[المالك]**

| البوابة | لماذا لا تُؤتمت من داخل الكود | كيف تُغلق |
| --- | --- | --- |
| **G1** حماية `main` | تحتاج صلاحية إدارة المستودع | Settings → Branches: منع force-push والحذف، Require PR، Require status checks → `quality`، Do not allow bypassing |
| **G2** مراجعة المالك | `CODEOWNERS` بلا تفعيل الحماية لا يُلزم | تفعيل Require review from Code Owners |
| **G3** CodeQL | تنبيهات المسح الأمني تعمل بعد التفعيل | Security → Code scanning → Default setup |
| **G4** تدوير المفاتيح | الأسرار لا تُقرأ ولا تُدوَّر من المستودع | `docs/OPERATIONS.md` كل 60–90 يومًا |

**إفصاح:** حماية `main` ما زالت غير مفعّلة في إعدادات GitHub، ويبقى البند `blocked` إلى أن يُفعّله المالك ويتحقق منه.

## 8. حدود صريحة

- **لا إصلاح تلقائي منطقي.** الوكيل مصمّم لتحريك إصدارات patch/minor فقط ضمن ثلاثة ملفات مسموحة؛ لا يمسّ كود التطبيق أو الخادم أو الاختبارات.
- **نجاح البناء ليس دليل نشر، وانتهاء السكربت ليس دليل سلامة.** `verify` يفحص الموقع المنشور فعليًا بعد كل دمج على `main`، و`maintenance-report.mjs` يعيد رمز خروج `1` عند أي صف `FAIL`، ولا يحتسب `NOT RUN` نجاحًا.
- **حالة نظام الحصص الفعلية (`partial`):** خادم `server/ai.ts` يطبّق حاليًا حدود الدقيقة واليوم في الذاكرة المحلية للعملية (`serverless` غير مشترك الحالة)، بينما مخطط الحصص المركزي `supabase/migrations/0001_entitlements.sql` موجود ومُختبَر سلوكيًا وتزامنيًا على PostgreSQL 16 في CI ومحروس نصيًا بـ `check:sql`، لكنه **غير موصول بـ `server/ai.ts` بعد**.

## 8.4 سجل التشغيلات الفعلية على GitHub Actions (اليدوية والمجدولة)

| التاريخ | السيرة والحدث | رقم التشغيل | النتيجة الفعلية على GitHub | الدلالة الهندسية |
| --- | --- | --- | --- | --- |
| 8 نوفمبر 2026 | `maintenance-report.yml` (`workflow_dispatch` على `main`) | `42529354539` | **نجح (`PASS`)** | إثبات مسار التقرير اليدوي على `main` |
| 8 نوفمبر 2026 | `maintenance-agent.yml` (`workflow_dispatch` مع `apply` على `main`) | `42529563821` | **فشل عند `Propose` (`exit 1`)** وفتح التذكرة **#11** | رفض `maintenance-agent.mjs` العمل مباشرةً على `main` (`reason=protected_branch`) ولم يُدمج أو يُنشر شيء |
| 9 نوفمبر 2026 | `maintenance-report.yml` (**`schedule` تلقائي** على `main`) | `42621538980` | **نجح (`PASS` في `39s`)** ورفع أثر `maintenance-report` | إثبات اشتغال الجدولة الأسبوعية الفعلية على الفرع الافتراضي (إغلاق `G11`) |
| 9 نوفمبر 2026 | `maintenance-agent.yml` (**`schedule` تلقائي** على `main`) | `42624824040` | **فشل عند `Propose routine updates` (`exit 1` في `24s`)** وأضاف تعليقًا على التذكرة **#11** | نجحت خطوتا `agent-guards` و`--dry-run` (`routine=0`)، لكن استدعاء `--apply` فوق استنساخ `main` اصطدم بحاجز `protected_branch` في السطر `80` قبل فحص `routine.length === 0` وقبل إنشاء فرع `maintenance/...` |

### العارض المفتوح في `maintenance-agent` (مُشخَّص وغير مُدَّعى إصلاحه في هذه الدفعة)

التشغيل المجدول `42624824040` والتذكرة المفتوحة **#11** يكشفان تعارضًا هيكليًا واضحًا بين `.github/workflows/maintenance-agent.yml` و`scripts/maintenance-agent.mjs`:
1. سير العمل المجدول في GitHub Actions يستنسخ الفرع الافتراضي `main` حتمًا، ثم يشغّل `node scripts/maintenance-agent.mjs --apply`.
2. يفحص `scripts/maintenance-agent.mjs` في السطر `80` الشرط `if (APPLY && PROTECTED.has(branch)) done(1)` **قبل** الوصول إلى فحص عدم وجود تحديثات روتينية (`if (!routine.length) done(0)` في السطر `223`) و**قبل** تفريع `git checkout -B maintenance/routine-dependencies-...` (السطر `236`).
3. النتيجة الحالية: كل تشغيل مجدول للوكيل على `main` يفشل حتمًا بالرمز `1` ويعلّق على التذكرة **#11** حتى عندما تكون التحديثات الروتينية صفرًا. أُبقي `scripts/maintenance-agent.mjs` دون تعديل في هذه الدفعة عمدًا لعزل النطاق، ويُسجَّل هذا الخلل صراحةً كبند مفتوح (`G12`) إلى أن يُعالج في دفعة مخصّصة.

## 8.5 ما أُثبت فعليًا وما لا يزال غير مُثبت

- **مُثبت فعليًا الآن:**
  - `maintenance-report.yml` يعمل بالجدولة الأسبوعية التلقائية على `main` (`42621538980`).
  - `scripts/maintenance-report.mjs` يرفض صمت `npm outdated` في حالات أخطاء الشبكة و`ENEEDAUTH` وJSON التالف وغياب `current`، ويشغّل `check:sql` فعليًا، ويُعيد رمز خروج `1` عند أي `FAIL` (`9` اختبارات عزل في `tests/maintenance-report.test.ts`).
  - الحواجز العشرون في `scripts/agent-guards.mjs` ومسار المراقبة الجاف `--dry-run` يعملان محليًا وفي CI.
- **غير مُثبت بعد (ولا يُدَّعى):**
  - نجاح `maintenance-agent.yml` في فتح PR تلقائي عند التشغيل المجدول على `main`؛ هذا المسار معطل حاليًا بسبب البند `G12` (التذكرة `#11`).
  - تفعيل حماية الفرع `main` وفحص `CodeQL` في إعدادات المستودع (`G1`–`G3`).

## 9. المتبقي

| # | العمل | الحالة |
| --- | --- | --- |
| G1–G4 | تفعيل حماية `main` ومراجعة `CODEOWNERS` و`CodeQL` وتدوير المفاتيح دوريًا | `blocked` |
| G5 | دمج تلقائي مشروط لتحديثات patch/minor بعد تفعيل حماية الفرع ونجاح CI | `planned` |
| G7 | نقل المحرّكات إلى `shared/engines/` وقاعدة اتجاه تبعيات | `planned` |
| G8 | مولّد `npm run new:tool` | `planned` |
| G9 | اختبار طفرة على محرّكي التلخيص والكود | `planned` |
| G10 | وسوم دلالية آلية عند الدمج في `main` | `planned` |
| G11 | التحقق من عمل `maintenance-report.yml` بالجدولة على `main` (أُثبت في التشغيل `42621538980`) | `done` |
| G12 | إصلاح تعارض حاجز `protected_branch` مع التشغيل المجدول لـ `maintenance-agent.yml` على `main` وإغلاق التذكرة `#11` بعد التحقق | `planned` |

## 10. كيف تُحدَّث هذه الوثيقة

1. البند الجديد يبدأ `planned` أو `partial` أو `blocked` مع سبب صريح.
2. لا يُرفع أي بند إلى `done` قبل تشغيل الأمر فعليًا وتوثيق مخرجه أو رقم تشغيل GitHub Actions المثبت له.
3. `npm run check:docs` يفشل إن اختفى قسم القياس أو حالة `NOT RUN` أو ظهر سطر `TODO` منفرد، و`npm run check:evidence -- --full` يفشل إن خالفت الأعداد في `docs/EVIDENCE.md` القياس الفعلي.
4. الأوامر التشغيلية في `docs/RUNBOOK.md`، والتفاصيل التقنية في `docs/QUALITY.md`.

</div>
