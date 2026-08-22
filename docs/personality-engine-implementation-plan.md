# Personality Engine — Implementation Plan & Status

*Execution tracker for building `docs/personality-analysis-engine-spec.md`, reconciled with the onboarding flow via `docs/personality-engine-flow-addendum.md`. This doc is the resumption point: a fresh session with no prior conversation should be able to read this file plus the two specs it tracks against, and pick up exactly where the last iteration left off.*

**How to resume in a new session:**
1. Read this file's status table below — the first row not marked ✅ Done is the current iteration.
2. Read that iteration's section in full, including "Notes / decisions" — anything logged there overrides the generic plan.
3. Read `docs/personality-analysis-engine-spec.md` and `docs/personality-engine-flow-addendum.md` for the sections that iteration touches (each section below names them).
4. Before writing code, `git log --oneline -20` and check for a branch/WIP matching the iteration name — an iteration may be partially done.
5. When an iteration finishes: flip its status, fill in "Files touched" and "Notes / decisions" with what was *actually* built (not just planned — deviations matter more than the plan did), and commit this file in the same commit as the iteration's work.

**Source docs, in read order:**
- `docs/personality-analysis-engine-spec.md` — the design spec (dimension model, question library, scoring framework, data model, insight layer, guardrails)
- `docs/personality-engine-flow-addendum.md` — reconciles the above with the locked `docs/onboarding-ux-flow-spec.md`
- This file — sequencing, status, per-iteration scope

---

## Status table

| # | Iteration | Status | One-line goal |
|---|---|---|---|
| 0 | Spec + flow addendum | ✅ Done | Design spec consolidated; flow conflict resolved in writing |
| 1 | Data model & scaffolding | ✅ Done | New tables + types, no behavior change |
| 2 | Scoring template, all 11 dimensions (extraction-only) | ✅ Done | Evidence extraction pipeline proven, nothing surfaced |
| 3 | Coverage-driven selection + topic-close | ✅ Done | Step 5 chat gets smarter; still no scores/insights shown |
| 4 | Aggregation/confidence + calibration console | 🔶 Done with follow-ups | Scores computable internally; console spec'd, deferred |
| 5 | Progression tiers + Sketch + insights | ✅ Done | First user-facing payoff; Step 5 completion goes tier-gated |
| 6 | Channel switching (web ⇄ email) | ⬜ Not started | Step 5 opens to email per-topic |
| 7 | Calibration run → unlock scores + culture capture | ⬜ Not started | Numeric scores go live per-dimension; Step 8 tier-gated |
| 8 | RAG convergence + guardrail enforcement | ⬜ Not started | Recruiter chat answers from evidence; §8 filters enforced in code |
| 9 | Weekly scheduler | ⬜ Not started | Proactive cadence, pace/pause/unsubscribe, dormancy |

Legend: ⬜ Not started · 🟨 In progress · ✅ Done · 🔶 Done with follow-ups (see notes)

---

## Iteration 1 — Data model & scaffolding

**Depends on:** nothing.
**Spec sections:** §5 (Data Model), §5.5 (Calibration tables), §9.1 (facet tagging decision).
**User-visible change:** none.

**Scope:**
- New Knex migrations in `backend/src/db/migrations/` (follow existing naming: `<timestamp>_create_<table>.ts`, see `20260820000002_create_profile_evidence.ts` for the pgvector-adjacent pattern):
  - `topic_thread` (question_id, opened_at, closed_at, closed_by, status)
  - `exchange` (thread_id FK, role, text, sent_at, channel, occasion_id)
  - `dimension_evidence` — **not** `profile_evidence`/`conversation_evidence` (those are the existing RAG tables, different purpose — see naming note below). Columns: span, dimension, direction, strength, type, facet, exchange_id FK, note.
  - `dimension_score` (dimension, score, confidence, band, tier, contributing_evidence_ids[], distinct_occasions) — versioned, not mutated in place (§5: "scores are versioned, evidence is immutable").
  - `insight` (type, text, supporting_evidence_ids[], surfaced_to_user, surfaced_to_recruiter)
  - `culture_signal` (cvf_quadrant, source_evidence_ids[])
  - `progression` (tier, dimensions_at_confidence[], pace_preference, next_question_id, last_contact_at) — one row per user, distinct from `flow_progress`.
  - `calibration_rating` (evidence_id | answer_id, rater_id, dimension, human_score, confidence, notes, rated_at, saw_model_score)
  - `variance_flag` (profile_id, dimension, flag_type, magnitude, contributing_evidence_ids[], topic_spread, occasion_spread, model_call, human_adjudication, adjudicated_by, adjudicated_at)
- `occasion_id`: computed as the candidate's local calendar date at `exchange.sent_at`, not a raw timestamp truncation — needs a timezone source (check what's already captured at signup/logistics; if none exists, this iteration also decides and records the fallback, e.g. UTC date, in "Notes / decisions" below).
- TypeScript interfaces in `backend/src/types/` mirroring the above, plus matching interfaces under `frontend/src/app/models/` per the mirroring convention in CLAUDE.md.
- Naming note to preserve: `dimension_evidence` (scoring evidence) is distinct from `profile_evidence`/`conversation_evidence` (RAG/pgvector tables behind `search_candidate_evidence`). They converge in Iteration 8, not before.

**Out of scope:** no chain/service logic yet, no route changes, no UI.

**Done when:** migrations apply and roll back cleanly (`up`/`down` both work); a throwaway seed script can insert a fake `topic_thread` → `exchange` → `dimension_evidence` chain spanning simulated distinct days and read it back with correct `occasion_id`s; `npm test` still green in both `backend` and `frontend`.

**Files touched:**
- `backend/src/db/migrations/20260821000002_create_topic_thread.ts` through `..._000010_create_variance_flag.ts` (9 migrations, one table each, matching the existing one-table-per-file convention)
- `backend/src/types/index.ts` — new personality-engine section (`DimensionKey`, `TopicThread`, `Exchange`, `DimensionEvidence`, `DimensionScore`, `PersonalityInsight`, `CultureSignal`, `Progression`, `CalibrationRating`, `VarianceFlag`, plus their enum-ish string-union types)
- `frontend/src/app/models/personality.model.ts` — new file, mirrors the above minus `CalibrationRating`/`VarianceFlag` (see decisions below)
- `backend/src/utils/occasion.ts` + `occasion.test.ts` — `computeOccasionId`
- `backend/src/scripts/seed-personality-fixture.ts` + `package.json`'s `seed:personality-fixture` script

