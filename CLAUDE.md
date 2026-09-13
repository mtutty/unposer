# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AI-powered career profile platform that uses conversational AI to build comprehensive candidate profiles beyond traditional resumes. The MVP focuses exclusively on candidate intake, implementing the 8-step onboarding flow in `docs/onboarding-ux-flow-spec.md` (design-locked for v1 — read it before changing flow/step behavior).

**Tech Stack:**
- Frontend: Angular 22 (standalone components — the default, no `standalone: true` needed — signals, new control flow syntax)
- Backend: Express 5 + TypeScript, Node 24
- Database: PostgreSQL 18 via `pgvector/pgvector:pg18` (no official `-alpine` variant for pg18 yet) with Knex.js migrations; pgvector backs the `profile_evidence`/`conversation_evidence` semantic-search tables (see AI Integration below)
- AI: `@langchain/openai` / `@langchain/anthropic` v1 directly (provider-agnostic via `backend/src/ai/llm.ts`, defaults to OpenAI gpt-4o) — the `langchain` meta-package isn't a dependency, we never needed it
- Reverse Proxy: Nginx
- Infrastructure: Docker Compose with multi-stage builds (Node 24-alpine)

## Quick Start Commands

```bash
# Initial setup
cp .env.template .env             # Configure LLM_API_KEY
docker-compose up -d              # Start all services (migrations run automatically)

# Access
# Application: http://localhost (via nginx)
# Dev mode also exposes: :4200 (frontend), :3000 (api), :5432 (db)
# Dev login: devuser/devpass (role: user), devadmin/devadminpass (role: admin)

# Common operations
docker-compose logs -f api        # View API logs
docker-compose exec api npx knex migrate:make <name>  # New migration
docker-compose exec postgres psql -U appuser -d appdb  # DB access
docker-compose down -v            # Full reset (destroys data)
```

## Architecture Principles

**Nginx Reverse Proxy:**
- Production: the `frontend` container's own bundled nginx serves the built Angular static files and proxies /api to backend — config is `frontend/nginx.conf`, baked into the image at build time (`COPY` in `frontend/Dockerfile`'s production stage), not bind-mounted, since it never varies by environment
- Development: a separate standalone `nginx` service (base `docker-compose.yml`) proxies to the Angular dev server (hot-reload) and backend — config is `nginx/nginx.dev.conf`, bind-mounted in by `docker-compose.override.yml` (the only thing that makes that service runnable; see the comment on it in `docker-compose.yml`)

**Multi-Stage Builds:**
- Frontend Dockerfile has 3 stages: development, build, production
- Development: Node dev server with hot-reload
- Production: Nginx serving static build output
- Controlled via `target` in docker-compose

**Environment Configuration:**
- All services use `env_file: .env` - no manual passthrough needed
- DATABASE_URL constructed in docker-compose from POSTGRES_* vars
- Single source of truth: `.env` file

**Stateless Services:** All state lives in PostgreSQL. Services can be restarted without data loss.

**Server-Driven UI:** Step definitions and progression logic live server-side (backend/src/models/flow-steps.ts). Frontend reads from API.

**Provider Abstraction:** LLM provider is configurable via environment variables. LangChain provides the abstraction layer.

## Database Patterns

- **All schema changes via Knex migrations** - never modify database directly
- Migrations in `backend/src/db/migrations/`
- Use transactions for multi-step operations
- Always write `down` migrations for rollback capability
- JSONB columns for flexible structured data (resume, profile, extracted intake data)

