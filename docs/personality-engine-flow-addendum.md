# Personality Engine ↔ Onboarding Flow — Addendum

*Reconciles `docs/personality-analysis-engine-spec.md` with `docs/onboarding-ux-flow-spec.md`. The onboarding spec is design-locked for v1 per CLAUDE.md; this addendum is the one deliberate, scoped exception, limited to the points below. Everything else in that spec — the 8-step shape, Steps 1–4, 6–8's non-tier behavior, Step 6.5's undecided status — remains locked as written.*

**Status:** Design spec for build, companion to both source specs.

---

## 1. The conflict this resolves

The onboarding spec treats Step 5 (Deep Prompts) as a single gated, live-chat-only step: answer enough, the step completes, the flow advances. The personality engine spec is explicitly not step-shaped — it's an indefinite, tier-based, channel-switchable engine (§1 constraints 3–4: "depth over speed — the slow cooker," "channel is the user's choice, and switchable... supersedes the earlier 'Step 5 is chat-only' decision"). Read literally, gating flow progression on the engine's own "done" state (Core persona: all 11 dimensions at medium confidence) would strand a candidate mid-onboarding for weeks, which directly contradicts "time-to-value stays in their hands, not the product's."

This addendum resolves that by tier-gating Step 5's *flow* completion at the cheapest tier (Sketch) rather than the full tier (Core persona), and letting the engine keep running in the background past that point — the same `railVisible: false` / CTA pattern the onboarding spec already uses for Sandbox and Share.

---

## 2. Step 5 completion criterion → Sketch tier

**Change:** Step 5 (`deep_prompts`) is marked complete in `flow_progress.steps_state` the moment the personality engine's `progression.tier` first reaches **Sketch** (any one dimension at ≥ medium confidence) — not on a fixed question count, and not on Core persona.

Rationale: Sketch is the spec's own first real stopping point ("first narrative insights... enough to feel the product works," §3.5). In practice this means the core set (Q0 + the three gap-closers, Q23–25) plus whatever follow-ups the topic-close criteria demand — typically reachable in one sitting, preserving today's onboarding pace.

`current_step` still advances `resume → logistics → deep_prompts → profile_review → sandbox → share` exactly as today. Nothing about the 6-step shape or ordering changes.

---

## 3. Step 5 channel: opens to email

**Change:** Step 5's `channels` gains `email`, superseding the onboarding spec's "Channel: live chat only — no email" line (docs/onboarding-ux-flow-spec.md, Step 5). This is not a new decision — the personality engine spec already states this supersession in its own §1 constraint 3; this addendum is what actually flips the locked line in the flow doc.

**Default stays chat**, unchanged: the core-set questions (Q0, 23–25) are the ones doing the heaviest methodological lifting via real-time probing, so the elicitation UI should still open in live chat by default. But per the engine spec, the candidate can move a topic to email at any point, per-question or mid-thread, and nothing in Step 5's UI should assume a chat session is the only valid state to resume into.

---

## 4. Two progression tracks, not one

Two independent tracking structures now exist and must stay independent:

| Track | Table | Granularity | Lifespan |
|---|---|---|---|
| **Flow progress** | `flow_progress` (existing) | 6 `FlowStepId`s | Ends at Step 8 completion — this is "onboarding" |
| **Engine progression** | `progression` (new, personality-engine spec §5) | 11 dimensions × 4 tiers | Open-ended — this is "Ongoing" |

Step 5 completing in `flow_progress` is a one-time trigger read off `progression.tier`, not a merge of the two tables. After Step 5 flips to complete, the underlying `topic_thread`/`exchange` engine keeps running exactly as it would if the flow didn't exist — new questions, follow-ups, and eventually the weekly scheduler (deprioritized — see the current build-sequence ordering) continue independent of `current_step` having moved on to `profile_review`, `sandbox`, or `share`.

Concretely: a candidate can be on Step 7 (Sandbox) in the rail while still answering deep-prompt questions in the background. This is intentional, not a bug to reconcile.

---

## 5. Rail/stage impact: none