**Notes / decisions:**
- **occasion_id timezone source:** none exists anywhere in the codebase (checked `users`, `logistics_responses`, everywhere else in `backend/src/types`) — falls back to the UTC calendar date of `sent_at`, computed by `computeOccasionId()` in `utils/occasion.ts`. Documented in that file as a real approximation to revisit (not a placeholder to silently swap) once a real timezone source exists — candidate signup, browser-reported offset, or a logistics-capture question.
- **`question_id` has no FK / no `questions` table.** Confirmed the question library doesn't exist as data yet — `deep_prompts`'s `conversationStarters` in `flow-steps.ts` is still generic, unnumbered copy. `topic_thread.question_id` is a free-form string (`'Q0'`, `'Q23'`, or later an ad hoc reask id per the flow addendum) until Iteration 2/3 gives it something real to reference; still no DB table planned, per the spec, since the library lives in code.
- **`profile_id` (spec's `dimension_score`/`variance_flag`) → `user_id`.** The spec's §5 data-model diagram nests these under a conceptual "profile," but there's no literal row to point at — `candidate_profiles` is a separate narrative-profile table untouched by this work. Used `user_id` directly, noted in each migration's header comment.
- **`rater_id`/`adjudicated_by` are free-form strings, not FKs to `users`.** Outside raters (e.g. a paid I/O psychologist) aren't expected to be OIDC app users, and the real admin/rater-account + access-control model is explicitly Iteration 4's job (§5.5 Access controls). Revisit these columns then — possibly a real FK once that model exists.
- **`calibration_rating`'s `evidence_id | answer_id`** → two nullable FKs (`evidence_id` → `dimension_evidence`, `exchange_id` → `exchange`, standing in for "answer" since there's no separate answer entity). Not enforced at the DB level that exactly one is set — scaffolding only, no service layer exists yet to violate it.
- **Frontend mirroring scoped down deliberately:** `CalibrationRating` and `VarianceFlag` were *not* mirrored into `frontend/src/app/models/personality.model.ts` — there's no admin surface in the frontend at all yet (Iteration 4 builds the calibration console), so there's nothing to mirror them for. Add them there when that iteration starts. Everything else mirrors, with `Date` → `string` and server-internal keys (`user_id`, thread/exchange back-references not needed client-side) dropped, matching the existing `ConversationThread`/`Message` mirroring pattern.
- **Verification:** ran `knex migrate:latest` then `migrate:rollback` then `migrate:latest` again against the live dev Postgres (`docker compose exec api npx knex migrate:...`) — all 9 up and all 9 down clean, no orphaned tables. `npm run seed:personality-fixture -- --user dev@example.com` inserted a `topic_thread` with 3 exchanges across 3 distinct simulated days, 1 `dimension_evidence` row each, read them back joined, confirmed 3 distinct `occasion_id`s, and cleaned up. `backend`: `npm test` (9 suites/38 tests) and `npx tsc --noEmit` both clean. `frontend`: `npm run test:ci` (17/17) clean.
- **Follow-up for Iteration 2:** locating the current Emotional Stability scoring logic (likely in `elicitation.chain.ts` or `profile-generator.chain.ts`) and the exact home of a "question library" beyond `flow-steps.ts`'s `conversationStarters` was explicitly out of scope here — still open, first task of Iteration 2.

---

## Iteration 2 — Scoring template, all 11 dimensions (extraction-only)

