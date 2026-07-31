# ROX AI — Backend (Gatekeeper + Fallback Router + Queue + Stripe + Supabase)

Ce dossier contient le squelette technique du système "الحارس" (Gatekeeper),
renforcé par 3 ajouts : bascule automatique entre modèles (fallback),
audit trail infalsifiable des crédits, et une file d'attente pour les
tâches lourdes (image/vidéo).

## Contenu

| Fichier | Rôle |
|---|---|
| `01_schema.sql` | Table `profiles` (crédits, statut d'abonnement) + `admin_logs` |
| `02_rls_policies.sql` | Sécurité de la base : chacun ne voit/modifie que son propre profil |
| `03_audit_log.sql` | **Nouveau** — `credit_audit_log` (ledger détaillé) + vue `credit_audit_mismatches` |
| `04_deduct_credit_function.sql` | **Nouveau** — fonction Postgres atomique (déduction + log en une seule transaction) |
| `05_generation_jobs.sql` | **Nouveau** — table de suivi des jobs en file d'attente |
| `aiRouter.js` | **Nouveau** — bascule Claude → Qwen/DeepSeek si le modèle principal échoue |
| `gatekeeper.js` | Vérifie les crédits avant tout appel payant, journalise via la RPC atomique |
| `lib/queue.js` | **Nouveau** — configuration BullMQ + Redis (partagée serveur/worker) |
| `worker.js` | **Nouveau** — processus séparé qui traite les jobs image/vidéo |
| `server.js` | Serveur Express — `/api/chat` (sync, avec fallback), `/api/generate-image` et `/api/generate-video` (async, mis en file), `/api/job-status/:id` |
| `stripeWebhook.js` | Passe l'utilisateur en "pro" automatiquement après paiement |
| `createCheckoutSession.js` | Crée la session de paiement Stripe (bouton "Upgrade") |
| `frontend/CreditCounter.jsx` | Composant React : compteur de crédits en direct + bouton upgrade |
| `.env.example` | Liste des clés à renseigner |

## Mise en place, étape par étape

1. **Supabase** : SQL Editor → exécutez dans l'ordre `01_schema.sql`,
   `02_rls_policies.sql`, `03_audit_log.sql`, `04_deduct_credit_function.sql`,
   `05_generation_jobs.sql`.
2. **Redis** : local → `docker run -p 6379:6379 redis` ; production → add-on
   Redis Railway/Render, copiez l'URL dans `REDIS_URL`.
3. **Variables d'environnement** : copiez `.env.example` en `.env`, remplissez
   Supabase/Stripe/Replicate + `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`,
   `REDIS_URL`.
4. **Installer les dépendances** :
   ```bash
   npm install express @supabase/supabase-js stripe replicate dotenv bullmq ioredis
   ```
5. **Stripe** : Dashboard → Developers → Webhooks → endpoint
   `https://votre-domaine.com/webhook`, événement `checkout.session.completed`.
6. **Lancer en local** — deux process séparés :
   ```bash
   node server.js   # API
   node worker.js   # traite la file image/vidéo — sans lui, les jobs restent 'queued'
   ```
7. **Déployer** : le serveur API et le worker sont deux *services* distincts
   (ex. sur Railway : un "Web Service" pour `server.js`, un "Worker Service"
   pour `worker.js`), tous deux connectés au même Redis et aux mêmes
   variables Supabase.

## Les 3 ajouts en détail

### 1. Fallback automatique (`aiRouter.js`)
`/api/chat` n'appelle plus un seul modèle : il essaie Claude Sonnet 5, et si
la requête échoue ou dépasse 15s, bascule silencieusement vers Qwen3 Coder
(OpenRouter) puis DeepSeek R1. L'utilisateur ne voit jamais l'échec — seul
`credit_audit_log.fallback_triggered` garde une trace de quel modèle a
réellement répondu.

### 2. Audit infalsifiable (`03_audit_log.sql` + `04_deduct_credit_function.sql`)
Chaque consommation de crédit passe maintenant par la fonction Postgres
`deduct_credit_and_log`, qui met à jour `profiles.credits_used` **et** insère
la ligne d'audit **dans la même transaction** — impossible qu'un crash laisse
les deux désynchronisés. La vue `credit_audit_mismatches` (à requêter
périodiquement, ou via un cron) révèle immédiatement toute divergence, signe
d'une modification directe du solde en dehors de ce chemin.

### 3. File d'attente (`lib/queue.js` + `worker.js`)
`/api/generate-image` et `/api/generate-video` ne bloquent plus le serveur :
ils créent une ligne `generation_jobs` (statut `queued`) et répondent
immédiatement avec un `jobId`. Un processus `worker.js` séparé consomme la
file Redis (BullMQ), traite les jobs avec retry automatique (3 tentatives,
backoff exponentiel), et met à jour la ligne. Le frontend interroge
`/api/job-status/:jobId` (ou s'abonne via Supabase Realtime) pour afficher
la progression. Résultat : un pic de demandes remplit la file au lieu de
faire planter le serveur.

## Sécurité importante

- `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, `ANTHROPIC_API_KEY`,
  `OPENROUTER_API_KEY` ne doivent **jamais** être exposées côté client.
- Le client (navigateur) n'utilise que `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  protégée par les policies RLS.
- `credit_audit_log` et `admin_logs` sont en lecture bloquée pour tout le
  monde sauf le service role (`for select using (false)`).

## Limites à connaître

Reset mensuel/quotidien des crédits (`last_reset_date`) à automatiser via
un cron Supabase avant un lancement public.

---

# Pass de renforcement v3

Cinq failles réelles trouvées dans la version précédente, corrigées ici.
Chacune était présente dans le code que vous avez fourni, pas théorique :

| Faille trouvée | Fichier(s) | Correction |
|---|---|---|
| `userId` lu depuis `req.body`/`x-user-id` — n'importe qui pouvait dépenser les crédits d'un autre compte | `server.js`, `createCheckoutSession.js` | **Nouveau** `lib/auth.js` : vérifie un vrai token de session Supabase, `req.userId` vient du token, jamais du body |
| Aucune limite de requêtes par utilisateur | `server.js` | **Nouveau** `lib/rateLimit.js` : compteur Redis par utilisateur (chat 20/min, image 10/min, video 4/min) |
| `deduct_credit_and_log` sans `FOR UPDATE` + déduction faite APRÈS la génération (image/vidéo ne déduisaient rien avant d'entrer en file) → race condition + file remplissable gratuitement | `04_deduct_credit_function.sql` → `06_hardening_idempotent_deduct.sql`, `gatekeeper.js`, `server.js`, `worker.js` | `reserveCredits()` déduit de façon atomique et **idempotente** (row lock + `requestId` unique) AVANT tout appel modèle ou mise en file ; `refundCredits()` rembourse si le travail échoue finalement |
| `aiRouter.js` sans mémoire d'état — retente Claude→Qwen→DeepSeek en entier à chaque requête même si un modèle est mort depuis 500 requêtes | `aiRouter.js` | **Nouveau** `07_model_health.sql` + `lib/modelHealth.js` : vrai circuit breaker à 3 états (`closed`/`open`/`half_open`), partagé entre toutes les instances du serveur via Postgres, caché dans Redis |
| Aucune métrique — impossible de voir le taux de fallback, la latence par modèle, ou si la file s'accumule sans interroger Supabase à la main | — | **Nouveau** `lib/metrics.js` + `GET /metrics` (format Prometheus) |

## Le fil conducteur : un seul `requestId`

Pour une requête chat, ou un job image/vidéo, un seul UUID (`crypto.randomUUID()`,
généré dans `server.js`) sert à la fois de :
- `credit_audit_log.request_id` (idempotence de la déduction/remboursement)
- `generation_jobs.id` (au lieu du défaut `gen_random_uuid()`)
- `jobId` BullMQ

Un seul id à chercher dans les logs pour retracer toute l'histoire d'une
requête, du paiement jusqu'au résultat (ou au remboursement).

## Nouvelle installation, étapes supplémentaires

1. Exécutez `06_hardening_idempotent_deduct.sql` puis `07_model_health.sql`
   après les 5 fichiers SQL existants (dans l'ordre numérique).
2. `npm install prom-client` en plus des dépendances existantes.
3. Le frontend doit maintenant envoyer le token de session Supabase
   (`Authorization: Bearer <access_token>`) sur chaque appel à
   `/api/chat`, `/api/generate-image`, `/api/generate-video`, et
   `/api/create-checkout-session` — voir `frontend/CreditCounter.jsx`
   pour l'exemple sur le bouton upgrade. Les autres appels frontend
   (chat, génération) doivent être mis à jour de la même façon s'ils ne
   passent pas déjà par un client qui ajoute ce header automatiquement.
4. Aucune nouvelle variable d'environnement requise — l'auth réutilise
   `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` déjà présents.

## Ce qui reste une décision humaine (pas du code)

- Les seuils de rate limit (`lib/rateLimit.js`) et de circuit breaker
  (`p_failure_threshold`, cooldown dans `07_model_health.sql`) sont des
  valeurs de départ — à ajuster avec du trafic réel.
- Les métriques (`rox_refund_total`, etc.) existent ; les règles
  d'alerte visuelles (dashboard Grafana/PagerDuty) restent à créer —
  `system_alerts` (voir ci-dessous) leur donne maintenant une source
  fiable à interroger, mais l'écran/la notification reste à brancher.

---

# Pass de renforcement v3.1

Quatre trous fermés, tous listés dans la section précédente comme
"pas encore fait" :

| Trou | Fichier(s) | Correction |
|---|---|---|
| `stripeWebhook.js` ne vérifiait pas si un `event.id` avait déjà été traité — Stripe redélivre parfois le même événement | `stripeWebhook.js` → `webhook_events` (`08_maintenance.sql`) | Chaque event Stripe est inséré (clé primaire = `event_id`) avant traitement ; une violation de contrainte unique = doublon, on acquitte sans rejouer |
| Un `refundCredits()` qui échoue ne finissait que dans un `console.error` — invisible si personne ne lit les logs à ce moment-là | `gatekeeper.js` (`reportRefundFailure`) | Persisté dans `refund_failures` (queue à traiter manuellement) + `system_alerts` (`08_maintenance.sql`) en plus du log |
| `credit_audit_mismatches` (vue) et le reset mensuel des crédits n'étaient reliés à aucun cron | `08_maintenance.sql` | `check_credit_audit_mismatches()` et `reset_monthly_credits()` — planifiables via `pg_cron` ou via `POST /internal/maintenance/run` (protégé par `CRON_SECRET`) pour les projets Supabase sans `pg_cron` |
| Aucun header CORS — dépendait du hasard (same-origin) plutôt que d'une règle explicite | `server.js` | `ALLOWED_ORIGINS` (liste blanche, séparée par virgules) — voir `.env.example` |

## Nouvelle installation, étapes supplémentaires (v3.1)

1. Exécutez `08_maintenance.sql` après les 7 fichiers SQL existants.
2. Renseignez `ALLOWED_ORIGINS` dans `.env` (sinon le frontend ne pourra
   plus appeler l'API depuis un navigateur).
3. Planifiez la maintenance — choisissez UNE des deux options (voir
   `08_maintenance.sql` §5) :
   - `pg_cron` activé sur Supabase → décommentez les deux
     `cron.schedule(...)` dans le fichier SQL.
   - sinon → renseignez `CRON_SECRET` dans `.env` et pointez un
     scheduler externe (cron job Railway/Render, GitHub Actions
     planifié, cron-job.org) vers `POST /internal/maintenance/run`
     avec le header `x-cron-secret`.
4. `refund_failures` et `system_alerts` sont des tables à interroger
   manuellement pour l'instant (`select * from refund_failures where
   resolved = false;`) — les brancher à Slack/PagerDuty reste à faire
   selon l'outil que vous utilisez déjà.

---

# Pass de renforcement v3.2 — routage sensible à la marge

Avant cette version, `aiRouter.js` ne changeait de modèle qu'après une
panne (le modèle principal tombe ou dépasse 15s). Sous forte charge avec
tous les modèles en bonne santé, 100% des requêtes `chat` continuaient
donc à être facturées au tarif Claude — le coût réel montait de façon
linéaire avec le trafic au lieu de s'aplatir. Cette passe ajoute un
**second** déclencheur, indépendant de la santé des modèles : la charge.

| Ajout | Fichier(s) | Rôle |
|---|---|---|
| Coût réel par requête | `lib/modelCosts.js` | Convertit les tokens (`usage`) de chaque appel modèle en coût USD estimé, à partir d'une table de tarifs à tenir à jour manuellement |
| Marge par requête | `lib/creditEconomics.js` | `CREDIT_PRICE_USD` (revenu d'un crédit, dérivé de votre plan réel) − coût réel = marge, en USD |
| Signal de charge globale | `lib/loadGuard.js` | Compteur Redis (`requests/min`, tous utilisateurs confondus) sur `/api/chat` — distinct du rate-limit **par utilisateur** de `lib/rateLimit.js` |
| Routage réordonné sous charge | `aiRouter.js` (`getEffectiveChain`) | Si charge = `high` sur `chat` : la chaîne est triée du moins cher au plus cher — Claude n'est plus retiré, juste passé en dernier recours |
| Traçabilité | `server.js` → `credit_audit_log.metadata` | Chaque requête réussie enregistre `cost_usd`, `margin_usd`, `load_level`, `chain_reordered` — aucune migration de schéma requise (colonne `metadata` déjà `jsonb`) |
| Vue agrégée | `09_margin_tracking.sql` | `rox_margin_last_24h` / `_7d` : marge par feature/modèle ; `check_negative_margin_last_24h()` repère les combinaisons qui perdent de l'argent |
| Endpoint opérateur | `server.js` → `GET /internal/margin-summary` | Même protection que `/internal/maintenance/run` (`x-cron-secret`) — pratique pour un digest Slack/email quotidien |
| Métriques Prometheus | `lib/metrics.js` | `rox_model_cost_usd_total`, `rox_margin_usd_last_request`, `rox_load_level` |

## Installation

1. Exécutez `09_margin_tracking.sql` après les 8 fichiers SQL existants.
2. Renseignez `CREDIT_PRICE_USD` dans `.env` — calculez-le à partir de
   votre plan réel (prix mensuel / crédits alloués), pas d'un chiffre
   arbitraire, sinon `margin_usd` ne veut rien dire.
3. `LOAD_ELEVATED_RPM` / `LOAD_HIGH_RPM` sont des valeurs de départ à
   ajuster avec du trafic réel (voir section suivante).
4. Aucune nouvelle dépendance npm.

## Important à savoir

- Ce mécanisme protège la **marge par requête**, pas les coûts fixes
  (serveur, Redis). Ceux-là restent amortis passivement par le volume —
  voir la discussion "économies d'échelle" plus bas dans l'historique
  de conversation du projet, ou `rox_margin_last_24h` pour vérifier que
  la marge variable reste positive en pratique.
- `lib/modelCosts.js` contient des tarifs **de départ**, pas branchés en
  direct sur les dashboards Anthropic/OpenRouter. À tenir à jour
  manuellement — un tarif obsolète fausse `margin_usd` sans casser la
  facturation réelle des crédits (celle-ci reste inchangée).
- Le réordonnancement ne s'applique qu'à `chat` (la chaîne `code` mène
  déjà par le modèle bon marché) et seulement au niveau `high` — le
  niveau `elevated` réduit uniquement le timeout du modèle principal
  (6s au lieu de 15s) sans changer l'ordre, pour échouer plus vite vers
  le fallback sans sacrifier la marge prématurément.
- `LOAD_THROTTLE_ENABLED=false` désactive tout ce mécanisme si vous
  préférez d'abord observer `rox_load_level` en production avant de
  laisser le routage réagir automatiquement.

---

# Pass de renforcement v3.3 — anti-abus / anti-flood

**Important à lire d'abord :** aucun rate-limiter, aucune validation
d'entrée, ne rend un système "impossible à hacker" — personne ne peut
promettre ça honnêtement. Ce qui suit augmente sérieusement le coût
d'un abus automatisé (comptes en masse, flood, tokens volés/devinés,
payloads surdimensionnés) et donne des signaux clairs (`system_alerts`,
`/metrics`) quand quelque chose d'anormal se produit — ce n'est pas une
garantie absolue.

| Faille | Fichier(s) | Correction |
|---|---|---|
| Aucune limite globale par IP — seulement par utilisateur (`lib/rateLimit.js`). Un attaquant avec plusieurs comptes (ou tokens volés/devinés) n'était jamais vu comme une seule source | **Nouveau** `lib/ipGuard.js` | `ipRateLimit()` : compteur Redis par IP, toutes routes/utilisateurs confondus (défaut 120 req/min) |
| Un token invalide/expiré pouvait être retenté indéfiniment — pas de protection contre le bourrage d'identifiants (credential stuffing) | `lib/auth.js` → `lib/ipGuard.js` | `recordAuthFailure()` : après N échecs (défaut 20 en 10 min), l'IP est bloquée temporairement (défaut 30 min), avant `requireAuth` |
| `callOpenRouter()` n'avait AUCUNE limite de tokens de sortie (contrairement à Claude, déjà plafonné à 2048) — un modèle de raisonnement comme DeepSeek R1 peut consommer énormément de tokens cachés sans limite | `aiRouter.js` | `MAX_OUTPUT_TOKENS` appliqué aux deux providers, configurable |
| Aucune validation de la FORME du body — un utilisateur authentifié légitime pouvait quand même envoyer des milliers de messages ou des messages de plusieurs Mo | **Nouveau** `lib/inputValidation.js` | `validateChatBody` / `validatePromptBody` — rejetés en 400 AVANT `reserveCredits()`, donc aucun crédit consommé sur une requête malformée |
| Limite de taille de body implicite (100kb par défaut d'Express, jamais fixée explicitement) | `server.js` | `express.json({ limit: '32kb' })` |
| Pas de `trust proxy` — `req.ip` renvoyait l'IP du proxy (Railway/Render), pas celle du client réel, rendant tout rate-limit par IP inutile | `server.js` | `app.set('trust proxy', 1)` |
| Aucun header de sécurité de base | `server.js` | `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` (sans dépendance supplémentaire) |

## Installation

1. Aucune nouvelle dépendance npm, aucune nouvelle table SQL.
2. Renseignez les nouvelles variables `.env` (valeurs de départ déjà
   dans `.env.example`) : `MAX_OUTPUT_TOKENS`, `IP_RATE_LIMIT_RPM`,
   `AUTH_FAIL_BLOCK_*`, `MAX_MESSAGES_PER_CHAT`, `MAX_CHARS_PER_MESSAGE`,
   `MAX_TOTAL_CHARS_PER_CHAT`, `MAX_PROMPT_CHARS`.
3. **Si vous déployez derrière un proxy** (Railway, Render, Cloudflare,
   nginx…) — ce qui est presque toujours le cas — vérifiez que
   `app.set('trust proxy', 1)` correspond à votre topologie réelle
   (un seul proxy devant l'app). Mal configuré, `req.ip` peut soit
   rester celui du proxy (rate-limit inutile), soit être falsifiable
   via un header `X-Forwarded-For` si plusieurs proxys sont mal
   comptés — voir la doc Express sur `trust proxy` pour votre cas précis.

## Ce qui reste hors du périmètre de ce backend

- **La création de comptes** (signup) est gérée par Supabase Auth côté
  client — ce dossier ne voit jamais cette étape, donc il ne peut pas
  limiter "combien de comptes gratuits une même personne peut créer".
  Ça se configure côté Supabase (CAPTCHA sur signup, vérification email
  obligatoire, etc.) ou via un service anti-fraude tiers.
- **DDoS volumétrique** (au niveau réseau, pas applicatif) — `lib/ipGuard.js`
  protège la couche application ; un vrai DDoS se filtre en amont
  (Cloudflare, le load balancer du hébergeur), pas dans Express.
- **Prompt injection** (un utilisateur qui manipule le modèle avec son
  propre prompt) est une préoccupation différente de la sécurité de
  l'infrastructure — hors du périmètre de cette passe.

## Vérifier que ça marche vraiment : `test-hardening.js`

Script autonome, en dehors de l'app (`node test-hardening.js`) — il tape
sur une instance QUI TOURNE déjà, en vrai HTTP, donc un succès ici prouve
le comportement réellement déployé, pas juste la logique unitaire.

```bash
# Terminal 1
node server.js

# Terminal 2 — contre la même instance, mêmes REDIS_URL/limites que .env
BASE_URL=http://localhost:3001 REDIS_URL=redis://localhost:6379 node test-hardening.js
```

Ce qu'il fait, dans l'ordre :
1. **Flood IP** — tape `GET /metrics` (pas d'auth requise) au-delà de
   `IP_RATE_LIMIT_RPM` fois, vérifie qu'un `429` finit par apparaître.
2. **Auth stress** — envoie des Bearer tokens invalides en boucle sur
   `POST /api/chat`, vérifie les `401`, puis vérifie que l'IP se fait
   bloquer (`429`) une fois `AUTH_FAIL_BLOCK_THRESHOLD` dépassé.
3. **Payload surdimensionné** — envoie un body > 32kb, vérifie un `413`
   (ou `400`) — donc jamais traité par un handler.
4. **Validation authentifiée** (optionnel) — seulement si vous fournissez
   `AUTH_TOKEN=<vrai access_token Supabase>`. `lib/inputValidation.js`
   tourne APRÈS `requireAuth`, donc un token invalide (test 2) ne peut
   jamais l'atteindre — ce test-là a besoin d'une vraie session.
5. Affiche les clés Redis (`ipload:*`, `authfail:*`, `ipblocked:*`) créées
   par le run comme preuve indépendante des codes HTTP, **puis les
   supprime** — sinon le run bloque votre propre IP de dev pendant
   `AUTH_FAIL_BLOCK_COOLDOWN_MIN` minutes.

**À savoir avant de lancer :**
- **Ne le lancez pas contre la prod** — il déclenche délibérément le
  blocage IP.
- **`credit_audit_log` restera vide pour tout ce test, et c'est normal** :
  cette table ne loggue que ce qui a atteint `gatekeeper.reserveCredits()`
  (donc passé l'auth ET la validation). Une requête bloquée ne doit
  JAMAIS coûter un crédit — donc elle n'a jamais de ligne dans le ledger.
  La preuve, c'est les codes HTTP + les clés Redis affichées par le
  script, pas `credit_audit_log`.

---

# Pass de renforcement v3.4 — avant lancement public

Revue complète du projet consolidé, quatre trous réels trouvés et fermés
(deux auraient cassé la génération image/vidéo dès le premier appel) :

| Faille | Fichier(s) | Correction |
|---|---|---|
| Hash de version Replicate tronqué (SDXL) et hash ne correspondant à aucune version réelle (vidéo) — toute génération image/vidéo aurait échoué immédiatement | `worker.js` | Passage aux références `owner/model` non-épinglées (toujours la version courante) au lieu de hashs codés en dur — élimine toute la classe de bug |
| `input_image` recevait le PROMPT TEXTE de l'utilisateur — `stability-ai/stable-video-diffusion` est image-to-video, il ne lit aucun texte | `worker.js` | Remplacé par `wan-video/wan-2.2-t2v-fast`, un vrai modèle text-to-video qui accepte `{ prompt }` |
| `update_own_profile` (RLS) vérifie la propriété de la ligne mais pas les colonnes — un client authentifié pouvait en théorie s'auto-attribuer `credits_total`/`subscription_status` via un appel `.update()` direct (aucun code actuel ne le fait, mais rien ne l'empêchait) | **Nouveau** `10_profile_column_lockdown.sql` | Trigger `BEFORE UPDATE` qui restaure ces colonnes à leur valeur existante sauf si l'appel vient du service role |
| `queue.add()` pouvait échouer APRÈS la réservation de crédit et l'insertion de la ligne `generation_jobs` (ex. coupure Redis) — le job restait bloqué en `queued` pour toujours, facturé, jamais traité | `server.js` | `queue.add()` est maintenant dans un `try/catch` : en cas d'échec, la ligne passe à `failed`, le crédit est remboursé, réponse `503` immédiate |

Deux points additionnels, pas des failles mais des lacunes fonctionnelles/
d'hygiène corrigées dans la même passe :

- **`rox-ai-mobile.html` n'envoyait jamais l'historique de conversation** —
  chaque message repartait de zéro (`messages: [{role:'user', content:text}]`),
  alors que `lib/inputValidation.js` accepte déjà jusqu'à 40 messages.
  Le frontend garde maintenant l'historique par feature (`chat`/`code`),
  en mémoire seulement, et ne le commit qu'après une réponse réussie
  (l'API Anthropic exige une alternance stricte user/assistant — committer
  avant l'appel aurait pu empiler deux tours `user` de suite après un
  échec/retry).
- **`GET /metrics` était public sans option de le fermer**, alors qu'il
  expose des chiffres business réels (`rox_model_cost_usd_total`,
  `rox_margin_usd_last_request`). `METRICS_TOKEN` (optionnel, voir
  `.env.example`) le protège désormais si vous le renseignez — laissé
  vide, le comportement ne change pas.
- Le README racine du projet indiquait `SUPABASE_SERVICE_KEY` alors que
  le code et `.env.example` utilisent `SUPABASE_SERVICE_ROLE_KEY` —
  corrigé (c'était une incohérence de documentation, jamais un bug de
  code).

## Installation

1. Exécutez `10_profile_column_lockdown.sql` après les 9 fichiers SQL
   existants.
2. Aucune nouvelle dépendance npm.
3. Optionnel : renseignez `METRICS_TOKEN` dans `.env` avant un lancement
   public si `/metrics` sera accessible depuis l'extérieur.
4. Si vous aviez déjà un frontend déployé avec l'ancien `rox-ai-mobile.html`,
   remplacez-le — l'historique de conversation change la forme du body
   envoyé à `/api/chat` (toujours validé par `lib/inputValidation.js`,
   rien à changer côté serveur).
