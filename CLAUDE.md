# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AI-powered career profile platform that uses conversational AI to build comprehensive candidate profiles beyond traditional resumes. The MVP focuses exclusively on candidate intake, implementing the 8-step onboarding flow in `docs/onboarding-ux-flow-spec.md` (design-locked for v1 — read it before changing flow/step behavior).

**Tech Stack:**
- Frontend: Angular 22 (standalone components — the default, no `standalone: true` needed — signals, new control flow syntax)
- Backend: Express 5 + TypeScript, Node 24
- Database: PostgreSQL 18 (Alpine) with Knex.js migrations
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
# Dev login: devuser/devpass

# Common operations
docker-compose logs -f api        # View API logs
docker-compose exec api npx knex migrate:make <name>  # New migration
docker-compose exec postgres psql -U appuser -d appdb  # DB access
docker-compose down -v            # Full reset (destroys data)
```

## Architecture Principles

**Nginx Reverse Proxy:**
- Production: Serves built Angular static files, proxies /api and /ws to backend
- Development: Proxies to Angular dev server (hot-reload) and backend
- Configuration: `nginx/nginx.conf` (prod), `nginx/nginx.dev.conf` (dev)
- Automatic switching via `docker-compose.override.yml`

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
- `sandbox_messages` - Step 7 practice-interview transcript; `flagged_gap`/`gap_note` feed back into the profile's `openQuestions`
- `share_links` - Step 8 time-boxed tokens; no revocation beyond `expires_at`, no analytics (by design, see spec)

## Backend Structure

```
backend/src/
├── config/          # Environment config
├── db/              # Knex connection, migrations, seeds
├── middleware/      # Auth, validation (zod), error handling
├── routes/          # Express routes (auth, resume, flow, logistics, inbox, profile, sandbox, share, public)
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
- `sandbox-chat.chain.ts` - Powers both Step 7 (candidate's own sandbox) and Step 8 (public share link) identically; "RAG" is whole-profile-as-context, no vector store

**Pattern:** Load context (resume, progress, chat/message history) → LLM call (structured output via zod where the result feeds persistence) → Extract/evaluate → Persist → Update progress

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

**Email-gateway design intent:** most candidate interaction is meant to move to email over time (an SES-style gateway, potentially including resume intake), with the app as fallback rather than default — not built in v1, but the channel abstraction (`messages`/`conversation_threads` are channel-agnostic; `ConversationService` doesn't know or care which channel it's talking through) is meant to support it without rework. See the spec doc's Step 4 section for the intended adapter shape.

## WebSocket Events

Connection: `ws://<host>/ws?step=logistics|deep_prompts` — no token on the query string; the session is an httpOnly cookie that the browser attaches to the same-origin WS handshake automatically, and the server reads it off the upgrade request's `Cookie` header. Live chat exists only for these two steps (app channel); sandbox and the public share link are plain REST.

**Client → Server:**
- `chat:message` - User sends message
- `chat:typing` - Typing indicator (currently unused — single-participant thread)
- `chat:resume` - Request history + progress for the connected step

**Server → Client:**
- `chat:message` - AI response
- `progress:update` - Flow progress changed
- `step:complete` - The connected step just completed
- `error` - `{ code, message, retryable }`

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
  (`nginx/nginx.conf`), which also proxies `/api` and `/ws` to `api`
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
3. Nginx config changes require restart:
   ```bash
   docker-compose restart nginx
   ```

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

## Known TODOs

- [ ] Add file upload size/type validation UI
- [ ] Add error boundary components
- [ ] Add loading states throughout UI (chat/profile screens have basic pending states; not exhaustive)
- [ ] Implement proper WebSocket reconnection (currently reconnects only on manual navigation back into a chat step)
- [ ] Add tests (Jest for backend, Jasmine for frontend)
- [ ] Add OIDC provider integration (Google, GitHub, LinkedIn) — dev-login bypass is the only working path today
- [ ] Real email delivery for the Step 3 email channel — it's currently simulated in-app (same `conversation_threads`/`messages` rows as the app channel, rendered as an inbox) rather than wired to actual SMTP/IMAP; see `backend/src/services/inbox.service.ts`
- [ ] Scheduled nudges for stalled email threads — nudge is composed on-demand when the candidate opens the inbox, not by a background job
- [ ] Employer-side onboarding, matching/discovery, share-link analytics — explicitly out of scope for v1 per the spec's Future Features section
- [ ] **Not yet implemented:** Step 6.5 "Career Debrief" — a conversational coaching step between profile approval and the practice interview (environment fit, interview-facing strengths/blind spots, work-style takeaways). Proposed, not design-locked; see spec doc's Step 6.5 section for full scope, including a proposed 3rd rail stage ("Understand Yourself") that would move `profile_review` out of "Interview Yourself". Its industry-trends/salary-comparison half is a **hard block** until a real external market-data source is chosen — no chain may freehand salary/trend figures from LLM parametric knowledge in the meantime.

## Documentation

See `/docs` for comprehensive documentation on:
- Architecture, API, Database Schema
- Frontend/Backend patterns
- AI integration strategy
- Intake model details
- Coding standards
