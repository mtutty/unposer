# Employer-Side Onboarding — Implementation Plan & Status

*Execution tracker for building `docs/employer-onboarding-spec.md`. This doc is the resumption
point — a fresh session with no prior conversation should be able to read this file plus the spec
it tracks against, and pick up exactly where the last phase left off. Mirrors the
`docs/calibration-console-spec.md` (spec) / `docs/personality-engine-implementation-plan.md`
(tracker) split, per that spec's own §9.*

**How to resume in a new session:**
1. Read this file's status table below — the first row not marked ✅ Done is the current phase.
2. Read that phase's section in the spec (`docs/employer-onboarding-spec.md`) in full — this file
   only tracks status/deviations, the spec is still the source of truth for shape.
3. Each phase below is blocked on a real product decision until it's resolved — check the spec's
   own flag for that phase before starting.

---

## Status table

| # | Phase | Status | One-line goal |
|---|---|---|---|
| 1 | Post a job requisition | ✅ Done | Employer role + `job_requisitions` CRUD, no AI |
| 2 | Org/situational/cultural Q&A | ✅ Done | Live-chat elicitation + shared-vocabulary culture signal |
| 3 | Basic candidate search | ✅ Done | Opt-in `discoverable` flag + role/location/remote filters |
| 4 | Short 1:1 virtual interview | ⬜ Not started | Blocked: consent-to-interview decision (spec §6) |
| 5 | Batch interview + scoring/comparison | ⬜ Not started | Blocked: fixed vs. adaptive question set (spec §7) |

Legend: ⬜ Not started · 🟨 In progress · ✅ Done · 🔶 Done with follow-ups (see notes)

---

## Phase 1 — Post a job requisition

**Depends on:** nothing. **Decided before starting:** role-assignment model (spec §2.1) —
**invite-only**, per Michael's direction, reusing the existing `invited`/`pending` machinery
rather than self-service-plus-admin-promotion.

