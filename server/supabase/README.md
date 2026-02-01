# Supabase Question Graph

## 1) إنشاء الجداول

انسخ محتوى [schema.sql](file:///c:/Projects/PlayerQI/server/supabase/schema.sql) وشغّله داخل Supabase SQL Editor.

## 2) متغيرات البيئة المطلوبة (Server-only)

ضعها في `server/.env`:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

مهم: استخدم `SERVICE_ROLE_KEY` في السيرفر فقط ولا تضعه أبداً في العميل (React).

## 3) ماذا نخزن؟

- `question_nodes`: كل سؤال كنص فريد.
- `question_transitions`: انتقالات الشبكة: (سؤال سابق + إجابة المستخدم) -> (سؤال جديد أو تخمين).

## 4) كيف يقلل هذا التكاليف؟

السيرفر يحاول أولاً استخراج السؤال التالي من قاعدة البيانات. إذا وجد انتقال مناسب، يرجع السؤال مباشرة بدون استدعاء DeepSeek أو Serper. إذا لم يجد، يستدعي الذكاء الاصطناعي ثم يحفظ النتيجة كـ Transition لتستفيد منها كل الألعاب القادمة.
