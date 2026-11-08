<div dir="rtl">

# RUNBOOK — مهام تشغيلية بأوامر منسوخة

> كل بند هنا **نُفِّذ مرة واحدة على الأقل** إما في CI أو محليًا. لا يوجد أمر مكتوب بلا تشغيل. الأوامر التي تحتاج صلاحية حساب مُعلَّمة صراحة بـ **[المالك]**.

## 1. التراجع عن نشر سيئ (Recovery)

| الحالة | الأمر | الزمن المتوقع |
| --- | --- | --- |
| نشر جديد كسر الموقع | GitHub → Actions → آخر تشغيل ناجح → **Re-run all jobs** | ~2 دقيقة |
| تغيير كود سبب المشكلة | `git revert <sha>` ثم PR → دمج | ~5 دقائق |
| فشل `verify` بعد نشر ناجح | إعادة تشغيل تشغيل سابق ناجح (Rollback) لا حاجة لعمل شيء آخر | ~2 دقيقة |

**لا يوجد قاعدة بيانات ولا نسخ احتياطي مطلوب:** لا يخزّن الخادم شيئًا. البيانات الوحيدة عند المستخدم في `localStorage` (المكتبة، حد 50 نتيجة، والثيم). لا يوجد ما يمكن استعادته من جهتنا، وهذا سبب تصميمي لا نقص.

تحقق أن التراجع نجح:
</div>

```bash
npm run test:smoke -- https://sayedelazameydesign-crypto.github.io/celia.sh/ 
```

<div dir="rtl">

## 2. تدوير `GROQ_API_KEY` **[المالك]**

اتبع `docs/OPERATIONS.md` §2. الأوامر القابلة للنسخ بعد التدوير:

</div>

```bash
# 1. الخادم صار يستخدم المفتاح الجديد؟ اطلب طلبًا صغيرًا من الواجهة المنشورة.
# 2. الاختبار الحي من GitHub (لا يحتاج كمبيوترك):
gh workflow run groq-smoke.yml -f model=openai/gpt-oss-120b
gh run watch "$(gh run list --workflow=groq-smoke.yml --limit 1 --json databaseId --jq '.[0].databaseId')"
# المتوقع: groq_smoke=passed reason=ok
```

<div dir="rtl">

## 3. إيقاف وضع الذكاء الاصطناعي فورًا (إساءة استخدام)

لا تحتاج كودًا ولا نشرًا:

| الطريقة | الخطوات |
| --- | --- |
| إبطال الوصول | غيّر `AI_ACCESS_CODE` في إعدادات الاستضافة وأعد النشر — كل رمز قديم يصبح باطلًا |
| إيقاف كامل | احذف `GROQ_API_KEY` من الاستضافة → `/api/v1/status` يعيد `configured:false` والخدمة تُغلق بنظافة |
| تقييد الحصة | اجعل `AI_DAILY_LIMIT=1` مؤقتًا |

**تحقق:**

</div>

```bash
curl -s https://<api-base>/api/v1/status   # المتوقع: {"configured":false,"provider":"groq"}
```

<div dir="rtl">

## 4. قراءة مقاييس الصحة التشغيلية

كل طلب AI يكتب سطر JSON واحد في سجل الاستضافة، بلا أي محتوى:

</div>

```json
{"event":"ai_request","outcome":"rejected","code":"rate-limit","status":429,"latency":"le_250","tool":"summary"}
```

<div dir="rtl">

| ما تراه | المعنى | التصرف |
| --- | --- | --- |
| `code=rate-limit` متكرر | عميل واحد يتجاوز 6 طلبات/دقيقة | طبيعي؛ لا تصرف |
| `outcome=failed code=provider-limit` | حصة المزوّد استُهلكت | راجع `docs/FREE-TIERS.md`، أوقف مؤقتًا |
| `code=provider-auth` | المفتاح غير صالح | دوّر المفتاح فورًا (§2) |
| `code=not-configured` | الخادم بلا مفاتيح | إعداد، لا خلل |
| لا سطور إطلاقًا مع طلبات فاشلة | الخادم لا يعمل | افحص نشر الاستضافة |

**الحد المعروف:** هذه عدّادات وذاكرة داخل نسخة واحدة. لا تجمعها `serverless` ولا تصمد بعد إعادة التشغيل. للاستخدام العام تحتاج حصة مركزية — وهذا مذكور كقيد مقصود لا كميزة.

## 5. فحص صيانة كامل قبل أي إصدار

</div>

```bash
npm ci
npm run check            # lint + tests + build
npm run test:coverage    # العتبات المحروسة
npm run check:docs       # انحراف الوثائق
npm run check:build      # مخرجات البناء
node scripts/guard-secrets.mjs
npx playwright install chromium && npm run test:browser
```

<div dir="rtl">

## 6. إضافة أداة رابعة

1. المعرّف في `shared/tools.ts`.
2. صفحة في `src/pages/` + سطر في `src/tools/index.ts`.
3. وحدة في `server/tools/` + سطر في `server/tools/index.ts`.
4. محرّك محلي في `src/lib/` إن كانت تعمل بلا مزوّد.
5. اختبار في `tests/engines.test.ts` — الاختبار الموجود «السجلان متزامنان» يفشل تلقائيًا لو نسيت سطرًا.

المولّد الآلي `npm run new:tool` **غير منفّذ بعد**؛ الخطة في `docs/SELF-MAINTAINING.md` فجوة G8، وحالته `planned` لا `done`.

</div>
