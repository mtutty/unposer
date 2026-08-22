# Calibration & Review Console — Implementation Spec

*Design spec for `docs/personality-analysis-engine-spec.md` §5.5, written but deliberately **not
implemented** as part of Iteration 4 (see `docs/personality-engine-implementation-plan.md`) —
Michael's explicit direction: "write a spec for calibration/rating subsystem but do not
implement yet." This doc is the resumption point for whichever iteration actually builds it
(currently slotted into Iteration 7, "Calibration run → unlock scores," since that's the first
point the console is actually needed — see "Where this fits in the plan" below).*

**Status:** Design spec for build. Nothing in this document is implemented. The one piece of
prerequisite infrastructure it depends on — role-gated admin access — **is** implemented (see
"What already exists" below).

---

## 1. What already exists

Built as part of Iteration 4, ahead of this console, because Michael asked for a general
user-management admin foundation rather than a console-specific one-off:

- `users.role` (`'user' | 'admin'`, default `'user'`) and `users.status` (`'active' | 'suspended'`,
  default `'active'`) — migration `20260822000001_add_role_status_last_login_to_users.ts`.
- `users.last_login_at`, set from the single `AuthService.createSession` choke point every login
  path (Google, GitHub, dev bypass) shares.
- `requireAdmin` middleware (`backend/src/middleware/auth.ts`), chained after `requireAuth`,
  checking `req.user.role === 'admin'`. `requireAuth` itself now also rejects `status: 'suspended'`
  accounts app-wide (`403 ACCOUNT_SUSPENDED`), not just at admin routes.
- `AdminService` / `backend/src/routes/admin.routes.ts` — list/filter/get/update users
  (`GET /api/admin/users`, `GET /api/admin/users/:id`, `PATCH /api/admin/users/:id`). A user
  cannot modify their own role/status (`400 CANNOT_MODIFY_SELF`) — prevents self-lockout.
- A plain, utilitarian frontend admin screen (`frontend/src/app/features/admin/admin-users.component.ts`,
  route `/admin/users`, gated by `adminGuard`) — list, search, filter by role/status, inline
  role/status edit per row, last-login column.

**This is the access-control substrate the console below builds on** — specifically, the plan is
to add a third role (`'rater'`) rather than invent a parallel auth system, since outside raters
can sign in via the same Google/GitHub OIDC flow every candidate already uses (see §5 below).

---

## 2. What this console still needs to do (§5.5 recap)

Two functions the personality engine spec requires before any real calibration or beta traffic:

1. **Rating workbench** — a rater sees one answer + one dimension's rubric, blind to the model's
   own score until they submit theirs. Produces `calibration_rating` rows.
2. **Variance review queue** — every `monotonic_drift`/`ambiguous` `variance_flag` row (written
   automatically by `ScoringAggregationService`, Iteration 4 — see the plan doc) is browsable,
   filterable, and adjudicable by a human reviewer.

Both tables already exist (`calibration_rating`, `variance_flag` — Iteration 1 migrations) and
are unchanged by this spec; see §3 for the one schema gap this doc identifies.

---

## 3. Data model — gaps found while writing this spec

- **`calibration_rating.rater_id` / `variance_flag.adjudicated_by` are free-form strings**, per
  Iteration 1's decision (no admin/role model existed yet, so they couldn't be FKs). That
  decision's premise no longer holds — §1 above. **Recommendation for whoever builds this:**
  add nullable `rater_user_id` / `adjudicator_user_id` FK columns alongside the existing string
  columns (don't drop the strings — a rater who was paid out-of-band and never got an account,
  or a historical row from before this migration, still needs somewhere to record identity).
  Prefer the FK when it's set; fall back to the string. This is additive, not a breaking change.
