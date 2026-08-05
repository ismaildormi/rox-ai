
## v0.64 Safe Bridge workflow

Do not copy this ZIP manually over production. Extract it separately and run `ROX-BRIDGE.cmd`. The bridge preserves the existing Git/hosting links and secrets, activates Local, validates the import, and never pushes or deploys automatically. See `docs/SAFE_BRIDGE.md`.

# ROX AI — مشروع موحد

هاد المجلد فيه النسخة الوحيدة الصحيحة، مجمعة من الملفات المتفرقة اللي كانت
عندك من جلسات مختلفة. `rox-ai-backend-v4_pro_max_.zip` و `metricsServer.js`
(المنفذ 9100) تحيدو عمدا — كانوا نسخ قديمة/موازية كتضارب مع v6.

## البنية

```
backend/     — v6 (النسخة الكاملة الوحيدة: hardening + credits + metrics)
              server.js فيه CORS مفتوح غير على /metrics (باقي الـ API
              محمي بـ ALLOWED_ORIGINS كيفما كان)
frontend/    — index.html (رابط واحد كايختار تلقائياً بين واجهة الهاتف
              وواجهة الحاسوب، فيه Supabase Auth وواجهة الترجمة الكاملة)
tools/       — rox-ai-telemetry.html (dashboard كيقرا /metrics مباشرة،
              بأسماء الحقول الصحيحة ديال v6)
```

## العمارة (Architecture)

`ARCHITECTURE.md` (فالجذر) فيه الخريطة الكاملة: البنية المعيارية
(`backend/src/core`, `backend/src/modules`, `backend/src/api/v1`), نظام
الـ feature flags (`backend/config/feature-flags.json`), وين غيدخل كل
فيتشر مستقبلي (Teams, Plugins, Agents, Webhooks, إلخ) بلا ما نعاودو
نكتبو الكود الحالي. الأرقام اللي كانت مكتوبة مباشرة فـ `server.js`
(تكلفة الكريديت، الحدود) دابا فـ `backend/config/plans.json` و
`backend/config/models.json`.

## قبل ما تخدم

1. `cd backend && npm install` (يخدم دابا — `package.json` مزيد فالمشروع)
2. Supabase → SQL Editor: خدم `01_schema.sql` حتى `16_settle_credit_charge.sql`
   **بالترتيب الرقمي** (`10_profile_column_lockdown.sql` كيسد ثغرة كانت
   كاينة فـ RLS، و`12_extension_schema.sql` جديد — كيزيد أعمدة/جداول
   فاضيين مقفولين بـ RLS لتحضير المشروع للميزات الجاية، و
   `13_advisor_optimizer_schema.sql` كيزيد الجداول ديال AI Business
   Advisor/Auto Optimizer + عمود `profiles.is_admin` — خاصهم يتخدمو حتى
   هوما، ماشي اختياري، ما كيبدلو أي حاجة كاينة).
3. عمر `.env` (نسخ من `.env.example`) — خاصك على الأقل:
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `REDIS_URL`
4. **الوحيد اللي بقا معلق:** راجع `CONFIG` داخل نسختي الهاتف والحاسوب فـ `frontend/index.html`:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   (من نفس مشروع Supabase اللي فـ `.env` ديال backend)
5. `npm install && ./cli/rox.js setup` (فالجذر ديال المشروع، ماشي فـ `backend/`)
   — كيدير `npm install`، كيتأكد Redis خدام (ويبداه بـ Docker إلا كانت
   local وماشي خدامة)، كيطبق `.sql` files إلا عندك `SUPABASE_DB_URL`
   فـ `.env`، وكيسجل pm2 باش يبداو الخدمات معاه فأي reboot.
   من بعد: `./cli/rox.js start` — كيبدا السيرفر والـ worker بجوج، ماخصكش
   تبدا كل واحد فـ terminal بوحدو. الكوماندات الكاملين (start/stop/
   update/backup/restore/health) فـ `docs/CLI.md`.
6. افتح `frontend/index.html` (فضل تخدمو بـ local server ماشي
   `file://` باش الـ Supabase Auth يخدم مزيان)، وزيد العنوان اللي كتفتح
   منو فـ `ALLOWED_ORIGINS` فـ `.env`
7. افتح `tools/rox-ai-telemetry.html` وضغط Fetch باش تشوف `/metrics`
   (إلا عمرتي `METRICS_TOKEN` فـ `.env`، خاصك تدخلو فالـ tool هو الآخر).
   للـ health check السريع (بلا ما تفتح tool): `./cli/rox.js health`.