No new rail stage. The already-proposed "Understand Yourself" 3rd stage (onboarding spec, Step 6.5) is a separate, still-undecided proposal tied to the not-yet-built Career Debrief step — this addendum does not touch it and does not implement Step 6.5.

The engine's ongoing state (tier, per-dimension confidence bands, "answer one more question" prompts past Sketch) surfaces as a persistent affordance on the `profile_review`/`sandbox` pages — the same non-rail CTA pattern already used to reach Sandbox and Share from within the "Interview Yourself" stage (onboarding spec §"Stages vs. Steps"). No new `FlowStepId`, no new `flowStages` entry.

---

## 6. Step 6 (Profile Review) across tiers

`profile-generator.chain.ts` already treats `profile_data.insights` as narrative-plus-evidence, never a bare score (CLAUDE.md, Database Patterns) — this is naturally compatible with generating a profile before Core persona is reached:

- **First generation, at Sketch:** profile is narrative-only. No numeric score or band is rendered for any dimension, consistent with the engine spec's tier table ("Sketch: ... no scores") and independent of calibration status.
- **Regeneration on tier transition:** per the engine spec's §9.2 recommendation (full re-score runs on topic-thread close and tier transitions), profile regeneration is triggered the same way — a later regeneration at Core persona is what first makes scores+bands eligible to render, gated additionally on that dimension having cleared calibration (engine spec §9.4/§10 step 11 — a dimension that never clears calibration stays narrative-only forever, independent of tier).
- **Correction loop unchanged, and now just another topic.** Step 6's existing flag → `reask.chain.ts` → targeted follow-up mechanism needs no new machinery: the re-ask is modeled as an ad hoc `topic_thread`/`exchange` outside the fixed question library, and its answer feeds `dimension_evidence` exactly like any library question would. It's addressable in the coverage-selection scheme, not a special case.

---

## 7. Step 8 (Share) gains a tier precondition

**Change:** the Share step's affordance (the button that lets a candidate generate a link) is enabled only once `progression.tier` reaches **Core persona**. Its existing completion criterion — "the candidate has generated at least one share link" — is unchanged; this adds a precondition on *when the action is available*, not a new completion state.

Rationale: the engine spec is explicit that "shareable link enabled" is a Core persona property (§3.5), and §8's recruiter guardrails assume a profile with defensible per-dimension confidence bands, not a Sketch-tier partial. A candidate who reaches Step 8 before Core persona sees why the button is disabled (which dimensions are still thin) rather than being blocked from reaching the step at all — Step 7 (Sandbox) remains available regardless, since it's the candidate's own practice surface, not recruiter-facing.

---

## 8. Explicit non-goals of this addendum

- **Step 6.5 (Career Debrief)** and its proposed 3rd rail stage — untouched, still undecided, tracked separately in the onboarding spec and CLAUDE.md's Known TODOs.
- **The weekly scheduler** — deprioritized in the current build-sequence ordering; this addendum's Step 5/8 gating logic has no dependency on it. Everything above works identically whether the candidate is answering same-day in chat or over a slow-cooker multi-week email cadence.
- **No new `FlowStepId` or `flowStages` entry.** The 6-step, 2-stage shape is unchanged.

---

## 9. Summary of lines this supersedes in `docs/onboarding-ux-flow-spec.md`

| Location | Old | New |
|---|---|---|
| Step 5, "Channel" | "live chat only — no email" | Chat by default, switchable to email per-topic (personality engine spec §1.3) |
| Step 5 completion (implicit — no explicit tier concept existed) | Fixed question count / single sitting | `progression.tier == Sketch` |
| Step 8 availability (implicit) | Available once Step 7 reached | Available once Step 7 reached **and** `progression.tier == Core persona`; otherwise visible-but-disabled |

Everything else in the onboarding spec — Steps 1–4, 6's non-tier behavior, Step 7, the Future Features list, Step 6.5's undecided status — stands as written.

---

*Companion to: `docs/personality-analysis-engine-spec.md` (source of the tier/engine model) and `docs/onboarding-ux-flow-spec.md` (source of the locked flow shape).*