- **No `access_log` table exists yet.** §5.5's "every view access-logged" requirement (see §5
  below) needs one:
  ```
  console_access_log (id, user_id FK, action, resource_type, resource_id, viewed_evidence_ids[],
                       created_at)
  ```
  `action` ∈ `rating_workbench_view | rating_submitted | variance_queue_view | variance_adjudicated`.
  `viewed_evidence_ids` matters specifically for the workbench (§8's Q5/Q6/Q19/Q20 sensitivity) —
  logging *which* verbatim answers a rater's screen actually rendered, not just "they opened the
  workbench."

---

## 4. Rating workbench

**Flow:**
1. Admin (or a rater with rater-only access, §5) opens the workbench, optionally filtered to a
   dimension or a specific candidate (calibration runs will usually want "all 11 dimensions for
   this one candidate's transcript," not one dimension across many candidates).
2. Workbench serves one `(exchange, dimension)` pair at a time from a rating queue (§6).
3. Rater enters a 0–100 score and a confidence level (same five values as `ScoreConfidence`:
   `high | medium-high | medium | low | insufficient_signal`) plus optional notes.
4. **Blind by default**: the model's own `dimension_evidence`-derived read for that
   `(exchange, dimension)` pair is hidden until the rater submits. `saw_model_score` on the
   resulting `calibration_rating` row is `false` unless the rater explicitly requests to see it
   first (an exception path, not a toggle they stumble into) — spec §5.5: "ratings taken non-blind
   are excluded from agreement statistics."
5. On submit: insert `calibration_rating`, then reveal the model's read (both scores shown side
   by side, per §5.5).

**Queue assignment:** each rater works through their own queue — never shown another rater's
in-progress or completed items, so two raters rating the same item stay independent (needed for
the human-vs-human ICC in §5.5's agreement dashboard). Simplest correct implementation: a queue is
just "every `(exchange, dimension)` pair belonging to a candidate/date-range the admin assigned to
this rater, that this rater hasn't rated yet" — no separate assignment table needed unless/until
multiple raters need *overlapping* queues assigned explicitly (they will, for the human-vs-human
column — see §6).

**API sketch** (not implemented):
```
GET  /api/admin/calibration/queue?rater=<user_id>&dimension=<key>&candidate=<user_id>
POST /api/admin/calibration/ratings   { exchange_id | evidence_id, dimension, human_score, confidence, notes }
GET  /api/admin/calibration/ratings/:id/reveal   → { model_score, model_confidence, model_reasoning }
```

---

## 5. Access controls

Per spec §5.5, this console is a materially higher-trust surface than the admin user-management
screen in §1 — it exposes verbatim Q5 (Breaking Point) / Q6 (Pattern) / Q19 (Pressure Gauge) / Q20
(Mistake Autopsy) answers, the exact material §8 keeps from ever reaching a recruiter. Three
requirements, building on §1's substrate:

- **Named individual accounts only — extend `users.role` with `'rater'`.** An outside rater (e.g.
  the paid I/O psychologist from the roadmap) signs in through the same Google/GitHub OIDC flow
  every candidate uses; an existing admin flips their `role` to `'rater'` via the §1 screen (or a
  dedicated control, if `'rater'` needs a different edit surface than `'admin'` — a UI decision for
  whoever builds this, not a data-model one). `'rater'` gets workbench + variance-queue access but
  **not** the `/admin/users` screen itself — `requireAdmin` stays `role === 'admin'` exactly;
  add a separate `requireRaterOrAdmin` (or `requireRole(['admin','rater'])`) for the console's own
  routes rather than widening `requireAdmin`'s meaning.
- **Every view access-logged** — `console_access_log` from §3, written on every workbench item
  view and every variance-queue item view, not just on submit/adjudicate actions. This is a write
  on every page load of a sensitive record, not just a mutation — worth confirming it doesn't
  become a performance problem before it ships, but correctness (log every view) comes first.
- **Outside raters see de-identified answers.** A `'rater'`-role user's workbench/queue queries
  must strip `name`, `email`, `avatar_url`, and any other candidate-identifying field from the
  payload — expose only a stable opaque id (or a rotating per-rater pseudonym, if even the raw
  `user_id` shouldn't be consistently re-identifiable across sessions — a call for whoever builds
  this, informed by what the eventual outside rater's contract/NDA actually requires).
  `role === 'admin'` sees full identity; `role === 'rater'` never does. This needs to be enforced
  at the query/serialization layer (a response-shaping function keyed on the requester's role), not
  left to the frontend to hide fields it already received.
- **Privacy policy disclosure — written, not coded, and not part of this spec.** §5.5 is explicit
  that internal/rater review of user answers "must be disclosed" before the console touches real
  user data. This is legal/product copy, out of scope for an engineering spec — flagging it here
  so it isn't forgotten, not attempting to draft it. **Hard blocker on real user data reaching this
  console**, same class of gate as the labor-market-data hard-block already noted in CLAUDE.md's
  Known TODOs.

---

## 6. Agreement dashboard — ICC methodology

Spec §5.5: "model-vs-human ICC, human-vs-human ICC, n, and pass/fail against the ship bar." §9.4
sets the bar: **ICC ≥ 0.75, measured against the human-vs-human ceiling, not against 1.0** — if two
humans only agree at 0.70, the model isn't held to more than 0.70.

**Which ICC form, precisely** (the spec names "ICC" but not which of the six Shrout & Fleiss
forms — this is the one piece of real statistical decision-making this doc makes, so a future
implementer doesn't have to research it from scratch):

- **Human-vs-human column: ICC(2,1)** — two-way random effects, single rater, *absolute
  agreement*. "Random effects" because the specific raters in any given calibration round are a
  sample of possible raters, not the only raters who'll ever do this (matters if the rater pool
  changes between rounds); "absolute agreement," not "consistency," because a rater who is
  reliably 15 points more lenient than another is *not* what "agreement" should mean here — the
  actual score value matters, not just whether both raters move together.
- **Model-vs-human column: ICC(3,1)** — two-way *mixed* effects (the model is a fixed rater, not a
  sample from a population of possible models), single rater, absolute agreement. Same absolute-
  agreement reasoning as above.
- **Computation:** standard one-way/two-way ANOVA mean-square decomposition (`MSR`, `MSE`,
  `MSC` — between-subjects, error, between-raters mean squares). Any correct implementation
  works; don't reach for a stats package dependency for two formulas — this codebase already
  hand-rolls comparable arithmetic in `utils/variance-classification.ts` (Iteration 4's Pearson
  correlation), and ICC(2,1)/ICC(3,1) are a similar order of complexity.
- **"Known hand-checked example" for tests** (the *next* iteration's own "Done when" language,
  carried forward here so it isn't re-derived): the classic textbook example is Shrout & Fleiss
  (1979)'s own worked table — 6 targets × 3 raters, published ICC(2,1) ≈ 0.29 and ICC(3,1) ≈ 0.71
  for their example data. Use that exact table as the unit-test fixture; if the implementation
  doesn't reproduce those two numbers (to ~2 decimal places), the ANOVA decomposition has a bug,
  not a data problem.
- **`n`** is the count of `(exchange, dimension)` pairs with ≥2 independent ratings (human-vs-human)
  or a human rating + a resolvable model read (model-vs-human) — pairs rated by only one rater
  don't contribute to either ICC and should be visibly excluded from `n`, not silently dropped.
- **Pass/fail per dimension:** `model_vs_human_ICC >= human_vs_human_ICC` is the spec's actual bar
  (not a fixed 0.75 — that's a floor on the *human* ceiling being meaningful at all, not a floor on
  the model). A dimension with a low human-vs-human ICC (raters don't agree with each other) can't
  produce a meaningful pass regardless of the model's number — surface this as a distinct "raters
  didn't agree enough to calibrate against" state, not a silent fail.

---

## 7. Variance review queue

- **Source:** every `variance_flag` row with `human_adjudication IS NULL` (unreviewed).
- **Filter/sort:** by `dimension`, `flag_type`, and `magnitude` (descending — review effort goes to
  the cases that would move a score most, spec §5.5).
- **Side-by-side evidence display:** for each flagged row, render the `dimension_evidence` spans
  named in `contributing_evidence_ids`, grouped by `topic_spread`/`occasion_spread` (both already
  stored on the row) so a reviewer can see *which* questions/days produced the conflicting reads
  without re-deriving it.
- **Adjudication:** reviewer picks a label (one of the four `VarianceFlagType` values, or confirms
  the model's own `flag_type` read) → writes `human_adjudication`, `adjudicated_by`,
  `adjudicated_at`. Per spec: "the reviewer label becomes training data for the flag classifier" —
  no classifier retraining is in scope here (`utils/variance-classification.ts`'s thresholds are
  still the documented heuristic default from Iteration 4), just making sure the label gets
  captured correctly for whenever that future work happens.
- Reviewing is optional/async (spec §5.5) — no queue-completion requirement, no SLA.

---

## 8. Where this fits in the plan

`docs/personality-engine-implementation-plan.md`'s Iteration 7 ("Calibration run → unlock scores")
already assumes a working console exists ("the calibration console shows real ICC numbers per
dimension..."). Recommend Iteration 7's scope gain an explicit first bullet — *"build the console
per this spec"* — rather than inventing a new iteration number, since nothing else in the plan
needs the console before Iteration 7 does. Iteration 4's own status stays what it actually
delivered: aggregation/confidence (§4.4/§9.9) live, admin/role foundation live, this console
spec'd-not-built.

---

*Companion to: `docs/personality-analysis-engine-spec.md` §5.5 (source spec section),
`docs/personality-engine-implementation-plan.md` (Iterations 4 and 7).*