8. **AI Business Advisor / Auto Optimizer** (جديد): بدّل `is_admin` لـ
   `true` فـ صف `profiles` ديالك فـ Supabase (ماكاينش UI لهادشي بعد —
   يدوي عمدا، ماشي كل يوزر قادر يولي admin من واجهة). زيد `CRON_SECRET`
   فـ `.env` وعمر scheduler (cron خارجي، أو Railway/GitHub Actions cron)
   يضرب `POST /internal/advisor/run-daily` بـ header
   `x-cron-secret: <CRON_SECRET>` مرة فالنهار. افتح
   `tools/rox-ai-admin-dashboard.html` (خاصك تدخل فيه توكن Supabase
   ديال حساب admin) باش تشوف التقرير اليومي، الـ health scores،
   التوصيات، والـ optimizer.

## Docker (طريقة تانية، اختيارية — ماكاتبدلش ./cli/rox.js)

الطريقة ديال فوق (`./cli/rox.js setup/start`, pm2) هي الأساسية ومازال
كتخدم بحالها بلا حتى تبديل. Docker هنا طريقة تانية مستقلة، خاصك بيها إلا
بغيتي local dev بلا ما تبدا Redis يدوي، أو deployment بلا pm2:

1. `cp backend/.env.example backend/.env` — عمر بالقيم الحقيقية (نفس
   الملف اللي كيتقرا فـ CLI path).
2. `docker compose up --build` (من جذر المشروع) — كيبدا 3 حاجات:
   `redis` (7-alpine, محلي), `backend` (`backend/Dockerfile`, `node
   server.js`, بورت 3001), و`worker` (`backend/Dockerfile.worker`, `node
   worker.js`, ماعندوش بورت).
