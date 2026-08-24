# Job Seeker Onboarding & UX Flow — Spec for Prototyping

*Status: Design-locked for v1 prototype. Employer-side flow, matching/discovery mechanism, and long-term re-engagement are explicitly out of scope for this document (see Future Features).*

*Revision note (2026-08-08): the rail-facing IA was collapsed from 6 steps to 2 stages — "Tell Your Story" and "Interview Yourself" — per product direction. This is a presentation change, not a data-model change: the 6 steps below (and their distinct completion criteria, data tables, and channel rules) are unchanged and still the unit of progress tracking. See "Stages vs. Steps" below.*

---

## Design Principles

1. **No self-scoring, ever.** Personality/culture signal is inferred by the AI from open-ended, narrative answers — never from Likert scales, forced-choice items, or direct self-assessment questions. This is a deliberate methodology choice, not a missing feature.
2. **Async is a first-class strategy, not a fallback.** Email exists because deep reflection benefits from time to think and revise — not as an accessibility accommodation for people who can't do live chat.
3. **User owns and approves their profile**, but correction is intentionally lightweight in v1 — full transparency and granular editing are secondary features, not blockers to launch.
4. **Don't assume the user has an hour to spare.** The flow should be resumable and splittable across sessions/channels by design, not as a patch.

---

## Flow Overview

