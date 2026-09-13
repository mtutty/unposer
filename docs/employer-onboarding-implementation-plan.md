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
| 2 | Org/situational/cultural Q&A | ⬜ Not started | Unblocked — CVF-quadrant question decided (spec §4) |
| 3 | Basic candidate search | ⬜ Not started | Blocked: discoverability opt-in decision (spec §5) |
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

Not started. **CVF-quadrant convergence decided (2026-09-12, spec §4):** shared `CvfQuadrant`
enum, separate table — `requisition_culture_signal` (not the candidate's `culture_signal`), own
inference chain reusing the existing quadrant-mapping prompt shape from `culture-signal.chain.ts`.

Still open before/while building: whether the elicitation turn itself reuses `runElicitationTurn`
directly or gets its own `requisition-elicitation.chain.ts` sibling (spec leans toward direct
reuse, given the structural closeness to Step 3/logistics rather than Step 5) — a smaller call to
make once the route/service scaffolding is underway, not a hard blocker.