**What was built:**
- `users.invited_role` (new column, default `'user'`) — the role a pending `'invited'` row
  becomes once claimed. `AdminService.inviteUser` gained a `targetRole` param
  (`'user' | 'employer'`, defaults `'user'`); `upsertOidcUser` (auth.service.ts) now claims an
  invited row into `existingByEmail.invited_role` instead of a hardcoded `'user'`. Re-inviting an
  already-pending email updates `invited_role` too (fixes a typo'd role without revoke-and-reinvite).
- `UserRole` gained `'employer'` (backend `types/index.ts` and frontend `models/user.model.ts`).
  No new OIDC path — same Google/GitHub login every account uses.
- `requireEmployer` middleware (`backend/src/middleware/auth.ts`), same shape as `requireAdmin`.
- `job_requisitions` table (migration `20260912000002_create_job_requisitions.ts`) — `title`,
  `description`, `requirements` (free text), `status` (`draft|active|closed`, starts `draft`).
  Nothing flips it off `draft` yet — that's Phase 2.
- `RequisitionService` (list/create/get/update, all owner-scoped) +
  `POST/GET /api/requisitions`, `GET/PATCH /api/requisitions/:id` (`requisitions.routes.ts`,
  registered in `app.ts`). `update` 400s (`NOT_DRAFT`) once status leaves `'draft'`.
- Admin invite endpoint (`POST /api/admin/users/invite`) takes an optional `role: 'user'|'employer'`
  field (defaulted server-side in the route handler, not via zod `.default()` — `validate()`
  doesn't write parsed defaults back onto `req.body`, see its own code). Admin Users page's invite
  form gained a role selector; the PATCH-role dropdown and role filter both gained an `employer`
  option too, for direct promotion/demotion via the existing generic role-change path.
- Frontend: `features/employer/` (new) — `EmployerRequisitionsComponent` (list + "new
  requisition" form) and `EmployerRequisitionDetailComponent` (view/edit while draft), both
  plain/utilitarian like the admin screens, not the candidate-facing "notebook" system.
  `employerGuard` (`core/auth/auth.guard.ts`), same shape as `adminGuard`; `authGuard`/
  `guestGuard`/`pendingGuard` all extended to route an employer to `/employer/requisitions`
  instead of `/dashboard`.

**Deviations from the spec doc:** none of substance — `requirements` stayed free text as
specified, no company/org entity was added, requisitions are owner-scoped only.

**Files touched:** see the commit this section landed in.

---

## Phase 2 — Org/situational/cultural Q&A

**Depends on:** Phase 1 (`job_requisitions`). **Decided before starting:** CVF-quadrant
convergence (2026-09-12, spec §4) — shared `CvfQuadrant` enum, separate table
(`requisition_culture_signal`, not the candidate's `culture_signal`).

**What was built:**
- `requisition-qa.ts` (new, `backend/src/models/`) — the step-shaped constants
  (`REQUISITION_QA_STEP_NAME`/`_COMPLETION_CRITERIA`/`_CONVERSATION_STARTERS`,
  `requisitionQaInfoAreas`) fed straight into `runElicitationTurn`, same shape as a candidate
  `FlowStep` but not one — this isn't part of `flowStages`/`flow-steps.ts` (candidate-only).
- Three tables (migrations `20260913000001..003`): `requisition_threads` (one per requisition,
  no channel column — always app), `requisition_messages` (`requisition_id` denormalized
  alongside `thread_id`, mirroring `messages.user_id`/`.step` sitting next to `.thread_id`), and
  `requisition_culture_signal` (`requisition_id`, `cvf_quadrant`, `source_message_ids`).
- `RequisitionConversationService` (`getOrCreateThread`/`getHistory`/`ensureOpeningMessage`/
  `postUserMessage`) — calls `runElicitationTurn` directly, **no**
  `requisition-elicitation.chain.ts` wrapper (see the spec's "AI" section for why: a pure
  pass-through would just be indirection over what `ConversationService` already does inline for
  logistics). `postUserMessage` folds every prior assistant turn's `metadata` together as
  `knownData` (no dedicated structured-data table for this step, unlike `logistics_responses`);
  on `turn.complete` it flips `job_requisitions.status` to `'active'` and kicks off
  `RequisitionCultureSignalService.regenerate` (fire-and-forget, logged on failure, never gates
  completion — same pattern `ConversationService` uses for logistics' own evidence indexing).
- `RequisitionCultureSignalService` + `ai/requisition-culture-signal.chain.ts`
  (`inferRequisitionCultureSignals`) — mirrors `CultureSignalService`/`culture-signal.chain.ts`'s
  shape exactly (wholesale-replace on regenerate, same quadrant enum, same de-dup rules) but its
  own prompt: sources every employer (`role: 'user'`) message in the thread rather than three
  named library questions, and frames the read as *direct* team-culture description rather than
  *indirect* former-employer inference — the distinction the CVF decision turned on.
- Routes on `requisitions.routes.ts`: `GET /:id/qa` (opens/resumes — folds the spec's originally-
  sketched separate `qa/start` into this one call) and `POST /:id/qa/message`, both behind the
  existing `requisitionService.get()` ownership check.
- Transport: built as WebSocket initially (spec's "WebSocket vs. REST" question decided in favor
  of WS, per its own "more consistent" flag at the time). **Superseded days later** by the
  broader POST+SSE migration (2026-09, see CLAUDE.md's "Streaming Chat" section and the spec's
  own updated "WebSocket vs. REST" subsection) — WebSocket was removed from the whole app, not
  just this step, once it became clear nothing in the app actually used a socket's real
  differentiator. `POST /:id/qa/message` now streams over SSE like every other chat surface.
- Frontend: `RequisitionChatPanelComponent` (`features/employer/`) — a smaller, separate component
  rather than a generalization of the candidate's `ChatPanelComponent` (no `FlowProgress`/glyph-
  tracker concept applies here), now on the same `ChatStreamService`-backed POST+SSE transport
  (2026-09) every chat surface in the app uses — see CLAUDE.md's "Streaming Chat (SSE)" section.
  `EmployerRequisitionDetailComponent` embeds it while `status === 'draft'`, and falls back to a
  read-only transcript (`RequisitionService.getQa`,
  REST) once the thread completes.

**Deviations from the spec doc:** the `qa/start` endpoint was folded into `GET .../qa` (see
above); everything else matches the spec's sketch.

**Files touched:** see the commit this section landed in.

---

## Phase 3 — Basic candidate search

**Depends on:** nothing new on the candidate side beyond what's already built. **Decided before
starting:** discoverability (2026-09-13, spec §5) — opt-in `candidate_profiles.discoverable`
flag, default `false`. A candidate is searchable if and only if they've explicitly turned it on;
no other action (a share link, a progression tier, step completion) implies it.

**What was built:**
- `candidate_profiles` gains four columns (migration `20260913000004`): `discoverable` (boolean,
  default false), `search_role`/`search_location` (plain text copies of
  `LogisticsData.targetRolesIndustries`/`.locationPreference`), `search_remote` (`'remote' |
  'hybrid' | 'onsite' | null`). The three `search_*` fields are recomputed on every profile
  (re)generation (`ProfileService.synthesizeProfile`) via `utils/search-normalize.ts`'s
  `parseRemotePreference` — a plain keyword regex over the candidate's own free-text location
  answer, not an LLM call (spec's own "basic search" scoping doesn't need more than that).
  `discoverable` is deliberately excluded from that recompute's `onConflict().merge()` list so a
  candidate's opt-in choice survives a profile refresh instead of resetting to the column default.
- `ShareService.setDiscoverable`/`getDiscoverable` (`share.service.ts`) — turning discoverability
  *on* reuses the exact same Core-persona-or-later tier gate as `createLink` (factored into a
  shared `assertShareEligible`, spec's own reasoning: exposing a profile to search carries the
  same §8 depth requirement as exposing it via a share-link token); turning it *off* is never
  gated. `GET/PATCH /api/share/discoverable` (`share.routes.ts`).
- `CandidateSearchService.search` (`candidate-search.service.ts`) — `discoverable=true AND
  status='approved'` always required, plus optional `role`/`location` (ILIKE substring) and
  `remote` (exact match) filters, limit/offset pagination (same shape as `AdminService.listUsers`).
  Result rows are a narrow public-safe projection (headline, role, location, remote) — nothing
  from `profile_data` beyond the headline, same recruiter-facing guardrail posture as the
  personality spec's §8. `GET /api/employer/search` (`employer-search.routes.ts`, new
  `/api/employer` base path per the spec's own API sketch), behind `requireEmployer`.
- Frontend: Share step (`share.component.ts`) gained a toggle switch next to the share-link
  controls ("Also let employers find you in search"), backed by `ShareService.getDiscoverable`/
  `setDiscoverable`. New `features/employer/candidate-search.component.ts` (`/employer/search`,
  `employerGuard`) — filter form + paginated result table, same plain/utilitarian style as
  `employer-requisitions.component.ts`. `TopbarComponent` gained proper employer nav (a
  "Requisitions"/"Search candidates" branch, plus a corrected brand-link `homeRoute()`) — it was
  previously falling through to the candidate-only "Check-in settings" link and `/dashboard`, a
  pre-existing gap this phase's own new page made worth fixing alongside it.

**Deviations from the spec doc:** none of substance — the API path, filter set, and discoverability
mechanism all match the spec's sketch. The spec left room for a company/requisition-scoped search
narrowing later; not built here (nothing in the spec calls for it yet).

**Verified live** against the running dev stack: `PATCH /discoverable` 400s `PROFILE_NOT_APPROVED`
with no profile and (separately, via direct DB fixture) `TIER_TOO_LOW` below Core persona; a
seeded discoverable+approved profile is found by an unfiltered search, found by a matching
role/remote filter, excluded by a non-matching one, and a non-employer role gets a 403.

**Files touched:** see the commit this section landed in.
