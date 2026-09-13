# Employer-Side Onboarding — Design Spec

*Design spec for the recruiter/job side of the platform, deliberately not implemented yet except
Phase 1 (see "Status" below and "Where this fits" at the end). Nothing on the employer side exists
in this codebase today — every recruiter-facing surface currently in production
(`share.service.ts`'s `publicChat`, `public.routes.ts`) is an **anonymous, tokenized public link**
with no login, no account, and no persistence beyond the token's own expiry. This doc is the
resumption point for building a real, authenticated employer side on top of that.*

**Status:** Design spec for build, phased. Written per Michael's direction: go broad (seeker +
recruiter) before deep (career planning, job stats — see
`docs/labor-market-data-source-catalog.md`, deprioritized), and skip the calibration console for
now (`docs/calibration-console-spec.md`, already spec'd-not-built) in favor of this. **Phase 1 is
built** — see `docs/employer-onboarding-implementation-plan.md` for status/deviations; the
role-assignment question in §2.1 was resolved as invite-only.

---

## 0. Locked decisions

| Question | Decision | Consequence |
|---|---|---|
| Employer account shape | **Individual recruiter accounts**, no company/org entity yet | New `'employer'` role on the existing `users` table, same Google/GitHub OIDC login every candidate already uses — no orgs, no seats, no multi-member company entity. Simplest extension of the existing single-table auth/role model (`UserRole`, `requireAuth`/`requireAdmin` pattern). |
| Job requisition onboarding channel | **Live chat only, no email** | Unlike the candidate flow's Step 3/5 app-or-email choice, a requisition's Q&A phase is always `channel: 'app'`. Reasoning below (§2). |
| Requisition onboarding pace | **5–20 minutes**, one sitting | Contrasts with the candidate flow's deliberately open-ended, multi-week "slow cooker" pacing (personality-engine spec §1: "depth over speed"). A req doesn't need longitudinal depth — it needs a complete, coherent picture of one role, gathered once. |
| Build order | **Five incremental phases**, in the order below | Each phase is independently shippable and reuses more of the existing candidate-side machinery than the last invents. |

---

## 1. The five phases (as scoped)

1. **Post a job requisition** — structured fields (title, description, requirements), mirroring
   the candidate resume step's shape.
2. **Answer organizational/situational/cultural questions** about the position, team, and
   company — a chat-elicitation step, live-chat-only, 5–20 minutes.
3. **Basic search** on common commodity filters (target role, location, remote preference, etc.).
4. **Short virtual interview with one candidate** — an authenticated, persisted version of
   today's anonymous public share-link chat.
5. **Virtual batch interview** with multiple candidates at once, plus scoring/review/comparison of
   their answers.

Each phase's data model is additive to the last; nothing here requires revisiting an earlier
phase's schema once built (see each phase's own "Data model" subsection).

---

## 2. Account model & the live-chat-only decision

### 2.1 Account model

- `UserRole` gains `'employer'` alongside the existing `'user' | 'admin' | 'invited'`. Same OIDC
  login (`registerOidcRoutes`, `upsertOidcUser` in `auth.service.ts`) — an employer signs in
  exactly like a candidate does today. **Open question, not resolved here:** how does a new OIDC
  login *become* `role: 'employer'` instead of the default `'user'`? Candidates self-register into
  `'user'` by default; nothing today lets a login choose a different role for itself (role changes
  are currently admin-only, via `AdminService`/`PATCH /api/admin/users/:id`). Two candidate
  answers, a decision for whoever picks up Phase 1's implementation:
  - **Invite-only**, extending the existing `invited`/`pending`-status machinery
    (`INVITE_ONLY_MODE`, `AdminService.inviteUser`) — an admin invites a specific email as
    `role: 'employer'` rather than `'user'`, reusing 100% of that flow. Stronger signal that this
    is a real employer (someone vetted them before the invite went out), more admin overhead per
    new employer.
  - **Self-service signup, then admin promotion** — a new OIDC login lands as an ordinary
    `role: 'user'` (or a distinct `'employer_pending'` status) and an admin promotes it to
    `role: 'employer'` from the existing Users screen after the fact, the same way any role change
    happens today. Simpler to build (no new invite surface needed), weaker signal of "this person
    is actually a real employer" until an admin has looked.
  - Whichever is chosen, `requireAuth`'s existing `status`-based gates (`suspended`/`pending`)
    apply identically to an employer account — no new auth machinery needed there.
