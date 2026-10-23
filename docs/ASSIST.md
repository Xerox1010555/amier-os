# Amier OS — Your Personal Assistant on This Laptop

صار **مساعدك الشخصي يعمل الآن على هذا اللابتوب**. تلقّه شيئاً — عربي أو إنجليzi —
يراجعك محددة، توافق، ينفّذ عبر النواة الأمنية. هذه الصفحة تجمّع كل شيء بسلسلة:
إطلاق · لُغته · ثيماته · أمانه.

---

## 1) التشغيل (كعِادة يومية)

| الطريقة | كيف |
|---|---|
| **اختصار سطح المكتب** ✅ (أُنشئ لك) | "Amier OS" — يقلع بضغطة، وإذا أول مرة يهيّئ الاعتمادات تلقائياً |
| **البدء مع ويندوز** | `powershell -ExecutionPolicy Bypass -File scripts\create-shortcut.ps1 -Startup` — أو شغّّل مفتاح *التشغيل مع الدخول* في الإعدادات داخل النسخة المُثبَّتة |
| **يدوياً** | شغّل `scripts\amier.bat` أو `powershell -ExecutionPolicy Bypass -File scripts\dev.ps1` |

المُطلق يتولى: تحميل `services/ai-orchestrator/.env` · اختيار المزوّد تلقائياً ·
تشغيل الخدمة مطويّة · فتح نافذة التطبيق · يلي الطلب يفتح يوتيوب فيصير acontecer.

## 2) التحدث بالعربية (والإنجليزية)

التطبيق يفهم: *"افتح يوتيوب"*, *"شغّل آلة حاسبة"*, *"اعمل فولدر مطبوعات"* —
وبالمقابل "open YouTube / calculator / make a folder". للفهم الحي بكل اللغات
يحتاج مزوّداً حقيقياً (60ث إعداد):

1. افتح `services/ai-orchestrator/.env` (انسخها من `.env.example` لو غير موجودة).
2. حط **`GEMINI_API_KEY=...`** (مجاني من Google AI Studio) — أو OPENAI/ANTHROPIC.
3. أعد `amier.bat`. سيكشف المزوّد تلقائياً وprovider يتحوّل من `mock` إلى `gemini`.

بدون مفتاح: يعمل **المساعد المحلي** (عربي/إنجليزي: يوتيوب، تطبيقات، بحث، مجلدات —
مُختبَر 24 حالة) والإعدادات المتقدمة تحتاج مزوّداً حقيقياً.

## 3) جوّك: الثيمات (جديدة)

الإعدادات → **المظهر** — خمسة مطابقة تعمل سريعاً وتُحفظ:
Aurora (أزرق) · Emerald (زمردي) · Violet (بنفسجي) · Crimson (ناري) · Mono (فولاذي).
تحوّل كامل النظام: الدرعة، المدارات، حواف، ونصوص — خلال 0.4ث بانتقال ناعم.

## 4) كيف ينفّذ (قانون الأمان)

كل خطأ يمر في سلسلة واحدة:

> LLM يعرض → محرك Rust (35 قاعدة) يصنّف بالضبط → تراجع وتوافق → يتنفّذ → سجل تدقيق hash-chain يخلده.

لذا *"افتح يوتيوب"* — خطوة واحدة `cmd /c start "" https://youtube.com` تُعرَف low
risk وتُنفَّذ بعد موافقتك، بينما أي شيء حذف/تهيئة/صلاحيات يعلق أحمر حتى موافقتك
الصريحة — ولا يمكن للنموذج أن يقلل التصنيف نفسه.

## 5) صيانة

| ماذا | أين |
|---|---|
| فضّ السجل الكلي | شاشة **History** + ملف `AppData\...\Amier OS\jarvis\jarvis.db` |
| مفتاح السرّ | الإعدادات → الحقل (يُخزَّن keychain) |
| إعادة بناء المحرك | `npm run core:build` (تحتاج rustup — مثبّت قبل قليل) |

## English quick card

- **Run**: Desktop shortcut "Amier OS" (auto-bootstrap + service + app).
- **Ask**: `افتح يوتيوب` or `open YouTube` → review plan → approve → done.
- **Real NLU**: put a provider key in `services/ai-orchestrator/.env` (the
  launcher auto-detects gemini/openai/anthropic; otherwise offline `mock`).
- **Themes**: Settings → Appearance (5 instant glass moods, persisted).
- **Autostart**: the Windows Startup shortcut (`-Startup`) or the in-app
  "Launch at login" switch (packaged builds — boots minimized to tray).
- **Safety**: every command crosses the Rust rules engine + your confirmation +
  the hash-chained audit log; the model can only escalate risk, never lower it.