Key tables:
- `users` - Auth via OIDC or dev bypass
- `sessions` - Server-side session management
- `flow_progress` - Current step + per-step status + chosen logistics channel
- `resumes` - Resume file + structured extraction; `confirmed`/`confirmed_at` gate it from being treated as ground truth (Step 2)
- `logistics_responses` - Step 3 factual/preference data (goals, target roles, location, priorities), channel-agnostic
- `conversation_threads` - One row per (user, step) for Step 3 (app or email) and Step 5 (app only); tracks channel, message cap, silence/nudge state
- `messages` - Unified message log for both chat and email-simulation channels — no separate "email profile"
- `candidate_profiles` - Generated profile (`profile_data.insights` are narrative + evidence, never bare scores) + `correction_log` for the flag→re-ask loop
- `profile_evidence` / `conversation_evidence` - pgvector-backed semantic-search tiers behind `search_candidate_evidence` (see AI Integration below): `profile_evidence` is distilled/authoritative (insights + STAR stories, wholesale-replaced on every profile regeneration so a corrected insight can never be outranked by a stale one); `conversation_evidence` is raw substrate (resume/logistics/deep-prompt chunks), historical and never overridden by a later correction
- `sandbox_messages` - Step 7 practice-interview transcript; `flagged_gap`/`gap_note` feed back into the profile's `openQuestions`
- `share_links` - Step 8 time-boxed tokens; no revocation beyond `expires_at`, no analytics (by design, see spec)

## Backend Structure

```
backend/src/
├── config/          # Environment config
├── db/              # Knex connection, migrations, seeds
├── middleware/      # Auth, validation (zod), error handling
├── routes/          # Express routes (auth, resume, flow, logistics, inbox, profile, sandbox, share, public, requisitions)
├── services/        # Business logic (stateless)
├── ai/              # LangChain chains: llm.ts (provider factory) + one chain per AI task
├── websocket/       # WebSocket server for live chat (logistics app-channel + deep_prompts)
├── models/          # Flow step definitions (flow-steps.ts)
└── types/           # TypeScript interfaces
```

**Key Conventions:**
- TypeScript strict mode enabled
- No `any` types without documentation
- All routes validate input with zod schemas
- Services throw `AppError` with code/message/status
- Global error handler formats responses

## Frontend Structure (Angular 22)

```
frontend/src/app/
├── core/            # Singleton services (auth, api, websocket, flow, resume, logistics, inbox, profile, sandbox, share)
├── features/        # auth, dashboard, onboarding/ (one folder per step + shell), public-share
├── shared/          # Shared components (step-rail, chat-panel, topbar — the "notebook" design system)
└── models/          # TypeScript interfaces mirroring backend/src/types
```

**Angular 22 Patterns (IMPORTANT):**
- All components are **standalone by default** — omit `standalone: true`, don't add NgModules
- Use **new control flow**: `@if`, `@for`, `@switch` (NOT `*ngIf`, `*ngFor`)
- Use **signals** for reactive component state
- Services use `providedIn: 'root'`
- Bootstrapped via `bootstrapApplication` from `@angular/platform-browser` (`@angular/platform-browser-dynamic` and `@angular/animations` are not dependencies — neither is used)

**Styling:**
- No CSS framework — a custom "notebook" design system defined as CSS custom properties in `src/styles.scss` (dark umber chrome, warm paper content pane, a rotated stamp/seal motif for status/channel badges)
- Type roles: Space Grotesk (display/UI), Source Serif 4 (body/narrative content — profiles and stories read like prose), IBM Plex Mono (metadata/labels)
- Component-scoped SCSS/inline `styles: []` for component-specific layout; shared primitives (`.btn`, `.card`, `.stamp`, `.chat-bubble`, `.field`) live in the global stylesheet

## AI Integration (LangChain)