- **A candidate account and an employer account are mutually exclusive roles on the same person's
  email**, per the existing single-`users`-row-per-email model (`upsertOidcUser` keys off email).
  If the same real person needs both a candidate profile and a recruiter account, they need two
  different email addresses under this model. Flagged as a known constraint, not solved here — the
  candidate flow has no employer-facing concept of "my own company's postings" to make dual-role
  meaningful anyway.
- **No company/org entity.** `job_requisitions` (below) belongs to a `user_id`, not an
  organization. Two recruiters at the same real company would, in this model, have two unrelated
  sets of requisitions with no shared visibility. Acceptable for the individual-account decision
  above; revisit if/when a real multi-seat company account becomes a requirement.

### 2.2 Why live-chat-only, unlike the candidate side

The candidate flow's app-or-email choice (Steps 3 and 5) exists because a *candidate's own*
information — goals, stories — benefits from being answerable at whatever pace and however long
the candidate needs, including over days or weeks (the personality engine's explicit "slow cooker"
design principle). A job requisition doesn't have that shape:

- **The information exists already**, in the recruiter's head or an ATS, not something that needs
  drawing out over time the way a candidate's self-understanding does. A recruiter filling out a
  req is transcribing/articulating, not discovering.
- **5–20 minutes is the stated target** — a duration inside which live chat's real-time
  back-and-forth is strictly better than email's async round-trip latency, with no offsetting
  benefit (there's no equivalent to "let this marinate for a few days" for a job requisition).
- **No re-engagement cadence needed.** The candidate side's weekly scheduler
  (`weekly-scheduler.service.ts`) and Step-3 nudge scheduler (`logistics-nudge-scheduler.service.ts`)
  both exist because a candidate might go quiet on an open-ended, multi-week thread. A requisition
  onboarding session either finishes in one sitting or the recruiter abandons it and can resume
  from where they left off next time they log in — no proactive outreach mechanism is needed.

Mechanically, this means Phase 2's elicitation step is built the same way `elicitation.chain.ts` +
`ConversationService` already work for the candidate's Step 3 (logistics) — `runElicitationTurn`
is already channel-agnostic and generic-step-shaped — except the step definition simply never
offers an email choice (no `POST /channel` route analog, no `FlowProgress.*_channel` column for
this step, no `InboxService` analog). This is a **narrower** reuse of the existing engine, not a
new one.

---

## 3. Phase 1 — Post a job requisition

**Mirrors:** the candidate resume step's structured-fields-plus-manual-entry shape
(`resume.service.ts`, `ResumeStructuredData`), not resume *parsing* — there's no file upload here,
requisitions are always manually entered (a recruiter typing a title/description, not uploading a
PDF to extract from). No AI call in this phase at all; it's a plain structured-data form.

### Data model

New table `job_requisitions`:

```
job_requisitions (
  id uuid primary key,
  user_id uuid references users(id) on delete cascade,  -- the employer who owns it
  title text not null,
  description text not null,
  requirements text,                -- free text for v1; structured requirement fields are a
                                     -- later refinement once real usage shows what's needed
  status text not null default 'draft',  -- 'draft' | 'active' | 'closed' — draft until Phase 2's
                                          -- Q&A completes, mirroring resumes.confirmed's gate
                                          -- pattern (a resume isn't "real" until confirmed; a req
                                          -- isn't "real" until its org/situational/cultural
                                          -- context is captured)
  created_at, updated_at
)
```

**Analogous gate to `resumes.confirmed`:** a requisition only becomes `status: 'active'` — visible
anywhere search (Phase 3) or interviews (Phases 4/5) touch — once Phase 2's elicitation completes.
A `draft` requisition is only visible to its own owner.

### API sketch

```
GET    /api/requisitions                 — list this employer's own requisitions
POST   /api/requisitions                 — create a draft { title, description, requirements? }
GET    /api/requisitions/:id             — read one (owner-only)
PATCH  /api/requisitions/:id             — edit title/description/requirements while draft
```

### Frontend

A new top-level employer area, structurally parallel to the candidate `features/onboarding/`
tree but not nested under it — `features/employer/` (new), with its own routing gated by
`role === 'employer'` (a new `employerGuard`, same shape as the existing `adminGuard`). Not a rail
step in the candidate sense (`flowStages`/`flow-steps.ts` are candidate-only) — a requisition list
page with a "New requisition" form, more like the existing `admin-users.component.ts` list-plus-
detail pattern than the candidate's linear step rail.

---

## 4. Phase 2 — Organizational/situational/cultural Q&A

**Mirrors:** the candidate `deep_prompts` step's elicitation shape (open-ended chat, coverage of
several information areas), narrowed per §2.2 above to always-live-chat and a bounded 5–20 minute
session rather than an open-ended, tier-gated, multi-week engine. **Does not** reuse the
personality engine's `topic_thread`/`exchange`/dimension-scoring machinery at all — there's no
per-dimension confidence model, no tiers, no calibration for a job requisition; this is much
closer in shape to the candidate's Step 3 (logistics) elicitation than to Step 5.