3. `docker compose logs -f backend` / `worker` — باش تشوف الـ logs
   (`docker logs` هو المعادل ديال pm2's out/err files هنا).
4. `docker compose down` (وقف + مسح الـ containers)، أو `docker compose
   down -v` باش تمسح معاها الـ Redis volume.

Supabase/Stripe/Anthropic/OpenRouter/Replicate بقاو خدمات خارجية فـ
الحالتين بجوج (CLI ولا Docker) — الفرق الوحيد هو Redis (كيخدم local
داخل compose) وشكل الـ process supervision (pm2 مقابل `restart:
unless-stopped` ديال Docker). تفاصيل أكثر فـ `ARCHITECTURE.md` §13.

**ماشي مبني بعد**: automated backup ديال deployment المبني بـ Docker
(`rox backup`/`restore` مازالهم كيفترضو الطريقة ديال pm2/bare-metal —
شوف `ARCHITECTURE.md` §12). CI و CD (build + push تلقائي) دابا
موجودين — شوف تحت. Staging deployment و Production deployment دابا هوما
الآخرين موجودين (شوف تحت).

## CI (build + test تلقائي على كل push/PR)

`.github/workflows/ci.yml` — كيخدم وحدو على GitHub Actions، ماكاين
حتى إعداد يدوي. أربع خطوات، خاصهم يعديو بلا مشاكل قبل ما يتدمج أي PR
فـ `main`:

1. **lint** — syntax check ديال كل ملفات `.js` (`node --check`)، صحة
   الـ JSON ديال `package.json`، وصحة `docker-compose.yml`.
2. **test-cli** — `npm run test:cli` (5 ملفات، 38 test).
3. **test-backend** — `npm run test:unit` فـ `backend/` (mocked
   Supabase، ماخصوش database حقيقية).
4. **docker-build** — كيبني الجوج images (`backend/Dockerfile`,
   `Dockerfile.worker`) باش يتأكد أنهم قابلين للبناء — بلا push لحتى
   registry (هادشي ديال CD).

تفاصيل أكثر فـ `ARCHITECTURE.md` §13a.

## CD (build + push تلقائي ديال الـ images)

`.github/workflows/cd.yml` — كيخدم بعد ما CI ينجح فـ `main` (ولا على
tag `v*.*.*`، ولا يدوي بـ `workflow_dispatch`). كيبني ويدير push ديال
`backend` و`worker` images لـ **GHCR** (`ghcr.io`) — بلا حتى secret
زايد، كيستعمل `GITHUB_TOKEN` اللي كاين ديجا. **ماكايديرش deploy** —
غير build + push ديال الـ image، حيت مازال ماشي مقرر Railway ولا
Render ولا platform آخر (شوف `ARCHITECTURE.md` §13b).

تفاصيل أكثر فـ `ARCHITECTURE.md` §13b.

## Staging Deployment (deploy تلقائي بعد CD)

`.github/workflows/deploy-staging.yml` — كيخدم من بعد ما CD (فوق) ينجح
فـ push للـ `main`، ولا يدوي بـ `workflow_dispatch`. كياخد الـ images
اللي CD دابا زاد فـ GHCR وكيدير عليهم deploy فـ SSH لأي server عندك
فيه Docker — provider-agnostic بحال CD، حيت مازال ماشي مقرر Railway
ولا Render (نفس السبب).

- محتاج GitHub Environment سميتو `staging` فيه 5 secrets (SSH host/user/
  key/port/deploy-dir) — التفاصيل الكاملة فـ `docs/DEPLOYMENT.md`.
- الـ secrets ديال التطبيق (Supabase، Stripe...) ماكايعديوش من GitHub
  Actions — كايبقاو فـ ملف `.env` مباشرة فـ server، بحال `backend/.env`
  بالضبط.
- بعد كل deploy، كايدير health check على `/healthz` (نفسها اللي
  `rox health` كيستعمل). إلا فشلت، كايدير rollback أوتوماتيكي للـ tag
  اللي كان خدام قبل، بلا ما يبقى staging وقف.
- Rollback يدوي ممكن من `workflow_dispatch` بـ `rollback: true`.

تفاصيل أكثر (setup ديال server، secrets، troubleshooting) فـ
`docs/DEPLOYMENT.md` و `ARCHITECTURE.md` §13c.

## Production Deployment (blue/green، deploy يدوي غير)

`.github/workflows/deploy-production.yml` — كيخدم غير يدوي
(`workflow_dispatch` بـ tag محدد)، ماكايتشغلش تلقائي بعد CD ولا بعد
staging بحال deploy-staging.yml — production خاصو إنسان يختار الـ tag
بيديه، وخاص GitHub Environment سميتو `production` (فيه required
reviewers) يوافق قبل ما يبدا أي SSH.

- **Zero-downtime**: `backend-blue` و`backend-green` خدامين بجوج
  ديما — nginx قدامهم كيقرر شكون كيدير traffic حقيقي. كل deploy
  كيمشي غير للـ color اللي ماشي active، كيدير عليه health check
  مباشرة (بلا nginx)، ومن بعد كيدير `nginx -s reload` (graceful،
  بلا ما يوقع request حتى وحدة). إلا فشل الـ health check، الـ
  color اللي active ماكيتبدلش والـ production ماكيتأثرش خالص.
- **Rollback**: instant — غير flip ديال nginx للـ color اللي كان
  active قبل، بلا pull ولا restart، حيت هو باقي خدام.
- محتاج GitHub Environment سميتو `production` فيه 5 secrets (نفس
  البنية ديال staging) + required reviewers — التفاصيل الكاملة فـ
  `docs/DEPLOYMENT.md`.

تفاصيل أكثر فـ `docs/DEPLOYMENT.md` و `ARCHITECTURE.md` §13d.

## آخر تصليحات (قبل الإطلاق)

- **`worker.js`**: الموديلات ديال Replicate (صورة/فيديو) كانو بـ hash
  غلط/ناقص — image/video ما كانوش غادي يخدمو والو. تصلحو، وفيتشر
  الفيديو دابا كيستعمل موديل text-to-video حقيقي بدل ما كان كيبعث النص
  كأنه صورة.
- **`server.js`**: إلى طاح Redis بزربة بين إنشاء الـ job وإضافتو للـ queue،
  دابا كيتعمل refund تلقائي بدل ما يبقى الـ job معلق للأبد وهو مخصوم
  عليه.
- **`10_profile_column_lockdown.sql`** (جديد): كان اليوزر يقدر تقنيا يبدل
  `credits_total`/`subscription_status` ديالو من المتصفح مباشرة (RLS
  كانت كتشيك غير على الـ row، ماشي على الأعمدة). دابا محمي بـ trigger.
- **`/metrics`**: زدنا `METRICS_TOKEN` اختياري (فـ `.env.example`) باش
  ماشي أي حد عندو الرابط يشوف المارج الحقيقي ديالك.

## Windows one-click manager (v0.63)

On Windows, extract the release ZIP and double-click `ROX-MANAGER.cmd`.
The manager centralizes setup, configuration, start/stop/restart, health repair,
full tests, logs, backups/restores, safe ZIP updates with rollback, Supabase
migrations, Stripe sandbox tools, Railway/Vercel deploy helpers, and a redacted
support-report ZIP.

First run:

1. Double-click `ROX-SETUP.cmd`.
2. Enter the service values when prompted. Secrets are written only to
   `backend/.env`; browser-safe values are written to `frontend/rox-config.js`.
3. Use `ROX-MANAGER.cmd` for all later work.

Detailed instructions: `docs/WINDOWS_ONE_CLICK.md`.