Implemented in `backend/src/ai/`, all going through the provider factory in `llm.ts` (never instantiate `ChatOpenAI`/`ChatAnthropic` directly in a chain):
- `resume-parser.chain.ts` - Extracts structured resume data (career-changer-aware); output is a draft until the Step 2 confirmation screen
- `elicitation.chain.ts` - Shared adaptive-turn engine behind Step 3 (logistics, any channel) and Step 5 (deep prompts); returns `{ reply, extracted, complete }`
- `reask.chain.ts` - Step 6 correction path: turns a flagged insight into one targeted follow-up question, never a direct edit
- `profile-generator.chain.ts` - Synthesizes the Step 6 profile from resume + logistics + deep-prompt transcript; insights must cite evidence, never a bare score
- `sandbox-chat.chain.ts` - Powers both Step 7 (candidate's own sandbox) and Step 8 (public share link) identically; default context is still whole-profile-as-context (the compact digest covers most questions), with `search_candidate_evidence` (see below) as an on-demand fallback rather than a vector store stuffed into every turn

**Pattern:** Load context (resume, progress, chat/message history — windowed to the most recent `config.flow.elicitationHistoryWindow`/`sandboxHistoryWindow` messages, not full unbounded replay) → LLM call (structured output via zod where the result feeds persistence) → Extract/evaluate → Persist → Update progress

**Evidence retrieval (`embeddings.ts` + `evidence-search.tool.ts` + `services/evidence.service.ts`):** pgvector-backed semantic search over the `profile_evidence`/`conversation_evidence` tables (see Database Patterns above), exposed to `sandbox-chat.chain.ts` as an LLM-invocable tool (`search_candidate_evidence`) via a new non-streaming `resolveToolCall` helper in `llm.ts`, rather than being included in every turn's context by default. `EvidenceService.search` is two-phase and distilled-preferred: it queries `profile_evidence` first and only reaches into `conversation_evidence` to fill out remaining results, ranking distilled hits ahead of raw ones regardless of relative similarity score. Embeddings are a deliberate exception to the provider-agnostic principle above — Anthropic has no embeddings API, so `embeddings.ts` always goes through OpenAI (`EMBEDDINGS_API_KEY`, falling back to `LLM_API_KEY` only when `LLM_PROVIDER=openai`) regardless of the configured chat provider.

## Onboarding Flow

Server defines steps (backend/src/models/flow-steps.ts), implementing docs/onboarding-ux-flow-spec.md:
1. `resume` - Upload & parse, or career-changer manual entry — either way, gated by a confirmation screen
2. `logistics` - Goals/target roles/location/priorities; candidate picks **app or email** (Step 3/4 in the spec)
3. `deep_prompts` - Open-ended "tell me about a time..." stories; **live chat only**, no self-scoring ever
4. `profile_review` - AI-generated profile; flagging an insight triggers one targeted re-ask, never a direct edit
5. `sandbox` - Candidate chats with their own approved profile as a recruiter would
6. `share` - Time-boxed link giving recruiters the identical sandbox chat experience

Each step has: `channels` (which of app/email it supports), a `completionCriteria` string fed to the LLM turn, and illustrative `conversationStarters` (not a fixed script).

**Rail presentation vs. data model:** the 6 steps above are still the unit of progress tracking (`steps_state`, `current_step` all key off them, unchanged), but the rail groups them into two stages via `flowStages` (also in flow-steps.ts, served alongside `steps` from `/api/flow/steps`): **"Tell Your Story"** (resume, logistics, deep_prompts — each still its own rail sub-entry) and **"Interview Yourself"** (profile_review is the rail entry; sandbox and share are `railVisible: false` — reached as CTAs on the profile/sandbox pages once the profile is approved, not as separate rail tabs). See "Stages vs. Steps" in the spec doc.

Frontend reads step *and stage* definitions from `/api/flow/steps` and renders the progress rail accordingly. **Never hardcode steps or stages in UI.**

**Email gateway (real, via Resend):** the Step 3 email channel is a real gateway now, not just the in-app simulated inbox — `backend/src/services/email.service.ts` (outbound) and `backend/src/routes/webhooks.routes.ts` (inbound, verified with `svix` against Resend's Svix-based webhook signing) turn a candidate's real email reply into the same `ConversationService.postUserMessage` call a chat reply makes, and turn the AI's reply back into a real outbound send — `ConversationService` itself is untouched, exactly the additive shape this section used to describe as future work. Routing key: every `conversation_threads` row gets an `inbound_token` (DB-generated), used as the `reply+<token>@<EMAIL_INBOUND_DOMAIN>` address so the webhook can find the thread without a session. **Deliberate asymmetry:** every system/AI-generated message on an email-channel thread is really emailed (the elicitation opener, a reply to genuine inbound email, silence nudges) *except* the response to a reply typed into the in-app inbox view (`InboxService.reply`) — that one stays in-app-only by design, so a candidate who answers in-app instead of by email won't see our next question in their real inbox until the next nudge. `RESEND_API_KEY`/`RESEND_WEBHOOK_SECRET` unset (the default) keeps everything simulated in-app exactly as before — see `infra/README.md`'s "Inbound/outbound email (Resend)" section for setup and `backend/src/scripts/simulate-inbound-email.ts` for testing without a real inbound email. Resume intake by email is still unbuilt — see the spec doc's Step 4 section.

## Employer-Side Onboarding

A parallel, independent workstream on top of the same `users`/auth model — see
`docs/employer-onboarding-spec.md` (design, phased) and
`docs/employer-onboarding-implementation-plan.md` (status tracker). **Phases 1–2 are built:**
- **Phase 1** — a new `'employer'` role (invite-only, same `invited`/`invited_role` mechanism as
  the existing `'invited'` role — see Security Notes below) and plain CRUD over a new
  `job_requisitions` table (`RequisitionService`, `POST/GET /api/requisitions`,
  `GET/PATCH /api/requisitions/:id`, gated by the new `requireEmployer` middleware), surfaced at
  `/employer/requisitions` (`features/employer/`, `employerGuard`).
- **Phase 2** — org/situational/cultural Q&A. Live-chat-only (spec §2.2), same
  `runElicitationTurn` engine Step 3 logistics uses, called directly from
  `RequisitionConversationService` (no `requisition-elicitation.chain.ts` wrapper — see that
  service's own comment for why). One thread per requisition (`requisition_threads`/
  `requisition_messages`, no channel column), reached over the same POST+SSE model every chat
  surface in the app uses (`GET /api/requisitions/:id/qa`, `POST /api/requisitions/:id/qa/message`
  — see "Streaming Chat" below). Completion
  flips `job_requisitions.status` to `'active'` and (best-effort, never gating completion)
  triggers `RequisitionCultureSignalService.regenerate` — an employer's direct description of
  their own team's culture, tagged onto the *same* `CvfQuadrant` vocabulary the candidate side's
  `culture_signal` uses (spec §4's decision, 2026-09-12), but into its own
  `requisition_culture_signal` table: `culture_signal` specifically means "a candidate's *former*
  employer's culture, inferred indirectly," a different provenance than an employer describing
  their *current* team directly, so the two are never blended into one table.

Nothing else in this workstream (search, virtual interviews, batch scoring — Phases 3–5) exists
yet, each blocked on its own flagged product decision in the spec.

## Streaming Chat (SSE)

**Backend done, frontend not yet migrated** — see `docs/websocket-to-sse-migration-plan.md` for
the frontend task list (still on the old `WebSocketService`/`ws?step=...` transport as of this
writing; every chat surface is broken in the running app until that iteration lands).

**No WebSocket in this app any more** — `backend/src/websocket/server.ts` was removed (2026-09).
Every chat surface (candidate logistics/deep_prompts, employer requisition Q&A, and
sandbox/share/future virtual-interview chat) now speaks one interaction model: plain `POST`,
streamed back over Server-Sent Events (`backend/src/utils/sse.ts`'s `startSSE`/`writeSSEEvent`).
Decided over a WebSocket-based design that predated it: nothing in this app ever used a socket's
real differentiator (server-initiated push independent of the client's own message — confirmed by
checking that the old `WSServer` was never referenced outside its own instantiation), and only
sandbox-style chat has real token-by-token content to stream, so one uniform, simpler transport
covers every case — a non-streaming chain (`runElicitationTurn`/`runTopicTurn`) just emits one
`delta` frame with its whole reply before `done`, rather than the client needing two different
parsers for "the turn that streams" vs. "the turn that doesn't."

Not backed by the browser's native `EventSource` API on the client: `EventSource` is GET-only,
and every one of these is a POST (the client has to send the message/content as a body). The
frontend instead reads the SSE framing off a `fetch()` response body's `ReadableStream` — real
`event:`/`data:` lines, not a bespoke NDJSON scheme (which is what sandbox.routes.ts used before
this migration).

**Endpoints:**
- `GET /api/logistics/open`, `POST /api/logistics/message` — candidate Step 3 app channel
- `GET /api/deep-prompts/open`, `POST /api/deep-prompts/message` — candidate Step 5 app channel
- `GET /api/requisitions/:id/qa`, `POST /api/requisitions/:id/qa/message` — employer Phase 2 Q&A
- `POST /api/sandbox/message` — Step 7 sandbox chat (the one surface with real streaming content
  and tool-call events; `GET /api/sandbox/` is plain JSON history, not SSE)

The email channel (logistics/deep_prompts) and the public share link (Step 8) stay plain
non-streaming REST as before — nothing about them changes here.

**Event vocabulary** (not every route emits every type):
- `delta` — `{ text }`, a chunk of the reply (sandbox) or, for a non-streaming chain, the one
  complete reply
- `tool_call_start` / `tool_call_end` — `{ tool }`, sandbox/interview chat only: an LLM-invoked
  tool (`search_candidate_evidence`) ran mid-turn. Never carries the tool's query or results —
  just that a lookup happened, consistent with the recruiter-audience guardrails (spec §8) that
  already keep raw evidence out of anything shown verbatim
- `done` — the turn's final persisted result (`message`, `complete`, and step-specific extras —
  `progress` for a candidate step that just completed, `thread` for requisition Q&A)
- `citations` — sandbox only, may arrive after `done` (a separate follow-up call — see
  `identifySandboxCitations`)
- `error` — `{ code?, message }`, in place of `done` when the turn fails after streaming has
  already started (a pre-stream failure — e.g. validation, an already-complete thread — is a
  normal JSON error response instead, since headers haven't been sent yet)

## Development Workflow

### Development Mode (default)
```bash
docker-compose up -d  # Uses docker-compose.override.yml automatically
```
- Angular dev server with hot-reload on :4200
- Nginx proxies to dev server and API
- All ports exposed for debugging
- Source mounted as volumes

### Production Mode
Real deployment (unposer.com) — not something you run ad hoc from a local
checkout. `docker-compose.yml` alone (skipping the override file) is
**not** a supported production mode: it still binds the dev-shaped `nginx`
service to host port 80 with no TLS. Production layers
`docker-compose.production.yml` on top instead, which adds a new
`nginx-proxy` service (Let's Encrypt via certbot) in front of the same
`frontend`/`api`/`postgres` services. The base `nginx` service must be
left out of the service list explicitly — Compose merges `ports` across
files rather than letting an override clear it, so there's no way to
override `nginx` down to "unpublished"; naming the services you want is
the only reliable fix (`infra/run-unposer` / `infra/update-unposer` do
this already):
```bash
docker compose -f docker-compose.yml -f docker-compose.production.yml \
  --env-file .env up -d api postgres frontend nginx-proxy certbot
```
- Angular built and served from the `frontend` container's own nginx
  (`frontend/nginx.conf`, baked into the image — see Nginx Reverse Proxy
  above), which also proxies `/api` to `api`
- `nginx-proxy` only terminates TLS and forwards everything to `frontend`
  — see `infra/nginx/prod.conf.template`
- Only ports 80/443 exposed
- Multi-stage Dockerfile produces optimized images
- First run on a fresh host needs `infra/init-letsencrypt.sh` before
  anything else — see `infra/README.md` for the full runbook (server
  layout, `.env` setup, SSL bootstrap, and the CI-driven `deploy` branch
  that `infra/update-unposer` polls)

### Making Changes
1. Source code changes auto-reload in dev mode
2. Database changes require migrations:
   ```bash
   docker-compose exec api npx knex migrate:make descriptive_name
   # Edit migration file
   docker-compose restart api  # Restart to auto-run new migration
   ```
3. Nginx config changes:
   - `nginx/nginx.dev.conf` (dev-mode standalone proxy) is bind-mounted — just restart:
     ```bash
     docker-compose restart nginx
     ```
   - `frontend/nginx.conf` (the frontend container's own production nginx) is baked into the
     image — needs a rebuild, not just a restart:
     ```bash
     docker-compose build frontend && docker-compose up -d frontend
     ```

**Testing:**
```bash
cd backend && npm test              # jest, runs *.test.ts under src/
cd frontend && npm test             # ng test — interactive Chrome, watches
cd frontend && npm run test:ci      # headless single-run, what CI uses
```
`.github/workflows/ci.yml` runs both (plus `npm run build` and a plain
`docker build` of each Dockerfile) on every push/PR to `main`; only a
passing push promotes `deploy`. See the Known TODOs entry below for current
coverage — it's real but narrow, not comprehensive.

**Auto-Migration on Startup:**
The backend container automatically:
- Waits for PostgreSQL to be ready
- Runs pending migrations
- Shows migration status
- Starts the application

This is handled by `backend/docker-entrypoint.sh`

## Common Patterns

**Adding a new API endpoint:**
1. Create route in `backend/src/routes/*.routes.ts`
2. Add validation schema (zod)
3. Implement service method in `backend/src/services/`
4. Use `AppError` for errors
5. Add to route registration in `backend/src/app.ts`

**Adding a new frontend feature:**
1. Create component in `frontend/src/app/features/`
2. Use standalone component with imports
3. Use signals for state
4. Use new control flow syntax
5. Add route to `app.routes.ts`

## Security Notes

- Sessions via HTTP-only cookies (no localStorage)
- CORS configured for frontend origin only
- Input validation on all routes (zod)
- Parameterized queries via Knex (SQL injection protection)
- Dev auth only when explicitly enabled
- Never log sensitive data (passwords, tokens, API keys)
- **Invitation-only mode** (`INVITE_ONLY_MODE` env flag, `config.inviteOnly.enabled`): when on, OIDC self-registration no longer creates an immediately-usable account — see `upsertOidcUser` in `backend/src/services/auth.service.ts`. A third role, `'invited'`, is a placeholder `users` row (email only, `oidc_provider`/`oidc_subject` null) created by an admin via `POST /api/admin/users/invite` (`AdminService.inviteUser`, Users page "Invite a user" form) and emailed a sign-in link (`EmailService.sendInvite`, same disabled-by-default Resend gate as the rest of the email gateway); it flips to `invited_role` (a `users` column set at invite time, default `'user'`) automatically — claiming that row rather than inserting a new one — the first time that email actually authenticates via OIDC, regardless of whether invite-only mode is on. A fourth role, `'employer'` (`docs/employer-onboarding-spec.md` §2.1), is invited the same way with `invited_role: 'employer'` — there's no self-service path onto it. `DELETE /api/admin/users/:id/invite` revokes a still-pending invite (400s on anything not role `'invited'`, so it can never delete a real account). The invite/revoke endpoints and dev-login both work regardless of the flag. Separately, a third `UserStatus` value, `'pending'`, covers *self*-registration while the flag is on: `upsertOidcUser` still creates the row (role `'user'`) rather than rejecting the login, just with `status: 'pending'`. `requireAuth` (`backend/src/middleware/auth.ts`) 403s a pending account off every candidate-flow route the same way it does a `'suspended'` one — `GET/DELETE /api/auth/me` and `POST /api/auth/logout` deliberately bypass `requireAuth` so a pending user can still see their own status, cancel (delete) the account, or log out. The frontend's `pendingGuard` (`core/auth/auth.guard.ts`) routes a signed-in pending user to `/pending` (`PendingApprovalComponent`) instead of the dashboard; an admin approves by flipping status back to `'active'` from the Users page, which now filters/edits `'pending'` alongside `'active'`/`'suspended'`. The login page no longer shows an "Invitation only" badge; `GET /api/auth/providers`'s `inviteOnly` field is otherwise unused by the frontend now. `/login` doubles as the public splash (`/` just redirects there — there's no separate `SplashComponent` any more), and `PublicNavComponent` (brand + "How it Works" + "Sign in") is its header, also used by the new public `/how-it-works` page (`HowItWorksComponent`, timeline body factored into `HowItWorksContentComponent` so `PendingApprovalComponent` can reuse it too).

## Known TODOs

- [ ] Add file upload size/type validation UI
- [ ] Add error boundary components
- [ ] Add loading states throughout UI (chat/profile screens have basic pending states; not exhaustive)
- [ ] A dropped SSE stream mid-turn (network blip, tab backgrounded) has no automatic retry — the candidate/employer just sees the error line and has to resend. No open connection to reconnect any more (see "Streaming Chat (SSE)"), so this isn't a reconnection gap the way the old WebSocket one was, just a missing retry-the-turn affordance
- [ ] Expand test coverage (Jest for backend, Jasmine/Karma for frontend — both wired up and enforced in CI as of `.github/workflows/ci.yml`, no coverage threshold gate, just pass/fail). Backend is now fully covered: `routes/` (all 14, plus `middleware/auth.ts`'s `requireAuth`/`requireAdmin`/`requireEmployer` underlying them — every streaming route's SSE envelope has its own coverage too, parsing `event:`/`data:` frames back into objects, see sandbox.routes.test.ts's `parseSSE` helper), `ai/` (every chain, including the new `requisition-culture-signal.chain.ts` — tests mock `./llm`'s exports and assert prompt construction + response post-processing, not model behavior), and `services/` (most, grown alongside features as a matter of course — the remaining few are lower-risk). No `websocket/server.ts` any more — removed in the POST+SSE migration (see "Streaming Chat" above); nothing replaced its old test file since every route it used to front now has its own route-level tests instead. The only real gap left is frontend — only two specs exist (`frontend/src/app/shared/utils/text.ts`, `frontend/src/app/core/flow/flow.service.ts`), no component tests at all. Don't take that as a mandate to backfill component specs wholesale — the UI (admin screens, personality-engine views) is still actively being redesigned, so tests written against it now are likely to be tests rewritten soon; add them as each component's shape actually settles, same as the services/ pattern above.
- [x] ~~Add OIDC provider integration~~ — Google and GitHub are both done, same shared route pattern (`registerOidcRoutes` in `backend/src/routes/auth.routes.ts`) and shared user upsert (`upsertOidcUser` in `services/auth.service.ts`). Google goes through `google-auth-library`'s `OAuth2Client` (ID-token signature verification); GitHub is plain OAuth2 (no ID token to verify) hand-rolled with a couple of `fetch` calls to `github.com`/`api.github.com`. Redirect URIs are derived from `FRONTEND_URL`, not separate config — see `.env.template`. LinkedIn still not implemented — dev-login bypass remains the only working path for that
- [x] ~~Real email delivery for the Step 3 email channel~~ — done via Resend; see the "Email gateway (real, via Resend)" note above
- [x] ~~Scheduled nudges for stalled email threads~~ — `logistics-nudge-scheduler.service.ts`/`.cron.ts` proactively check the Step 3 (logistics) email thread against `InboxService`'s existing `threadNeedsNudge` predicate (shared with the in-app manual-nudge indicator, so the two paths can't disagree) and call the same `sendNudge` the on-demand path already used. Its own cron cadence (`LOGISTICS_NUDGE_CRON`, default hourly) but the same `SCHEDULER_ENABLED` master switch as Iteration 9's weekly scheduler below — a different mechanism from that one (this covers Step 3's `conversation_threads`/hours-of-silence; Iteration 9 covers Step 5's `topic_thread`/weeks), don't conflate the two
- [ ] Employer-side onboarding, matching/discovery, share-link analytics — explicitly out of scope for v1 per the spec's Future Features section
- [ ] **Not yet implemented:** Step 6.5 "Career Debrief" — a conversational coaching step between profile approval and the practice interview (environment fit, interview-facing strengths/blind spots, work-style takeaways). Proposed, not design-locked; see spec doc's Step 6.5 section for full scope, including a proposed 3rd rail stage ("Understand Yourself") that would move `profile_review` out of "Interview Yourself". Its industry-trends/salary-comparison half is a **hard block** until a real external market-data source is chosen — no chain may freehand salary/trend figures from LLM parametric knowledge in the meantime.

## Documentation

See `/docs` for comprehensive documentation on:
- Architecture, API, Database Schema
- Frontend/Backend patterns
- AI integration strategy
- Intake model details
- Coding standards