### What it's trying to capture (a starting information-area list, not exhaustive)

Modeled on `logisticsInfoAreas`' pattern (`InfoArea[]`, drives both extraction-key guidance and a
frontend glyph tracker) — a first-draft set, to be revised once real usage shows what's actually
useful to ask:

- **Organizational** — team size/structure, reporting line, how this role fits into near-term
  goals.
- **Situational** — a concrete recent challenge or project this role would have touched, what
  "success in the first 90 days" looks like.
- **Cultural** — pace/formality, decision-making style, what kind of person has struggled here
  before (a "what doesn't work" question, mirroring the candidate side's own reluctance to only
  ask positively-framed questions).

**Open question, deliberately not resolved here:** should this reuse the personality engine's
Cultural Value Framework quadrant model (`culture_signal`, `CvfQuadrant` — spec §7) so an
employer's answers and a candidate's Q0/Q15/Q21 answers land on the *same* four-quadrant scale,
making a future "culture fit" comparison meaningful? That's a real, valuable convergence point,
but it's also the kind of cross-side coupling that should be a deliberate decision once Phase 2 is
actually being built, not assumed here.

### Data model

New tables, structurally parallel to `conversation_threads`/`messages` (the candidate Step 3
model) but scoped to a requisition rather than a user+step:

```
requisition_threads (
  id uuid primary key,
  requisition_id uuid references job_requisitions(id) on delete cascade,
  status text not null default 'active',  -- 'active' | 'complete'
  message_count int not null default 0,
  created_at, updated_at
)

requisition_messages (
  id uuid primary key,
  thread_id uuid references requisition_threads(id) on delete cascade,
  role text not null,           -- 'user' | 'assistant'
  content text not null,
  metadata jsonb not null default '{}',
  created_at timestamp not null default now()
)
```

No `channel` column on either table (per §2.2, always `'app'` — no email gateway fields
`conversation_threads` carries for that reason). One thread per requisition, not one per
(user, step) the way `conversation_threads` is keyed — a requisition's Q&A doesn't repeat across
multiple steps the way a candidate's onboarding does.

### AI

New `backend/src/ai/requisition-elicitation.chain.ts` — thin wrapper around the same
`runElicitationTurn` used by `ConversationService` today, or (if a requisition-specific
completion/probing style ends up warranted once this is actually built) a sibling chain following
the same "sibling, not a mode" precedent `topic-elicitation.chain.ts` set for deep_prompts vs.
logistics. A generic step-shaped call (fixed completion criteria, fixed conversation starters, no
tier/topic concept) is the more likely fit given how close this is structurally to the *logistics*
step, not deep_prompts.

### API sketch

```
POST /api/requisitions/:id/qa/start      — opens the thread, returns the opener
POST /api/requisitions/:id/qa/message    — one chat turn
GET  /api/requisitions/:id/qa            — resume: full history + status
```

On `complete`, flips `job_requisitions.status` to `'active'`.

### WebSocket vs. REST

The candidate side uses a WebSocket for its two live-chat steps (`ws://<host>/ws?step=...`).
Given this is also always-live-chat, the same WS pattern is the natural fit
(`websocket/server.ts` branching on a new `requisitionId` query param the way it already branches
on `step`) rather than a polling REST chat loop — a decision for whoever builds this, not resolved
further here, but flagged as the more consistent choice given the precedent.

---

## 5. Phase 3 — Basic candidate search

**The one phase with a real, unresolved product/privacy decision underneath it**, flagged
prominently rather than assumed: **what makes a candidate visible to employer search at all?**

Today, a candidate becomes visible to *any* recruiter only by their own explicit, time-boxed
action — generating a share link (`ShareService.createLink`, gated on `progression.tier` reaching
Core persona) and handing that specific link to a specific person. There is no concept of a
candidate being generally discoverable. Search, by definition, needs some candidates to be
findable *without* a per-recruiter link having been generated and handed over first. Two candidate
resolutions, neither implemented, both requiring a real product decision before Phase 3 starts:

- **Opt-in discoverability flag** — a new `candidate_profiles.discoverable boolean` (default
  `false`) a candidate explicitly sets, e.g. from the Share step's page ("also let employers find
  you in search," alongside the existing "generate a link" action). Search only ever surfaces
  `discoverable = true` profiles. Closest to the existing share-link's own consent-first framing
  (CLAUDE.md: "job seeker only... stays advice" for the labor-market work; the personality spec's
  privacy posture throughout `docs/personality-analysis-engine-spec.md` §8 leans the same way).
- **Search surfaces only candidates with an active share link to *this* employer** — i.e., search
  is really a filtered view over links the candidate already sent this specific recruiter, not a
  general discovery mechanism. Much smaller privacy surface, but arguably isn't really "search" in
  the sense implied by the phase description (finding candidates you don't already have a link
  to).

**Recommendation, not a decision:** the opt-in flag is very likely the right shape given every
other privacy-conscious pattern already established in this codebase (candidate-controlled share
links, no analytics on them "by design, see spec," `docs/personality-analysis-engine-spec.md`
§8's recruiter guardrails) — but it's a real product call, not an engineering one, and should be
confirmed before Phase 3 begins rather than assumed silently.

### Data model (once the discoverability question is resolved)

```
-- on candidate_profiles:
alter table candidate_profiles add column discoverable boolean not null default false;
```

Filterable fields for "commodity filters" (target role, location, remote preference) already
exist on the candidate side — `logistics_responses.data` (`LogisticsData.targetRolesIndustries`,
`.locationPreference`) — no new candidate-side schema needed, just query surface over what's
already captured. Requires those `LogisticsData` fields to be reliably structured enough to filter
on (today they're elicited as free text via the adaptive chat, not fixed dropdowns — worth a
migration to at least a few normalized filter fields, e.g. a parsed `remote: 'remote' | 'hybrid' |
'onsite' | null`, extracted at profile-generation time rather than re-parsed per search query).

### API sketch

```
GET /api/employer/search?role=...&location=...&remote=...   — paginated, discoverable-only
```

---

## 6. Phase 4 — Short 1:1 virtual interview

**The real shift from today's model:** `share.service.ts`'s `publicChat` already does almost
exactly this — same `runSandboxChat`, same `audience: 'recruiter'` guardrails (spec §8) — but
anonymously (no employer login, no persistence: "the transcript lives only in the recruiter's
browser for the duration of their visit," per that file's own comment) and via a candidate-
generated, candidate-controlled token. Phase 4 makes this an **authenticated, persisted** action
an employer takes directly, against a specific requisition and a specific (presumably
Phase-3-discovered) candidate — which changes real things:

- **Transcript persistence becomes necessary**, not optional — Phase 5's "review/comparison of
  answers" can't exist over an ephemeral, browser-only chat. New `interview_sessions` /
  `interview_messages` tables (structurally close to `sandbox_messages`, which already persists
  the *candidate's own* practice-interview transcript — same shape, new owner).
- **Guardrails (spec §8) still apply identically** — `audience: 'recruiter'` on `runSandboxChat`
  is unchanged; an authenticated employer sees exactly the same restricted view an anonymous
  share-link visitor does today (no raw Emotional Stability score, no Q5/Q6/Q19/Q20 verbatim
  spans — see the two guardrail-closing commits earlier in this session for the current state of
  that enforcement).
- **Consent question, same shape as §5's:** does an employer need the candidate's share-link-style
  consent to open an authenticated interview session, or does Phase 3's discoverability opt-in
  already imply consent to being interviewed by anyone who finds them there? Leaning toward "yes,
  discoverability implies interviewable" (that's the whole point of being discoverable) but
  flagged for the same reason §5's question is: worth confirming explicitly, not assuming.

### Data model

```
interview_sessions (
  id uuid primary key,
  requisition_id uuid references job_requisitions(id) on delete cascade,
  candidate_user_id uuid references users(id) on delete cascade,
  employer_user_id uuid references users(id) on delete cascade,
  status text not null default 'active',   -- 'active' | 'complete'
  created_at, updated_at
)

interview_messages (
  id uuid primary key,
  session_id uuid references interview_sessions(id) on delete cascade,
  role text not null,           -- 'employer' | 'assistant' (the assistant answers as the candidate)
  content text not null,
  created_at timestamp not null default now()
)
```

### API sketch

```
POST /api/employer/interviews                 — { requisitionId, candidateUserId } -> opens a session
POST /api/employer/interviews/:id/message     — one turn (non-streaming or streaming — the
                                                 candidate's own sandbox uses streaming for
                                                 perceived-latency reasons per
                                                 sandbox-chat.chain.ts's own comment; an employer
                                                 doing several of these back-to-back may value the
                                                 same)
GET  /api/employer/interviews/:id             — resume/review one session's transcript
GET  /api/employer/interviews?requisitionId=  — list sessions for a requisition (Phase 5's list view)
```

---

## 7. Phase 5 — Batch interview + scoring/review/comparison

Structurally, "run Phase 4 against N candidates for the same requisition, then view them
side by side" — no new interview mechanism, `interview_sessions` already scopes by
`requisition_id` and supports many candidates per requisition. The new surface is entirely the
**review/comparison UI and the scoring model underneath it**:

- **Scoring: employer-authored, not AI-generated.** Given this whole codebase's consistent stance
  against bare AI-generated scores on the candidate side ("insights, never a bare score," spec §8's
  "no marketability score" in the career-planning doc, the calibration console's entire reason for
  existing being to *validate* any score before it's trusted) — the natural, consistent design is
  that **the employer rates candidates' answers themselves** (a simple per-session or per-answer
  rating the employer enters while reviewing), not that the AI scores candidates against each
  other. This mirrors the calibration console's own rating-workbench shape
  (`docs/calibration-console-spec.md` §4) closely enough that it's worth deliberately borrowing
  from, once built: blind-by-default comparison (don't show one candidate's rating while reviewing
  another's answer to the same question), a simple 0–100 or categorical scale, notes.
- **Comparison view**: same question asked across N candidates' sessions, shown side by side —
  needs `interview_messages` taggable by "which question" they're answering (a `question_index` or
  similar on the message, since a batch interview likely reuses the same question set across
  candidates rather than free-forming a different conversation with each).

### Data model addition

```
-- on interview_sessions:
alter table interview_sessions add column employer_rating int;      -- nullable, 0-100 or similar
alter table interview_sessions add column employer_notes text;

-- on interview_messages, if a fixed question set is used per batch:
alter table interview_messages add column question_index int;       -- nullable, groups answers
                                                                      -- across sessions for the
                                                                      -- comparison view
```

**Open question, not resolved here:** does a "batch interview" ask the *same* fixed question set
to every candidate (making comparison trivial — same `question_index` across sessions), or does
each session adapt freely per candidate the way the candidate's own sandbox chat does (richer per-
candidate conversation, harder to compare directly)? This is a real design tension between
"comparable" and "adaptive," worth deciding deliberately when Phase 5 is actually scoped in detail
— Phase 4 doesn't need to resolve it, since a 1:1 interview has no comparison requirement yet.

---

## 8. What Phase 1 needs before it can start (concrete, not deferred)

Unlike Phases 2–5 (each blocked on at least one open product question above), **Phase 1 has none**
— it's pure, low-risk CRUD plus one new role, closely mirroring existing patterns
(`AdminService`'s list/get/update shape, `resume.service.ts`'s manual-entry shape). The one
decision needed before writing code is the role-assignment question in §2.1 (invite-only vs.
self-service-plus-admin-promotion) — small enough to resolve in the same conversation that starts
building it, not a blocker on drafting this spec.

---

## 9. Where this fits

Not tracked in `docs/personality-engine-implementation-plan.md` — that plan is specifically the
personality-engine layer on the *candidate* side and this is a parallel, independent workstream
with no dependency on it (Phase 4/5's `runSandboxChat` reuse touches the same guardrail code the
personality engine's Iteration 8 hardened, but doesn't depend on any *later* personality-engine
iteration). Tracked instead in `docs/employer-onboarding-implementation-plan.md` (started once
Phase 1 implementation began), same separation `docs/calibration-console-spec.md` (spec) vs.
`docs/personality-engine-implementation-plan.md` (tracker) already establishes.

---

*Companion to: `docs/onboarding-ux-flow-spec.md` (the candidate-side flow this deliberately runs
parallel to, not on top of), `docs/personality-analysis-engine-spec.md` §8 (the recruiter-
visibility guardrails Phase 4/5 inherit unchanged), `docs/calibration-console-spec.md` (the rating-
workbench shape Phase 5's scoring UI borrows from).*
