# Preflight — do these before opening Claude Code (~30 min, one time)

Claude Code produces its best work when nothing has to be mocked. Every key below missing = a stubbed integration = quality drop. Do these in order.

## 1. Supabase (~10 min)

* Create a new project at supabase.com (name: stead-dev, region us-west). *(Done 2026-08-30: created as `stead-dev` in us-east-1 — owner's choice, matching their other projects — ref `aqkjkarrhancuqxxukus`.)*
* Install CLI: `npm i -g supabase`, then `supabase login` and, once the repo exists, `supabase link --project-ref <ref>`.
* Copy into .env: Project URL → VITE_SUPABASE_URL, anon key → VITE_SUPABASE_ANON_KEY, service_role key → SUPABASE_SERVICE_ROLE_KEY.
* Auth → Providers: enable Google (paste OAuth client from Google Cloud console) and keep Email (magic link) on.

## 2. Stripe (~10 min)

* Create account (or use existing) — TEST MODE for everything.
* Developers → API keys: secret → STRIPE_SECRET_KEY, publishable → VITE_STRIPE_PUBLISHABLE_KEY.
* Enable Connect, platform profile, Express accounts (Settings → Connect).
* Install Stripe CLI; local webhooks: `stripe listen --forward-to localhost:54321/functions/v1/stripe-webhook` → copy the whsec_… value → STRIPE_WEBHOOK_SECRET.
* Note for Slice 7: Stripe Identity requires activating the account even for test mode — skip until that slice.

## 3. Resend (~3 min)

* Create API key → RESEND_API_KEY. Dev can send from onboarding@resend.dev; verify a real domain before anything public. Set OPS_ALERT_EMAIL to yourself.

## 4. Passport signing key (~1 min)

* `openssl genpkey -algorithm ed25519 | base64 -w0` → PASSPORT_SIGNING_KEY.

## 5. Repo

* Empty repo → drop in: CLAUDE.md, BUILD_PROMPT.md, PREFLIGHT.md, .env.example, and the /design folder. Copy .env.example → .env, fill it, confirm .env is gitignored.
* Node 20+ (`node -v`).

## 6. Kick off Claude Code

Open Claude Code at the repo root and paste: "Read CLAUDE.md and /design/DESIGN_HANDOFF.md, then execute BUILD_PROMPT.md starting at Slice 1. Output the migration SQL, RLS policies, and file tree first and wait for my go." Discipline that keeps quality high: one slice per session; approve the plan before code; require typecheck + tests green before accepting a slice done.

## 7. Your manual verification (non-delegable)

After Slices 2, 3, and 6: walk the money paths yourself in Stripe's test dashboard — deposit auth appears at check-in, cancels on release, captures correctly on a split claim, refunds match the policy preview. Test card 4242 4242 4242 4242. Payment edge cases are where AI-written code most needs human eyes; acceptance criteria are necessary but not sufficient here.

## Remote-environment deviation (recorded 2026-07-12)

This repo is built from a remote Claude Code environment, so §2's `stripe listen` step doesn't apply — there is no localhost to forward webhooks to. Instead:

* The `stripe-webhook` edge function is deployed to the hosted Supabase project (JWT verification off; the function authenticates requests via Stripe signature verification).
* A webhook endpoint is created via the Stripe API pointing at the deployed function URL (`https://<project-ref>.supabase.co/functions/v1/stripe-webhook`), subscribed to the events BUILD_PROMPT §7 handles: `payment_intent.succeeded`, `charge.dispute.created`, `charge.dispute.closed`, `account.updated`.
* The endpoint's signing secret is stored as `STRIPE_WEBHOOK_SECRET` in two places: a Supabase edge-function secret and the local `.env`.
* Secrets enter the sandbox via the Claude Code environment's variable settings, never via chat.