| Step | Name | Channel |
|---|---|---|
| 1 | Registration (stubbed for dev) | — |
| 2 | Resume upload / manual entry | App |
| 3 | Logistics discussion (goals, industry, location, priorities) | **App or Email (user's choice)** |
| 4 | *(channel selection is embedded in Step 3, not a separate step)* | — |
| 5 | Deep prompts (personality, collaboration style, formative situations) | **App or Email (user's choice)** |
| 6 | AI-generated profile + lightweight correction | App |
| 7 | Interactive sandbox — preview the "virtual interview" experience | App |
| 8 | Shareable, time-boxed recruiter access link | App-generated, external access |

---

## Stages vs. Steps (rail presentation)

The 8 steps above remain the underlying unit of design and progress tracking — each keeps its
own completion criteria, data, and (where relevant) channel rules. What changed is how they're
*presented* in the progress rail: instead of exposing every step as a top-level tab, the rail
groups them into two stages.

| Stage | Name | Contains |
|---|---|---|
| 1 | **Tell Your Story** | Steps 2 (Resume), 3/4 (Logistics), 5 (Deep Prompts) — each still its own rail sub-entry within the stage. |
| 2 | **Interview Yourself** | Step 6 (Profile Review) is the stage's rail entry. Steps 7 (Sandbox) and 8 (Share) are **not separate rail entries** — they're reached as CTAs from within Step 6/7, once the profile is approved. |

**Why this split:** Steps 2–5 are the "gathering" phase — distinct screens/interactions a
candidate moves through in sequence, so keeping them individually navigable in the rail still
helps orientation. Steps 6–8 are the "output" phase — one primary artifact (the profile) with two
optional, non-blocking things you can do with it (rehearse, share). Exposing those as equal-weight
rail tabs overstated their weight; as CTAs they read as what they are — actions, not stops.

**Gating:** the Sandbox and Share CTAs both become available together once the candidate approves
their profile (Step 6) — trying the sandbox is *not* a prerequisite for generating a share link.

**What didn't change:** `flow_progress.steps_state` still tracks all 6 `FlowStepId`s
independently; `current_step` still advances through all 6 in order (`resume` → `logistics` →
`deep_prompts` → `profile_review` → `sandbox` → `share`). A stage reads as "complete" in the rail
once its rail-visible step(s) are complete — for "Interview Yourself" that's just `profile_review`,
so the stage shows done as soon as the profile is approved, independent of whether sandbox/share
were ever used.

**Proposed next iteration (not yet built — see Step 6.5 below):** once the Career Debrief step
is implemented, the 2-stage table above becomes 3 stages — `profile_review` moves out of
"Interview Yourself" and pairs with the new debrief step under a middle stage
(**"Tell Your Story" → "Understand Yourself" *(working name)* → "Interview Yourself"**),
with "Interview Yourself" narrowing to just the sandbox/share CTAs. This is a placement decision
recorded ahead of implementation, not a description of the current codebase.

---

## Step 1 — Registration
Stubbed for development. No further spec needed at this stage.

---

## Step 2 — Resume Upload / Manual Entry

**Two entry paths, presented as equally valid:**
- **Standard path**: Upload resume → parse → prefill name, contact info, work history.
- **Career-changer path**: Explicitly offered as an alternative framing, not a fallback for "no resume." Career changers *do* have work history — what they need is a different prompt set that asks about transferable skills, motivation for the change, and what they're moving *toward* rather than optimizing the framing of what they're moving *from*.

**Requirements:**
- Resume parser output (name, dates, titles, companies) must go through a **confirmation/correction screen** before being treated as ground truth — parsers get this wrong often enough to matter.
- Career-changer detection can be self-selected ("I'm changing industries/roles") rather than inferred — simpler and more reliable for v1.

---

## Step 3 — Logistics Discussion

**Content:** Goals, target industries/roles, location/remote preferences, situation (actively looking, passive, timeline), work environment preferences, priorities (comp vs. growth vs. stability, etc.). This is factual/preference elicitation — distinct from Step 5's inferential work.

**Channel: user's choice, app or email.**
- This is the first place async is offered, and it's framed to the user as an *affordance* ("take your time, answer when it's convenient") not a lesser option.
- Email replies are parsed and folded into the same underlying session/profile data as chat would be — no second-class data path.

---

## Step 4 — Channel Mechanics (Email Thread Behavior)

*(Folded into Step 3 in the user-facing flow; broken out here because it has distinct technical requirements.)*

- Email conversation is **thread-based and adaptive** — the AI reads the reply and generates a follow-up question grounded in what the user actually said, same as it would in chat, just at async pace.
- Each inbound email reply is parsed, appended to the user's session/profile data, and can trigger the next question in the thread.
- The email thread and any app-based session for the same user must resolve to **one unified profile state** — no separate "email profile" and "chat profile" to reconcile later.
- Reasonable bounds needed: thread length cap, timeout/nudge logic if a user goes silent mid-thread, and a way to pick the thread back up seamlessly from the app.

**Design intent — real email gateway (built):** the product direction was for most candidate
interaction to eventually happen over email, with the in-app experience as the fallback rather
than the default — that's now real, not aspirational. `channel` is a first-class, per-message
property (not inferred from context), and `messages`/`conversation_threads` (Step 3) and
`topic_thread`/`exchange` (Step 5) are channel-agnostic — the elicitation engines
(`ConversationService`, `TopicConversationService`) don't know or care whether a given turn
arrived through chat or email. Outbound/inbound delivery goes through Resend
(`backend/src/services/email.service.ts` for outbound, `backend/src/routes/webhooks.routes.ts`'s
Svix-verified webhook for inbound) — see CLAUDE.md's "Email gateway (real, via Resend)" section
for the full picture, including the deliberate in-app-reply-stays-in-app asymmetry.
`RESEND_API_KEY` unset keeps everything simulated in-app exactly as this section used to describe.
Resume intake by email is still unbuilt — `InboxService` (Step 3) and its `TopicConversationService`
equivalent (Step 5) both still only cover their own step; generalizing further is a prerequisite
for email-based resume intake, deferred until that's actually being built.

---

## Step 5 — Deep Prompts (Personality, Collaboration Style, Formative Situations)

**Channel: user's choice, app or email** — superseded from this doc's original "live chat only" decision by `docs/personality-engine-flow-addendum.md` §3: the candidate picks once up front (mirroring Step 3's picker) and can move a topic to email, or back to chat, at any point. Chat is still the default, since the adaptive, real-time back-and-forth is doing real methodological work here (per the research primer: critical-incident and storytelling-based prompts outperform direct self-assessment, and that depends on being able to probe in the moment) — but that work isn't lost by answering async, since the AI still reads the full thread and asks a grounded follow-up either way, just at async pace.

**Content approach:**
- Open-ended, self-descriptive questions only. No numeric or forced-choice items anywhere in this step.
- Prompts should draw out stories and specifics ("tell me about a time...", "walk me through a decision you made when...") rather than asking users to characterize themselves abstractly.
- Each question should be designed to surface multiple underlying signals at once (e.g., a story about a conflict can reveal conscientiousness, agreeableness, and stress response simultaneously) rather than one question per trait.
- The AI should be free to follow up adaptively based on what's said — this step is explicitly *not* a fixed script.

**Open item for the prototyping phase:** the actual prompt bank/question design is a distinct workstream (per your research primer's Part A) — this spec defines the *shape* of the interaction, not the specific question content.

---

## Step 6 — AI-Generated Profile, Assessment & Correction

**Output:** A structured, narrative career/personality profile synthesized from Steps 2, 3, and 5.

**Correction mechanism (v1, intentionally minimal):**
- User can **flag a specific insight as "not accurate."**
- Flagging triggers **one targeted re-ask** — the AI re-probes the disputed area with a new question rather than simply accepting an override. This preserves the "don't just trust self-report" principle even in the correction path.
- No manual score/trait editing. No "why did you conclude this" transparency view in v1 — both are explicitly deferred (see Future Features).

---

## Step 6.5 — Career Debrief *(proposed addition — not yet design-locked)*

*Added 2026-08-09 per product direction. Unlike the rest of this doc, this step is not locked — it's captured here so the shape and the deliberately-excluded scope are on record before implementation, not because the interaction design is finalized.*

**Placement:** Between Step 6 (profile approval) and Step 7 (sandbox) — it needs the approved profile as raw material, and it's meant to inform how the candidate approaches the practice interview that follows. Proposed stage regrouping: pull `profile_review` out of the "Interview Yourself" rail stage and pair it with this new step under a new middle stage — **Tell Your Story → [new stage] → Interview Yourself** — so the three stages read as *gather → understand → perform*. "Interview Yourself" narrows to just sandbox + share. Working name for the new stage: **"Understand Yourself"** (placeholder, matches the reflexive-imperative pattern of the other two — open to feedback, same as the stage names were).

**Purpose:** A personalized, *conversational* debrief — not a static report — on what the candidate's own profile actually means: what kind of environment will (and won't) work for them, what strengths and blind spots to carry into an interview, and how their working style shows up in practice. This is coaching on signal already gathered in Steps 2/3/5, not a new elicitation pass — no new self-report, no scoring, same as everywhere else in this flow.

**Content approach (v1, in scope now):**
- Same whole-profile-as-context pattern as `sandbox-chat.chain.ts` — no new RAG/vector infra. A new chain (e.g. `career-debrief.chain.ts`) reasoning over the approved profile plus underlying resume/logistics/deep-prompt data.
- Adaptive live chat via the existing `ConversationService` pattern, not a wall of static text — the candidate can ask "why do you say that" or "how should I bring this up in an interview" and get a real follow-up.
- Covers, narratively and with evidence (never a bare score, per the standing "no self-scoring" principle):
  - **Environment fit** — what kind of team/company culture will and won't work well, grounded in evidence already in the profile.
  - **Interview-facing strengths & opportunities** — how to lean into strengths, what blind spots to watch for, framed specifically for how it plays across the table in an interview.
  - **Work-style takeaways** — the Step 6 synthesis made conversational and probeable instead of a static card.
- Channel: Step 5 is live-chat-only because the real-time probing does methodological work extracting new signal. This step isn't extracting new signal, only explaining existing signal — so **email may be a legitimate channel here too**. Open item, not decided.

**Explicitly out of scope until a real data source exists — this is a hard block, not a v1/v2 sequencing nicety:**
- Industry trends, salary comparisons, and comparisons to alternate paths (different location, vertical market, lateral moves) all require external market/compensation data the system does not have today — no external API, no web access from any AI chain, no licensed dataset, nothing.
- **No chain in this step may have the LLM freehand salary figures, trend claims, or comparative numbers from parametric knowledge.** Candidates may make real financial and career decisions off this — an unsourced number that's wrong or stale is a real harm, not a formatting nitpick.
- This sub-feature ships only once a real data source is selected and integrated (a compensation-data API, a labor-market-trends source, etc.) — that's a separate workstream with its own vendor/build decision. Until then, the debrief covers self-understanding and interview/work-style coaching **only** — no market-comparison content of any kind, not even hedged or approximate.

**Open items for the prototyping phase:**
1. Final stage/step naming ("Understand Yourself" is a placeholder).
2. Whether this step is required (gates progression to Step 7) or optional/skippable — every other step in this flow is completion-gated; this one might reasonably be "read as much or as little as you want."
3. Market/compensation data source selection — its own workstream, not scoped here.
4. Whether a debrief conversation can surface something that routes back into Step 5/6, the way sandbox gap-flagging already does.

---

## Step 7 — Interactive Sandbox

The user chats with their own RAG-backed profile as if they were a recruiter or hiring manager interacting with it. This is both a QA step (does this represent me well?) and a trust-building step (the user sees exactly what an employer would see, before anyone else does).

**Feedback loop:** if the sandbox conversation surfaces a gap ("it doesn't know how to answer X"), the user should be able to route that back into Step 5/6 rather than the sandbox being a dead end. Exact mechanism (auto-suggest returning to a specific topic vs. general "add more" entry point) is a prototyping-stage decision.

---

## Step 8 — Shareable Recruiter Access Link

**Model: a time-boxed access token to the exact same chat + RAG experience the user has in Step 7.** Not a separate recruiter-facing UI, not a static summary, not a different data view.

**In scope for v1:**
- Generate a link with an expiration date.
- Anyone with the link gets the same interactive chat, backed by the same profile data the user approved.

**Explicitly out of scope for v1** (see Future Features): granular per-share visibility control, view/interaction analytics back to the user, revocation beyond natural expiry. The goal is finding good fit, not building an engagement/analytics layer around the share link.

---

## Session & Resumability

- A user's session (chat + email thread state) is stored and resumes seamlessly on login — no "start over" or manual reload of prior context.
- This is part of why async matters: a user may start a Step 3 email thread, not finish it for two days, then pick up in the app and have it feel continuous.

---

## Future Features (explicitly deferred, not designed here)

- Employer-side onboarding flow (mirrors the job-seeker flow but needs its own structured-elicitation design per the culture-matching research — employers won't self-report honestly, so this needs trade-off/critical-incident questions, not "describe your culture").
- Matching/discovery mechanism beyond the passive share-link model (system-driven recommendations, recruiter search, etc.).
- Full transparency view in Step 6 (showing *why* the AI inferred something).
- Granular share-link controls (per-recruiter visibility settings).
- Link analytics (views, questions asked) surfaced back to the user.
- Profile staleness/refresh and long-term re-engagement.
- **Market/compensation intelligence** (industry trends, salary comparisons, comparisons to alternate paths — different location, vertical market, lateral moves): the content half of Step 6.5 above. Blocked on selecting and integrating a real external data source (compensation-data API, labor-market-trends source, etc.) — not scoped here, and explicitly not to be approximated via LLM parametric knowledge in the meantime.

---

## Open Items for the Prototyping Phase

1. Step 5 prompt bank — actual question design/content (separate workstream, per research primer Part A).
2. Step 6 → Step 5 re-ask mechanics — exact UX for how a flagged insight routes back into a live-chat follow-up.
3. Step 7 → Step 5/6 feedback loop — how a sandbox-surfaced gap gets back into the profile-building flow.
4. Email thread bounds — length cap, silence/timeout handling, re-engagement nudges.
5. Step 6.5 (Career Debrief) — stage/step naming, required-vs-skippable, and whether its channel can include email. See Step 6.5 section for full scope.
6. Market/compensation data source selection for Step 6.5's deferred half — vendor/build decision, not started.