**Depends on:** Iteration 1.
**Spec sections:** §4.1–§4.3 (per-answer scoring pass, evidence weighting, prompt template), §3 (three gap-closing questions), §9.1 (facet-level evidence, dimension-level scores — decided).
**User-visible change:** none (question library gains 3 entries but selection logic isn't built yet — see Iteration 3).

**Scope:**
- Generalize the existing Emotional Stability scoring logic (find it — likely inside `elicitation.chain.ts` or `profile-generator.chain.ts`; confirm exact current location before assuming) into a new `backend/src/ai/dimension-scoring.chain.ts`, instantiated per dimension from the §4.3 template (one config object per dimension: name, scale poles, facet list — not eleven near-duplicate files).
- Wire a cheap per-exchange extraction call (§9.2's recommendation: cheap extraction every exchange, expensive full pass later) that writes rows to `dimension_evidence`.
- Add questions 23–25 (The Gut Call, The Thing You'd Catch, The Balance You Got Wrong) to the question library — wherever the current 22 live (check `backend/src/models/` — `flow-steps.ts` holds step definitions, but the question *library* itself, if separate from step conversationStarters, needs locating; this iteration's first task is confirming that location before adding to it).
- Confounds check (STEP 3 of the §4.3 prompt: self-deprecation vs. social lubricant, terseness vs. trait, describing self vs. former employer) must be present in every instantiated prompt, not just the ES reference.

**Out of scope:** aggregation across answers (Iteration 4), coverage-driven selection (Iteration 3), any UI.

**Done when:** running a hand-built transcript (fixture, not live LLM traffic) through all 11 instantiated chains produces evidence objects matching the §4.1 shape for each; a rubric that would obviously fire (e.g. explicit "I love working alone" for Work Style) does fire; unit tests per dimension chain live under `backend/src/ai/` next to the existing `llm.test.ts` pattern.

**Files touched:**
- `backend/src/ai/dimension-scoring.chain.ts` + `dimension-scoring.chain.test.ts` — `DIMENSION_CONFIGS` (one entry per dimension: name, poles, facet list) + `scoreDimension()`, the §4.3 template instantiated once per dimension
- `backend/src/services/dimension-scoring.service.ts` + `.test.ts` — `DimensionScoringService.extractAndPersist()`, the per-exchange extraction call that writes to `dimension_evidence`
- `backend/src/models/question-library.ts` + `question-library.test.ts` — all 26 questions, full verbatim prompt text (via Appendix A, added post-hoc — see notes below) + coverage-matrix loadings from spec §3's table
- `docs/personality-analysis-engine-spec.md` — replaced with the fuller version Michael supplied (adds Appendix A; one sentence changed in §3's intro; nothing else)
- `backend/src/scripts/score-fixture-transcript.ts` + `package.json`'s `score:fixture-transcript` script — live-LLM empirical check, all 11 dimensions

**Notes / decisions:**
- **There was no pre-existing Emotional-Stability-only scoring pass to generalize.** Checked `ai/`, `services/`, and `types/` for "emotional stability" / "stress response" / anything resembling the §4.1 evidence-object shape — the only hit is `profile-generator.chain.ts`'s insight `category` enum, which has a generic `stress_response` bucket among five, not a scoring pipeline. The plan's premise that this iteration "generalizes" existing logic didn't hold; `dimension-scoring.chain.ts` was built fresh from the spec for all 11 dimensions at once, which if anything made this iteration simpler (no ES-specific special-casing to extract).
- **The 22-question library's text was genuinely missing, and has since been supplied and wired in.** At the time this iteration first shipped, `git grep`/`git log -p` across all commits found no verbatim Q0-Q22 text anywhere in this repo, its history, or `docs/` — only the spec doc's §3 coverage-matrix table (dimension loadings, no prose). Flagged as a blocker rather than invented, per spec §1 constraint 2 ("questions must earn the answer"). Michael then supplied a fuller version of the spec doc with an **Appendix A** containing full text for all 26 questions (Q0's seed plus Q1-Q22 plus Q23-Q25), which replaced `docs/personality-analysis-engine-spec.md` in this repo (the only diff from the version this iteration originally worked from: one clarifying sentence in §3's intro, plus Appendix A appended — confirmed with a full-file `diff`, nothing else in §1-§10 changed). `backend/src/models/question-library.ts` now carries real `prompt` text for all 26 questions, transcribed verbatim from Appendix A and spot-checked programmatically against it. **No longer blocks Iteration 3.**
  - Q0 alone has two real phrasings (Appendix A's "Version A, more open — recommended default" and "Version B, more directed — for terse respondents"); the schema grew an optional `altPrompt` field for Version B, with `prompt` holding the recommended default. Nothing reads `altPrompt` yet — respondent-adaptive phrasing selection is beyond this iteration's scope.
  - Also added, since Appendix A supplied it for free: a `theme` field (Appendix A's grouping — "Career Narrative & Achievement" etc. — explicitly called out as useful for pacing per §3 rule 3) and an optional `note` field, currently used only for Q8's callout that Q25 is its intended replacement.
  - **Spec anomaly found while writing `question-library.test.ts`'s data-integrity checks:** Q17 ("The Skill That Won't Stick") has four secondary dimension loadings (emotional_stability, conscientiousness, openness, motivation) and *no primary* in the spec's own §3 table — every other question has exactly one. Not a transcription error (verified against the raw table twice); the coverage-findings prose doesn't mention Q17 either way. Left as-is and asserted explicitly in the test (`gives all but one question at least one primary dimension`) rather than silently "fixed," since it's not this iteration's call whether that's intentional (a pure secondary-signal connector question) or an oversight in the original matrix — worth a decision from whoever owns the question design.
- **Facet lists per dimension are not in the spec either** (§9.1 says to tag facets but never enumerates them for any of the 11 dimensions). `DIMENSION_CONFIGS` in `dimension-scoring.chain.ts` gives each dimension 4-6 facets drawn from the closest established framework (mostly Big Five facet vocabulary), documented in that file as a starting point to revise once real evidence shows which facets actually get used — same spirit as Iteration 1's occasion_id UTC-fallback decision.
- **Schema fix found via the live-LLM script, not the mocked tests:** `provisional_score` as `z.number().int().min(0).max(100).nullable()` 400'd against Anthropic's strict tool-use schema validation ("For 'integer' type, properties maximum, minimum are not supported") — expected, per `llm.ts`'s existing note about `profile-generator.chain.ts`'s array-minItems finding. Less expected: `.int()` alone (no min/max) *also* 400'd the same way — zod's JSON Schema conversion apparently attaches implicit safe-integer bounds to a bare `.int()`. Fixed by using a plain `z.number().nullable()` with `Math.round()` applied in code and the 0-100 integer bound left to live only in the prompt's SCALE line. This is exactly the class of failure the mocked unit tests can't catch (they hand-supply the mock's return value) — worth remembering for any future dimension/schema work: run the fixture script against the real provider before calling a new schema done.
- **`extractAndPersist` takes an explicit `dimensions: DimensionKey[]` argument** rather than looking up the question's P/s loadings itself — deliberately decoupled from `question-library.ts`'s coverage matrix so this iteration doesn't reach into Iteration 3's territory (coverage-driven selection). Nothing calls this service from the live `deep_prompts` flow yet; that flow still runs on the old `conversation_threads`/`messages` model, not `topic_thread`/`exchange` — reconnecting it is explicitly Iteration 3's job per the addendum.
- **Verification:** `npm test` (12 suites / 74 tests, up from 9/38 at Iteration 1) and `npx tsc --noEmit` both clean. `npm run score:fixture-transcript` run against the real configured model (`anthropic/claude-sonnet-5`) — all 11 hand-built fixtures fired evidence in the expected direction with a non-null score, including the plan's own "I love working alone" → low Work Style example verbatim. `question-library.ts`'s question text was spot-checked programmatically (`ts-node -e` printing several questions' `prompt`/`altPrompt`/`note` fields) against Appendix A rather than just eyeballed during transcription.

---

## Iteration 3 — Coverage-driven selection + topic-close criteria

**Depends on:** Iteration 2.
**Spec sections:** §3 (Selection logic, Adaptive follow-up probes, Topic completion).
**User-visible change:** yes — Step 5's chat behavior changes (still no scores/insights rendered).

**Scope:**
- Replace `deep_prompts`'s fixed `conversationStarters`/single `completionCriteria` string (see `backend/src/models/flow-steps.ts`) with the coverage-driven logic: core set first (Q0, 23, 24, 25) → lowest-confidence-dimension selection → heavy/light alternation (Q5/6/19/20 vs. Q18/25/13) → temporal-spread tiebreak.
- Implement the topic-close criteria block from §3 ("CLOSE THIS TOPIC WHEN...") as a prompt fed into the elicitation flow per topic, plus the always-available user-side close ("that's all I've got on that").
- Adaptive follow-up probes: attach the per-question trigger/probe/target table (§3, seed question's rules are the reference pattern) to each question in the library.
- This likely means `elicitation.chain.ts` grows a topic-thread-aware mode, or a new sibling chain wraps it — decide and record which during the work.

**Out of scope:** anything tier/score/insight-visible; email channel (still chat-only per the *current* locked spec — email opens in Iteration 6 per the addendum).

**Done when:** a live session in Step 5 asks Q0/23/24/25 first, picks the next question by lowest-confidence dimension thereafter, never queues two heavy questions back to back, and closes a topic per the criteria (verified with a scripted conversation, not just unit tests on the selection function in isolation).

**Files touched:**
- `backend/src/ai/topic-elicitation.chain.ts` + `.test.ts` — the topic-thread-aware sibling to `elicitation.chain.ts` (decision below on why sibling, not a mode); embeds spec §3's verbatim "CLOSE THIS TOPIC WHEN" block, channel-dependent probe-depth guidance, and Q0's probe-rule table when present.
- `backend/src/services/topic-selection.service.ts` + `.test.ts` — `TopicSelectionService.selectNextQuestion()`: core-set-first, then lowest-coverage-dimension selection, heavy/light alternation, temporal-spread tiebreak (spec §3 points 1-4).
- `backend/src/services/topic-conversation.service.ts` + `.test.ts` — `TopicConversationService`, the deep_prompts-only sibling to `ConversationService`: owns the `topic_thread`/`exchange` lifecycle, calls the selection service and the new chain, fires `DimensionScoringService.extractAndPersist` per exchange (Iteration 2's service, now actually wired to live traffic) and `EvidenceService.indexDeepPromptSubstrate`.
- `backend/src/models/question-library.ts` — added `ProbeRule`/`probeRules` (Q0 only — see decision below); `backend/src/models/question-library.test.ts` — added a data-integrity check for it.
- `backend/src/ai/elicitation.chain.ts` — exported `SHARED_PRINCIPLES` so the new chain can reuse the never-self-score framing instead of duplicating it.
- `backend/src/websocket/server.ts` — branches `deep_prompts` to `TopicConversationService`, leaves `logistics` on `ConversationService` unchanged.
- `backend/src/models/flow-steps.ts` — `deep_prompts`'s `completionCriteria` string marked superseded (kept only because `FlowStep` requires the field; no longer sent to any chain for this step).
- `backend/src/services/flow.service.ts` — `resetProgress` now also deletes `topic_thread` rows (cascades `exchange`/`dimension_evidence`), so a dev reset doesn't orphan personality-engine data.
- `backend/src/scripts/simulate-deep-prompts-session.ts` + `package.json`'s `simulate:deep-prompts-session` script — the live scripted-conversation verification the "Done when" line calls for, real DB + real LLM, ten topics deep.

**Notes / decisions:**
- **Sibling chain, not a mode on `elicitation.chain.ts`** (the plan's own open question). `elicitation.chain.ts` is step-shaped (one fixed `completionCriteria` string, one step name) and still drives `logistics` unchanged; `topic-elicitation.chain.ts` is topic-shaped (one question object, its own close criteria, optional probe rules) and drives `deep_prompts` exclusively. Folding topic-thread concepts into the simpler step-shaped chain would have complicated the one caller (`ConversationService`) that doesn't need any of them. The two chains share `SHARED_PRINCIPLES` (now exported) so the "never ask the candidate to rate themselves" framing can't drift between them.
- **Only Q0 got a real `probeRules` table.** The spec's §3 adaptive-probes section gives Q0's table as "the pattern to replicate," not a table for all 26 questions — inventing trigger/probe/target content for the other 25 unattested by the spec would be the same category of overreach Iteration 2 avoided with facet lists (documented there as "a starting point to revise," not invented final content). The other 25 rely on `topic-elicitation.chain.ts`'s generic close-criteria fallback ("ask one follow-up that goes after what is missing"), which is itself spec text, not an invention. Extending real per-question probe tables to more questions is editorial work for whoever owns the question library, not an engineering gap in this iteration.
- **Coverage-driven selection uses evidence *count* as a confidence stand-in, not real confidence.** The spec's own selection logic (§3 point 2) says "pick the next question whose primary dimensions have the lowest confidence" — but confidence (§4.4: evidence count + source/temporal diversity + consistency) is explicitly Iteration 4's aggregation layer, which doesn't exist yet. `TopicSelectionService` computes a simpler per-dimension `evidenceCount` from `dimension_evidence` joined through `exchange`/`topic_thread`, documented in the file as a placeholder proxy to swap for a real confidence lookup once Iteration 4 lands — callers don't need to change when it does. Distinct-question and distinct-occasion counts are collected in the same pass (for future use / easy inspection) but don't drive selection yet.
- **Temporal-spread tiebreak** (§3 point 4) is implemented as: for each candidate question, take the *oldest* `lastEvidenceAt` across all of its loaded dimensions (never-sampled sorts first via `-Infinity`), then stable-sort candidates by that. Remaining ties fall back to question-library order, which keeps selection fully deterministic — confirmed by the live simulation script producing the identical question order on a repeat run with identical canned answers.
- **"Follow the energy" (§3 point 5) lives in the chain's prompt, not the selection service.** The spec's own topic-close criteria block already encodes it ("a long, specific answer earns a follow-up... a second flat answer is worse signal than a first answer on a new one" reads as the close-vs-continue judgment call); `TopicSelectionService` is only ever consulted once a topic is already closed, so it has no "energy" signal to weigh.
- **User-initiated close is folded into the model's own close-criteria bullet list**, not parsed as separate intent-detection code. The spec lists it as always-available and separately honored; giving the model one more bullet ("the person explicitly says they're done... always honor this immediately, set closedBy to 'user'") is simpler than a second code path and worked correctly in the live simulation (`closed_by: 'user'` recorded exactly when the scripted "That's all I've got on that" line was sent, and in several topics the model closed on its own initiative even before that line was needed).
- **Opening message is inserted verbatim from the library, not generated.** The library's `prompt` text is already the crafted wording (spec Appendix A); running it through an LLM call to "phrase the opening" would add cost and drift for no benefit. `topic-elicitation.chain.ts` is therefore only ever called with `history.length >= 1` (at least the opener plus one user reply) — documented on `TopicTurnParams.history`.
- **`flow_progress`'s deep_prompts completion is a placeholder, not the real tier gate.** The flow addendum (§2) wants `progression.tier == Sketch`; that table has no computable tier logic until Iteration 5 (which the plan explicitly calls "the one place flow-model code changes"). `TopicConversationService.isFlowStepComplete()` stands in with "the four core-set questions are closed," landing on roughly the same timescale the old fixed-story-count criterion did, and is written so Iteration 5 only needs to swap this one method's body — `websocket/server.ts`'s call site is untouched by that future change.
- **At most one topic open per candidate at a time.** Nothing in this iteration lets a candidate branch into a second topic before closing the first (`getActiveThread` picks the single most-recently-opened `status = 'open'` row). The spec doesn't ask for concurrent topics anywhere in scope through Iteration 6, so this wasn't relaxed pre-emptively.
- **Verification:** `npm test` (15 suites / 90 tests, up from 12/74 at Iteration 2) and `npx tsc --noEmit` clean in `backend`; `npm run test:ci` (17/17) unchanged in `frontend` (no frontend files touched — the WS wire contract, `Message`-shaped payloads over the same three events, is unchanged, so `chat-panel.component.ts` needed no changes). `npm run simulate:deep-prompts-session` run twice against the real dev DB and real configured model (`anthropic/claude-sonnet-5`) with `--user dev@example.com`: both runs asked Q0 → Q23 → Q24 → Q25 first in order, never queued two heavy questions back to back (one heavy question, Q6, appeared once at position 7, flanked by light ones), every one of 10 topics closed (all via the explicit user-close line in this run, since the canned answer was deliberately generic enough that the model usually asked a redirecting follow-up first — see the transcript), and both runs produced the identical question order given identical canned answers, confirming the tie-break logic is deterministic. A direct SQL check after the second run confirmed real `dimension_evidence` rows were written per exchange with correct `question_id`/`dimension` attribution (68 rows across 10 topics). Test data cleaned up after each run.
- **Pre-existing, unrelated gap surfaced during verification:** this dev environment has no `EMBEDDINGS_API_KEY` configured, so every turn's `EvidenceService.indexDeepPromptSubstrate` call logged a caught-and-warned failure ("No embeddings API key is configured"). This is the same fire-and-forget indexing pattern `conversation.service.ts` already uses and was already true before this iteration (the `.env` gap predates it) — noted here only because the live simulation is what surfaced it, not a new issue this iteration introduced.

---

## Iteration 4 — Aggregation/confidence + calibration console

**Depends on:** Iterations 2–3 (needs real evidence accumulating and thread-close events to trigger full re-scoring on).
**Spec sections:** §4.4 (Aggregation across answers), §5.5 (Calibration & Review Console) in full, §9.9 (variance default behavior).
**User-visible change:** none for candidates; new admin-only surface.

**Scope:**
- Aggregation formula (§4.4): anchored-at-50 weighted mean, confidence from evidence count / source diversity / temporal diversity (distinct `occasion_id`s) / consistency.
- Variance classification into the three patterns (topic-linked, occasion-linked, monotonic-drift) with the §9.9 default: ambiguous → suppress the context-dependence insight, lower confidence, always write a `variance_flag` row regardless of whether anyone reviews it.
- Full re-score trigger points: topic-thread close, tier transition (tier engine doesn't exist until Iteration 5 — for now, trigger on thread-close only, and note the tier-transition trigger as a follow-up for Iteration 5 to wire in).
- Calibration console (§5.5), admin-only, behind whatever auth-role gating the app already has (check `auth.service.ts` / existing role model before assuming a new one is needed):
  - Rating workbench: single answer + one dimension's rubric, blind by default (`saw_model_score` recorded on any exception), agreement dashboard (model-vs-human ICC, human-vs-human ICC, n, pass/fail).
  - Variance review queue: filterable/sortable, shows conflicting evidence spans side by side, reviewer label becomes training data.
  - Access controls: named accounts only, every view access-logged, outside raters see de-identified answers, privacy policy disclosure written (not just coded) before any real user data goes through it.

**Out of scope:** actually running calibration at volume (Iteration 7) — this iteration builds the tool, not the dataset.

**Done when:** a synthetic answer set can be rated blind by two fake raters, the agreement dashboard computes ICC correctly against a known hand-checked example, and a deliberately ambiguous variance case produces a `variance_flag` row without any human action.

**Scope actually delivered (redirected mid-iteration — see decisions below):** aggregation/confidence/variance classification (§4.4/§9.9) in full, plus a general admin/user-management foundation (role, status, access gating) that the console will build on. The console itself (rating workbench + agreement dashboard) is **not built** — spec'd instead, at Michael's explicit direction, in `docs/calibration-console-spec.md`. The "Done when" line above is therefore only partially met: the variance_flag half is verified live (see Verification); the ICC/blind-rating half has no implementation to verify yet.

**Files touched:**
- `backend/src/utils/variance-classification.ts` + `.test.ts` — `classifyVariance()`: the three named patterns (§4.4) plus §9.9's `ambiguous` catch-all, from hand-computed/verified population-std and Pearson-correlation thresholds.
- `backend/src/services/scoring-aggregation.service.ts` + `.test.ts` — `ScoringAggregationService`: the §4.4 weighted-mean aggregation (anchored at 50, type_weight × strength_weight), §9.3's minimum-evidence gate, confidence→band mapping, §9.9's ambiguous-demotes-confidence rule, and drift's recency-weighted re-aggregation.
- `backend/src/services/topic-conversation.service.ts` — wires the re-score trigger on topic-thread close (§9.2): awaits the just-closed topic's own extraction before recomputing (previously fire-and-forget), then awaits `recomputeDimensions` for every dimension the closed question loaded on.
- `backend/src/db/connection.ts` — **bug fix, not scope creep**: registers a raw-string type parser for Postgres `DATE` columns (see decisions below) — found while live-verifying this iteration's own aggregation output.
- `backend/package.json` / `backend/src/services/topic-conversation.service.test.ts` — `@types/pg` devDependency (needed to type the fix above); test updates for the new awaited-recompute call.
- `backend/src/db/migrations/20260822000001_add_role_status_last_login_to_users.ts` — `users.role` / `users.status` / `users.last_login_at`.
- `backend/src/types/index.ts` — `UserRole`, `UserStatus`, `User` gains `role`/`status`/`last_login_at`.
- `backend/src/middleware/auth.ts` — `requireAuth` now rejects `status: 'suspended'` app-wide; new `requireAdmin`.
- `backend/src/services/admin.service.ts` + `.test.ts`, `backend/src/routes/admin.routes.ts`, registered in `app.ts` — list/filter/get/update users, self-modification guard.
- `backend/src/services/auth.service.ts` — `createSession` now stamps `last_login_at`.
- `frontend/src/app/models/user.model.ts` — `UserRole`/`UserStatus`, `User` gains the same three fields.
- `frontend/src/app/core/api/api.service.ts` — added `.patch()` (didn't exist before).
- `frontend/src/app/core/admin/admin.service.ts`, `frontend/src/app/core/auth/auth.guard.ts` (new `adminGuard`), `frontend/src/app/features/admin/admin-users.component.ts`, `frontend/src/app/app.routes.ts`, `frontend/src/app/shared/components/topbar/topbar.component.ts` (admin link, role-gated) — the user list/filter/edit screen itself.
- `docs/calibration-console-spec.md` — new. The deferred console's full design: rating workbench, ICC methodology (ICC(2,1) human-vs-human, ICC(3,1) model-vs-human, both absolute-agreement — with the Shrout & Fleiss 1979 worked example named as the future test fixture), variance review queue, access controls (a `'rater'` role extending this iteration's `role` column, a not-yet-built `console_access_log` table, de-identification for outside raters), and the privacy-disclosure hard-block. Recommends folding the console's actual build into Iteration 7's scope rather than inventing a new iteration number.

**Notes / decisions:**
- **Scope redirect, recorded as it happened:** the plan's own "Depends on... check `auth.service.ts` / existing role model before assuming a new one is needed" turned up nothing — no role/admin concept existed anywhere in the codebase. That's exactly the kind of decision the plan's resumption instructions call for surfacing rather than inventing unilaterally (per CLAUDE.md and this session's own operating instructions), so it was asked about before building the console. Michael's answers: (1) admin auth = a `role` column on `users`, gated through the existing OIDC login, plus a general user list/filter/edit admin screen (change status, set/clear role, view profile + last login) — broader than just calibration-console access; (2) the console itself: "write a spec... but do not implement yet." Both are reflected above.
- **`STRENGTH_WEIGHT` values are a documented gap-fill, same as Iteration 2's facet lists.** Spec §4.4's formula (`evidence_score × type_weight × strength_weight`) names a `strength_weight` factor but §4.2's table only defines `type_weight`; §4.1 only defines the strong/moderate/weak *categories*, not their numeric weights. Filled as strong=1.0/moderate=0.6/weak=0.3 in `scoring-aggregation.service.ts`, documented as revisitable once Iteration 7's calibration shows whether the graduation tracks real evidence quality. Same file also had to decide what "one moderate piece of evidence" (the §4.4 anchor prior) means precisely — read as one type-agnostic moderate-strength item (weight = `STRENGTH_WEIGHT.moderate` alone, no `type_weight` applied, since the prior isn't real evidence with a type).
- **Confidence-level thresholds (`richnessLevel`) are a placeholder blend, not calibrated.** Combines evidence count / distinct questions / distinct occasions into a 0–1 richness score against fixed cutoffs (0.85/0.65/0.45) for high/medium-high/medium/low. Spec §4.4 names these four inputs but gives no formula for combining three of them (the fourth, consistency, is handled separately via variance classification) — flagged in the file itself as pending Iteration 7 calibration, exactly like the strength weights above.
- **Variance classification priority order (drift → topic_linked → occasion_linked → ambiguous) was chosen deliberately, not arbitrarily** — see the file's own comment and the plan's earlier note that a first-draft "topic_linked-first" ordering produced false positives whenever two topics happened to be asked in different weeks (a real chronological trend is structurally indistinguishable from a topic effect if topic-grouping is checked before time-trend). All four branches were hand-verified with worked examples in `variance-classification.test.ts` before this ordering was locked in.
- **Only `monotonic_drift` and `ambiguous` write a `variance_flag` row** — `topic_linked` (§4.4: "keep confidence; emit a context-dependence insight") and `occasion_linked` (§4.4: "average it out") have their own defined resolutions in the aggregation formula itself and aren't flagged. This is a specific reading of §4.4's table plus §9.9's "ambiguous... logged... unconditionally" language, since the spec doesn't say in one place which of the four outcomes are "flag" outcomes — recorded here as the interpretation, not just implemented silently.
- **Real bug found via live verification, not the mocked unit tests** (same class of gap Iteration 2's notes warned about): Postgres `DATE` columns (`exchange.occasion_id`) come back from `pg` as JS `Date` objects, not strings, unless a type parser is registered. Every `TopicSelectionService`/`ScoringAggregationService` piece of code doing `new Set(rows.map(r => r.occasion_id))` to count "distinct occasions" was silently broken since Iteration 3 — two different Date object instances for the *same calendar day* are never `===` equal, so the Set never deduped, and `distinct_occasions`/temporal-diversity confidence was counting rows, not days. Caught because a same-day live simulation run showed `dimension_score.distinct_occasions` climbing to 5 when it should have stayed at 1. Fixed at the source (`db/connection.ts`, one `types.setTypeParser(1082, ...)` call) rather than patching every call site, since every consumer's assumption (a plain `'YYYY-MM-DD'` string) was already correct — the driver was the thing lying. Iteration 3's `topic-selection.service.test.ts` mocks didn't catch this because they hand-supply plain-string `occasion_id` fixtures, which is exactly what the fixed driver now actually returns — the tests were unknowingly asserting the *post-fix* behavior all along.
- **`console_access_log` (from `docs/calibration-console-spec.md`) is not built** — no code in this iteration writes to a table by that name; it's a recommendation for whoever builds the console next.

**Verification:** `npm test` (18 suites / 110 tests, up from 17/103 at Iteration 3) and `npx tsc --noEmit` clean in `backend`; `npm run build` and `npm run test:ci` (17/17) clean in `frontend`. The new migration (`20260822000001...`) rolled back and reapplied cleanly against the live dev Postgres. Live smoke test against the dev container (real login, real cookies): `GET /api/admin/users` returns the promoted admin's own row; `PATCH /api/admin/users/:id` on one's own id correctly 400s with `CANNOT_MODIFY_SELF`; a demoted non-admin correctly 403s on `GET /api/admin/users`; `last_login_at` updates on login. `npm run simulate:deep-prompts-session` run twice (before and after the `db/connection.ts` fix) against the real dev DB and real LLM — the *first* run (pre-fix, same code as Iteration 3's script but now also triggering aggregation on close) is what surfaced the occasion_id bug: several dimensions reached `medium`/`medium-high`/`high` confidence within one same-day session, which shouldn't be possible (§9.3 requires ≥2 distinct occasions). The *second* run (post-fix, same script, fresh topics) confirmed the fix directly: `detail_orientation` accumulated 15 real `dimension_evidence` rows across the session, a direct SQL count confirmed genuinely 1 distinct `occasion_id` among them, and the latest `dimension_score` row for that dimension correctly reported `distinct_occasions: 1` and stayed `insufficient_signal` — every dimension in the post-fix run did, which is the *correct* outcome for a same-day session, not a bug (this is exactly the "Core persona is meaningfully harder to reach in one sitting than over two weeks" property the spec's occasion requirement exists to enforce). 14 `variance_flag` rows were written across the two runs, all `ambiguous` (plausible given the test script sends the same generic canned answer to every question regardless of topic, which really is ambiguous mixed signal, not a genuine topic or occasion pattern). All test data cleaned up after verification.

---

## Iteration 5 — Progression tiers + Sketch + insight generator

**Depends on:** Iteration 4.
**Spec sections:** §3.5 (Progression, Pacing & Completeness) in full, §6 (Insight Layer) in full.
**Flow addendum sections:** §2 (Step 5 completion → Sketch tier), §5 (rail/stage impact: none), §6 (profile across tiers).
**User-visible change:** yes — first real payoff. Step 5 in the onboarding rail now completes on `progression.tier == Sketch`, not a fixed count.

**Scope:**
- Tier engine: Sketch / Core persona / In depth / Ongoing, computed from `dimension_score` + `progression` rows per the §3.5 table.
- Wire `flow_progress.steps_state['deep_prompts']` to flip complete on first reaching Sketch (addendum §2) — this is the one place flow-model code changes in this iteration; confirm the exact current gating mechanism in `flow.service.ts` before modifying it.
- Insight generator: all 6 types (Distinctiveness, Tension, Pattern, Context-dependence, Environment implication, Their own words), medium-confidence floor, 5–7 cap, falsifiability filter, never-pathologize rule for Emotional Stability specifically. Seed the Distinctiveness baseline from published Big Five norms, marked provisional per spec.
- Tension table: start with the 4 candidate pairs listed in §6.
- Profile generation changes per addendum §6: first generation at Sketch is narrative-only (no numeric score/band rendered), regardless of calibration status — calibration gating for *scores* is Iteration 7, this iteration just makes sure Sketch-tier profiles never render a number.
- Persistent post-Sketch affordance on the profile/sandbox page ("answer one more question") — addendum §5, no new rail entry, same CTA pattern as existing Sandbox/Share.

**Out of scope:** numeric scores rendering anywhere (still calibration-gated, Iteration 7); email channel (Iteration 6); scheduler (Iteration 9).

**Done when:** a candidate who answers the core set in one sitting sees Step 5 complete in the rail, lands on a profile_review page showing narrative insights (2–7 of them, evidence-cited, no numbers), and continuing to answer questions past that point visibly updates tier without re-blocking the rail.

**Files touched:**
- `backend/src/models/dimensions.ts` — new. `ALL_DIMENSIONS`/`CONFIDENCE_RANK`/`MEDIUM_CONFIDENCE_RANK` pulled out once a third file needed them (previously duplicated in `topic-selection.service.ts` and about to be duplicated again) — `topic-selection.service.ts` and the new files below all import from here now.
- `backend/src/services/progression.service.ts` + `.test.ts` — the tier engine (§3.5 table): `recomputeTier()`, `getTier()`, `getTemporalDepthSummary()`.
- `backend/src/ai/insight-generator.chain.ts` + `.test.ts`, `backend/src/services/insight.service.ts` + `.test.ts` — the §6 insight generator: all 6 types in one LLM call per regenerate, medium-confidence floor and evidence selection owned by the service, id/dimension/evidence-id hallucination filtering and the 5-7 cap owned by the chain.
- `backend/src/ai/profile-generator.chain.ts` — gained an optional `personalityInsights` context input (informational only — see decisions).
- `backend/src/services/profile.service.ts` — rewritten: transcript source and completion gate both fixed (see decisions), personality insights woven in by code-level append (not LLM reproduction), `flagInsight`'s re-ask now opens a real ad hoc topic thread with derived target dimensions. New `.test.ts` (none existed before).
- `backend/src/services/topic-conversation.service.ts` — `getFullTranscript()`, `openAdHocTopic()`, `resolveQuestion()` (ad hoc question resolution), wired `ProgressionService.recomputeTier` after aggregation, `isFlowStepComplete` now a real `progression.tier` lookup (placeholder removed).
- `backend/src/db/migrations/20260822000002_add_distinct_questions_variance_pattern_to_dimension_score.ts`, `..._000003_add_ad_hoc_dimensions_to_topic_thread.ts`, `..._000004_widen_dimension_evidence_facet.ts` — schema gap-fills found while building the tier engine and live-verifying it (see decisions).
- `backend/src/types/index.ts` — `DimensionScore` gains `distinct_questions`/`variance_pattern`; `TopicThread` gains `ad_hoc_dimensions`; `ProfileInsight.category` folds in `InsightType`.
- `backend/src/routes/profile.routes.ts` — new `GET /progression` (tier + temporal-depth summary).
- `backend/src/services/flow.service.ts` — `resetProgress` now also clears `dimension_score`/`variance_flag`/`progression`/`insight` (same orphaning class Iteration 3 fixed for `topic_thread`).
- `backend/src/services/sandbox.service.ts` — unrelated-feature bug fix bundled in (see decisions): `saveCitations` now `JSON.stringify`s its jsonb array write.
- `frontend/src/app/models/personality.model.ts` — `DimensionScore` mirror updated to match; new `ProgressionSummary`.
- `frontend/src/app/core/profile/profile.service.ts` — new `progression` signal + `loadProgression()`.
- `frontend/src/app/core/api/api.service.ts` — n/a this iteration (already had what was needed).
- `frontend/src/app/features/onboarding/profile/profile-review.component.ts`, `.../sandbox/sandbox.component.ts` — the persistent post-Sketch "answer one more question" CTA + "based on one session so far" caveat (addendum §5), both reading off `progression`.
- `backend/src/models/flow-steps.ts` — `deep_prompts`'s `completionCriteria` comment updated to describe the real tier-based gate instead of Iteration 3's placeholder.

**Notes / decisions:**
- **The Sketch-gate conflict (found before writing any tier code) — asked, resolved, implemented.** Iteration 4's occasion-diversity floor gate (§9.3's "≥2 distinct occasions" suggestion) made *any* score — hence Sketch, which only needs one dimension at medium confidence — structurally unreachable in a single sitting, directly contradicting the flow addendum's "typically reachable in one sitting" claim for Step 5 and this iteration's own "Done when" line. Verified live in Iteration 4 (a full same-day session left every dimension `insufficient_signal`). Asked Michael rather than picking a resolution unilaterally; his direction: fast single-session users should get a real result with a visible "limited depth" indicator, never a hard block — the longitudinal signal is the product's edge, not a gate. Implemented as: **`scoring-aggregation.service.ts`'s minimum-evidence floor gate drops the distinct-occasions requirement entirely** (kept only as a code comment recording what changed and why); **occasion diversity stays as an input to the confidence *level* itself** (already 33% of `richnessLevel`'s weighting, unchanged) — a same-day dimension can now reach `medium` (and thus Sketch) with enough question breadth, but is realistically capped well short of `high` since the occasion term alone can't exceed ~0.08 of the 0.33 available when `distinct_occasions` stays at 1; **In depth keeps its own explicit "≥2 questions on ≥2 distinct occasions" bar** (`progression.service.ts`) since that's *that tier's own definition*, not the generic floor gate, so the deeper tiers still require real multi-day usage. `getTemporalDepthSummary()` exposes which medium+ dimensions are still single-occasion, surfaced via `GET /api/profile/progression` and rendered as the "based on one session so far" caveat.
- **`ProgressionService.recomputeTier` stamps its computed tier onto each dimension's *current* `dimension_score` row in place** (an `UPDATE`, not a new version) rather than trying to compute tier synchronously inside `ScoringAggregationService.persist()` — the spec's own §5 data model lists `tier` as a `dimension_score` field, but tier is a whole-profile derivation that needs *all 11* dimensions' latest state, which doesn't exist yet mid-aggregation-loop. `progression.tier` (not this column) is the actual source of truth; the per-row copy is a snapshot annotation for anyone querying `dimension_score` directly.
- **`ProfileService.synthesizeProfile`'s two real bugs, found by actually calling it live** (both **predate this iteration** — the old message-count gate and the old `ConversationService.getHistory` call had been dead code paths since Iteration 3 moved `deep_prompts` onto `topic_thread`/`exchange`, and nothing had exercised profile generation against that new model until now):
  1. **Transcript source was always empty.** `this.conversation.getHistory(userId, 'deep_prompts')` read the `messages` table, which `deep_prompts` stopped writing to entirely in Iteration 3. Fixed by adding `TopicConversationService.getFullTranscript()` (every exchange across every topic thread, oldest first) and switching to it.
  2. **The completion gate counted rows in that same dead table**, so it could never pass either. Replaced with `progression.getTier(userId) !== 'none'` — the real signal, and the one the addendum actually specifies.
  Both would have silently made `POST /api/profile/generate` permanently 400 for every candidate touching the new deep_prompts flow, for every iteration since 3, until this one. Live-verified fixed: a real `generateProfile` call against real simulated session data returned 200 with a real narrative profile.
- **Personality insights are appended to `profile_data.insights` in code, not reproduced by the LLM.** Original plan draft had `profile-generator.chain.ts` asked to emit them itself "verbatim" via structured output; changed before implementing because that leaves no way to guarantee the model doesn't paraphrase/drop/mangle "verbatim" text, and — more importantly — breaks traceability: `flagInsight` needs to map a flagged insight back to the dimension(s) it came from, which only works if the `ProfileInsight.id` on the profile *is* the real `insight.id`, not an LLM-generated slug. `profile-generator.chain.ts`'s own LLM call now only sees the personality insights' `{type, text}` as **context to avoid restating**, and `ProfileService.toProfileInsights()` appends the real rows afterward with their real ids and a real quoted evidence span (looked up from `dimension_evidence` via the insight's first `supporting_evidence_id`). Live-verified: a flagged personality-engine insight correctly round-tripped to its real dimension (`social_energy`) via `reaskDimensionsFor()`'s `insight` table lookup, guarded by a UUID-format check so a pre-Iteration-5 (LLM-slug) insight id never gets sent to a `uuid`-typed column.
- **`reaskDimensionsFor`'s UUID guard is load-bearing, not decorative** — the first live test of `flagInsight` on an old-style insight would otherwise 500 with a raw Postgres "invalid input syntax for type uuid" before ever reaching the ad hoc topic, since `insight.id` is a `uuid` column. Caught in code review before it shipped, not via a live crash.
- **Two more real jsonb-array bugs found via live testing, both predating this iteration, same root cause:** `pg` sends a bare JS *array* query parameter as a Postgres native array literal (`{...}`), not JSON — silently fine for an *empty* array (`{}` also happens to parse as valid-but-wrong-shaped jsonb: an empty object), but produces malformed JSON for anything with real content. `candidate_profiles.correction_log` hit this the first time `flagInsight` was ever exercised live (crashed the whole request; a stale row also had `correction_log = {}` from an earlier empty-array write, which then made `existing?.correction_log || []`'s truthy-object check propagate the wrong shape forward — both angles fixed: `JSON.stringify()` on write, `Array.isArray()` guard on read). Audited every other `jsonb` column in the schema for the same pattern (`grep` for `table.jsonb` across migrations, cross-checked each write site): `sandbox_messages.citations` had the identical unstringified-array bug, fixed alongside it even though it's an unrelated feature (Step 7) — narrow, well-understood, low-risk fix, same class the occasion_id and facet-width fixes already established as worth doing inline rather than filing away. Every other jsonb column already either stores a plain object (safe) or was already correctly stringified (the personality-engine tables built in Iterations 4-5 did this correctly from the start).
- **`dimension_score.distinct_questions` and `.variance_pattern` are new columns**, not just service-layer additions — needed durable storage because `ScoringAggregationService` already computed `distinctQuestions` each recompute but never persisted it (the "In depth" tier's own bar needs it), and `topic_linked` classifications are deliberately never written as `variance_flag` rows (Iteration 4's own decision) so the classification would otherwise be lost the moment the next recompute overwrote it — the insight generator's context-dependence eligibility check needs to read it back later.
- **`topic_thread.ad_hoc_dimensions` is a new column, not an in-memory map** — first draft of `openAdHocTopic` tracked target dimensions in a `Map` on the service instance, then was corrected before shipping: that state wouldn't survive a server restart or be visible to a different request handled by a different service instance, which defeats the entire purpose of a durable re-ask thread that might sit open for days.
- **`insight-generator.chain.ts` produces all 6 types in one LLM call**, not 6 separate calls — the types need to be considered together to avoid redundant/overlapping insights (a Tension and a Pattern insight drawing on the same two spans, say), and the model already sees every eligible dimension's evidence regardless.
- **The Distinctiveness baseline is explicitly provisional** (spec §6: "seed it from published Big Five norms... marked provisional") — implemented as "treat 50 as the population-average anchor for every dimension, speak only to genuinely large deviations (below ~25 or above ~75)" in the prompt, not a real per-dimension norms table (none was available to source authoritatively) — same category of documented approximation as Iteration 2's facet lists, flagged for whoever eventually sources real Big Five population data.
- **Tension candidates are filtered to pairs where both dimensions are currently eligible**, not always listed — `insight-generator.chain.test.ts` verifies the prompt only mentions a candidate pair (e.g. "High Motivation + low Dominance") when both dimensions cleared the medium-confidence floor for this candidate.

**Verification:** `npm test` (22 suites / 140 tests, up from 18/110 at Iteration 4), `npx tsc --noEmit`, `npm run build`, and `npm run test:ci` (17/17) all clean. Both new migrations plus the facet-width migration rolled back and reapplied cleanly against the live dev Postgres. `npm run simulate:deep-prompts-session` run fresh (post all fixes) against the real dev DB and real LLM, 10 topics, single sitting: **`progression.tier` reached `sketch` with 6 of 11 dimensions at medium+ confidence, every one of them correctly `distinct_occasions: 1`** — direct, live confirmation that the resolved Sketch-gate conflict works exactly as directed (real Sketch-tier payoff in one sitting, honestly marked as single-session, no hard block). `GET /api/profile/progression` returned the matching tier + all 6 dimensions correctly flagged as `singleSessionDimensions`. `POST /api/profile/generate` returned a real 200 profile — 3 resume/transcript-derived insights plus 1 personality-engine insight (category `distinctiveness`), the latter's `id` a real UUID matching its source `insight` table row exactly. `POST /api/profile/insights/flag` on that personality insight correctly: generated a targeted re-ask, opened a real ad hoc `topic_thread` (`reask-<insight-id>`) with `ad_hoc_dimensions: ["social_energy"]` — the dimension `reaskDimensionsFor` derived from the flagged insight's own supporting evidence — and closed the candidate's prior still-open thread rather than orphaning it. `correction_log` round-tripped correctly as a real JSON array both times (insert and update). All live test data cleaned up after verification.

---

## Iteration 6 — Channel switching (web ⇄ email)

**Depends on:** Iteration 3 (topic-thread selection logic must exist to hand a question to either channel) — does not depend on 4/5, could reorder earlier if desired.
**Spec sections:** §1 constraint 3, §3 (probe depth is channel-dependent), §5 ("session is not a concept").
**Flow addendum sections:** §3 (Step 5 opens to email).
**User-visible change:** yes — Step 5 gains an email option.

**Scope:**
- Re-point the existing Resend gateway (`backend/src/services/email.service.ts`, `backend/src/routes/webhooks.routes.ts`) from the current session/step-bound `conversation_threads` model to the new `topic_thread`/`exchange` model for Step 5 specifically. Step 3 (logistics) email channel is unaffected — this iteration doesn't touch it.
- Probe depth becomes channel-aware: one follow-up in chat, up to four or five over a week in email, gated on "did the last exchange add new evidence" rather than a fixed count.
- Mid-thread channel switch: a topic opened in chat can continue in email and vice versa without losing thread continuity or double-counting `occasion_id`.

**Out of scope:** the weekly proactive scheduler (Iteration 9) — this iteration makes channel switching *possible* when the candidate initiates it, not proactive.

**Done when:** a topic opened in live chat can be continued by real (or simulated, via `simulate-inbound-email.ts`) email reply days later, lands in the same `topic_thread`, and gets a correct new `occasion_id`.

**Files touched:** *(fill in when done)*

**Notes / decisions:** *(fill in when done)*

---

## Iteration 7 — Calibration run → unlock scores + culture capture

**Depends on:** Iterations 2, 4, 5 (needs the console, real evidence, and tiers all live).
**Spec sections:** §9.4 (Calibration set), §9.5 (Score stability check), §7 (Culture Capture), §10 step 11.
**Flow addendum sections:** §7 (Step 8 tier precondition).
**User-visible change:** yes — numeric scores/bands appear for dimensions that clear the bar; Step 8's share button becomes conditionally enabled.

**Scope:**
- Run calibration against real Phase 3 prototype transcripts per §9.4: Michael + ≥1 paid outside rater (I/O psychologist per the roadmap), ICC ≥ 0.75 measured against the human-vs-human ceiling, not against 1.0.
- Per-dimension gating: a dimension clearing the bar unlocks score+band rendering; one that doesn't (Thinking Style and Detail Orientation are the spec's own predicted failures) ships narrative-only indefinitely, tracked per-dimension, not as an all-or-nothing product switch.
- Stability check (§9.5): same transcript through scoring 5×, flag any dimension whose variance exceeds its own confidence band — this is a rubric-quality signal, feeds back into Iteration 2's prompts if a dimension fails it.
- Culture-signal capture: CVF quadrant mapping from Q0/Q15/Q21 answers, stored in `culture_signal`, explicitly tagged as environmental data, never blended into personality dimension scores.
- Step 8 gating per addendum §7: share button enabled only once `progression.tier == Core persona`; visible-but-disabled otherwise, with a reason ("which dimensions are still thin").

**Out of scope:** RAG wiring (Iteration 8).

**Done when:** the calibration console shows real ICC numbers per dimension with a pass/fail against the human-vs-human ceiling; at least one dimension is confirmed rendering scores end-to-end in the UI; Step 8's button is confirmed disabled for a Sketch-tier fixture profile and enabled for a Core-persona one.

**Files touched:** *(fill in when done)*

**Notes / decisions:** *(fill in when done — record actual ICC results per dimension; this is the historical record of what shipped narrative-only)*

---

## Iteration 8 — RAG convergence + guardrail enforcement

**Depends on:** Iteration 7 (needs real scored evidence to be worth indexing).
**Spec sections:** §5 ("evidence is the join key"), §8 (Guardrails) in full, §10 step 12.
**User-visible change:** yes, recruiter-facing — Sandbox/Share chat can answer from evidence spans.

**Scope:**
- Embed `dimension_evidence` spans into the existing pgvector RAG tier (`profile_evidence`/`conversation_evidence`) or a clearly-tagged third tier — decide which during this iteration and record it; either way, `search_candidate_evidence` (`evidence-search.tool.ts`) needs to be able to retrieve them.
- Implement §8's recruiter-visibility rules as an actual query-time/render-time filter, not a prompt instruction alone:
  - Raw Emotional Stability score never surfaces to a recruiter — only derived work-relevant statements.
  - Q5/Q6/Q19/Q20 answers never surface verbatim to a recruiter, even via RAG retrieval — their *derived scores* can still inform ranking, the raw text is filtered at the retrieval boundary.
  - No inference not traceable to job-relevant behavior.
- Bias-control audit logging groundwork: log enough to eventually segment score distributions by voluntarily-provided demographic data (§8) — no audit report yet, just the logging.

**Out of scope:** the actual adverse-impact audit report (needs volume the product doesn't have yet — explicitly deferred in the spec).

**Done when:** a recruiter share-link chat session can answer "how does this person handle pressure?" by retrieving and quoting a `dimension_evidence` span from a non-restricted question, and a targeted test confirms a Q19 (Pressure Gauge) span is never returned verbatim even when directly asked.

**Files touched:** *(fill in when done)*

**Notes / decisions:** *(fill in when done — record which table design was chosen for the convergence)*

---

## Iteration 9 — Weekly scheduler (deprioritized)

**Depends on:** Iteration 6 (channel model) and Iteration 5 (tiers, for the "offer to close" / dormancy logic to reference).
**Spec sections:** §3.5 "Re-engagement cadence" in full.
**User-visible change:** yes — proactive weekly email.

**Scope:**
- One email/user/week regardless of open-thread count; payload selection (continue active thread vs. new question vs. offer-to-close after 3 weeks idle) per the §3.5 table.
- Pace/pause/unsubscribe controls in every email, clearly separable from account/profile deletion; pause options of 30/90 days/indefinitely, resumable with no state loss.
- Hard stop at 4 unanswered prompts → dormant, single-click return.
- Never a second email in the same week for any reason.
- Deliverability isolation: keep prompt-sending separable at the module level from thread-reply handling (per the spec's explicit Postmark/vendor-risk note), even though it shares infra with Iteration 6's reply threading for now.

**Out of scope:** nothing further downstream depends on this — it's the last iteration in the current plan.

**Done when:** a simulated multi-week clock produces exactly one email per user per week, correctly alternates continue/new/offer-to-close, respects a pause, and reaches dormancy at 4 unanswered without a 5th send.

**Files touched:** *(fill in when done)*

**Notes / decisions:** *(fill in when done)*

---

*Companion to: `docs/personality-analysis-engine-spec.md`, `docs/personality-engine-flow-addendum.md`, `docs/onboarding-ux-flow-spec.md`.*
