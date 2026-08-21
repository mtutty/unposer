# Personality & Work Style Analysis Engine — Consolidated Spec

*Consolidates three prior workstreams: the interview question library, the 11-dimension continuum model, and the LLM scoring framework. Purpose: take the prototype from a flow that looks real to an analysis layer that produces defensible scores and genuinely interesting insights.*

**Status:** Design spec for build. Employer-side capture, matching, and analytics remain out of scope.

---

## 1. Design Constraints (locked, carried forward)

1. **No self-scoring, ever.** No Likert items, no forced-choice inventories, no "rate yourself 1–5." All signal is inferred from open-ended narrative answers. This is a methodology choice, not a missing feature.
2. **Questions must earn the answer.** The failure mode of a 100-item inventory is that it trains people to stop thinking. Every question in the library is designed to create cognitive investment — a surprising angle, a real trade-off, something they haven't been asked in twenty interviews.
3. **Channel is the user's choice, and switchable.** *(Revised — supersedes the earlier "Step 5 is chat-only" decision.)* Onboarding defaults to interactive web chat. From there the user sets the pace and can move between live chat and email at any point, per question or mid-thread. Time-to-value stays in their hands, not the product's.
4. **Depth over speed — the slow cooker.** The preferred path is one question every few days, with multiple exchanges on a single topic before it's considered complete. The goal is the user's *best* answer, not their first available one. Elapsed time is a feature: sampling the same dimension across separated occasions cancels occasion-specific variance (mood, fatigue, what happened that morning), which is the failure a single-sitting assessment cannot escape and the mechanism behind MBTI's retest instability.
5. **Continuous dimensions, not types.** Scores are positions on a 0–100 continuum. Never emit a category label like "you're an ENTJ" or "you're a Driver."
6. **Evidence-backed or it doesn't ship.** Every score must be traceable to specific spans of the user's own words. This is both the scientific requirement and the brand promise.
7. **The user is always volunteering.** Past the core persona, every additional question is optional and must justify itself by what the person gets back — reflection, insight, enjoyment. Nothing is "required input." If a question isn't worth answering for its own sake, it doesn't belong in the library.

---

## 2. The Dimension Model

Eleven continua, each a cross-framework synthesis (Big Five as the empirical spine; Hogan HPI/HDS, DISC, and CliftonStrengths as vocabulary overlays). MBTI deliberately excluded.

| # | Dimension | 0 pole | 100 pole |
|---|---|---|---|
| 1 | **Emotional Stability / Adjustment** | Reactive, anxious, self-critical, stress-vulnerable | Calm, resilient, even-tempered, unbothered |
| 2 | **Social Energy / Extraversion** | Reserved, solitary, drained by group interaction | Outgoing, gregarious, energized by people |
| 3 | **Dominance / Assertiveness / Ambition** | Deferential, accommodating, low status-seeking | Directive, competitive, seeks authority |
| 4 | **Agreeableness / Interpersonal Orientation** | Skeptical, challenging, tough-minded | Trusting, cooperative, accommodating |
| 5 | **Conscientiousness / Organization** | Spontaneous, flexible, improvisational | Structured, disciplined, process-driven |
| 6 | **Openness / Intellectual Curiosity** | Practical, conventional, proven-methods | Curious, abstract, novelty-seeking |
| 7 | **Change Orientation / Risk Tolerance** | Stability-preferring, cautious, risk-averse | Change-seeking, bold, comfortable with ambiguity |
| 8 | **Thinking Style** | Intuitive, pattern-based, fast-judgment | Analytical, evidence-first, systematic |
| 9 | **Detail Orientation** | Big-picture, directional, tolerant of rough edges | Detail-precise, thorough, exacting |
| 10 | **Motivation & Achievement Drive** | Sufficiency-oriented, balance-seeking | Achievement-driven, ambitious, restless |
| 11 | **Work Style** | Independent, autonomous, single-owner | Collaborative, consensus-oriented, team-embedded |

**Cross-framework anchors** (for vocabulary when explaining a score, not for scoring itself):

| Dimension | Big Five | Hogan HPI | Hogan HDS (extreme) | DISC |
|---|---|---|---|---|
| Emotional Stability | Neuroticism (rev.) | Adjustment | Excitable (rev.) | — |
| Social Energy | Extraversion | Sociability | Colorful / Reserved | I |
| Dominance | Extraversion (assertiveness) | Ambition | Bold / Dutiful | D |
| Agreeableness | Agreeableness | Interpersonal Sensitivity | Skeptical (rev.) | S |
| Conscientiousness | Conscientiousness | Prudence | Diligent (high) | C |
| Openness | Openness | Inquisitive, Learning Approach | Imaginative (high) | — |

**Important:** neither pole is "good." Copy in the product must never imply otherwise. Dimension 1 in particular is never surfaced to a recruiter as a raw number (see §8).

---

## 3. Question Library — Coverage Matrix

Twenty-two existing questions, mapped to the dimensions each is most likely to load on. **P** = primary (question is designed to produce strong signal here). **s** = secondary (usable signal, lower weight).

| # | Question (short name) | 1 ES | 2 SE | 3 DA | 4 AG | 5 CO | 6 OP | 7 CH | 8 TS | 9 DO | 10 MO | 11 WS |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 0 | The Stars on Your Team *(seed question)* | s | s | s | **P** | | s | | | | s | |
| 1 | The Unofficial Curriculum | s | | | | | **P** | s | | | s | |
| 2 | Highlight Reel vs. Cutting Room Floor | s | | s | s | | | | | | **P** | |
| 3 | The Parallel Universe Question | **P** | | | | | s | **P** | | | s | |
| 4 | The Obstacle That Stayed | **P** | | | s | s | | | | | | |
| 5 | The Breaking Point | **P** | | | s | s | | | | | | |
| 6 | The Pattern You Can't Break | **P** | | | | **P** | | | s | | | |
| 7 | The Time Audit | | s | | | **P** | | | | s | s | |
| 8 | The Collaboration Spectrum | | s | s | s | | | | | | | **P** |
| 9 | The Deliverable Dilemma | s | | | | **P** | | s | | **P** | | |
| 10 | The Advice Network | | s | | **P** | | | | | | | s |
| 11 | The Energy Equation | s | **P** | | s | | | | | | | s |
| 12 | The Influence Approach | | s | **P** | s | | | | s | | | |
| 13 | The Trade-Off Triangle | s | s | | | | | s | | | **P** | |
| 14 | The Unsung Win | | | | s | | | | | s | **P** | |
| 15 | The Deal-Breaker | s | | | **P** | | s | | | | | |
| 16 | The Mind-Change Moment | | | | s | | **P** | **P** | s | | | |
| 17 | The Skill That Won't Stick | s | | | | s | s | | | | s | |
| 18 | The Curiosity Catalog | | | | | | **P** | | s | | | |
| 19 | The Pressure Gauge | **P** | s | | | s | | | | | | |
| 20 | The Mistake Autopsy | **P** | | | s | s | | | s | | | |
| 21 | The Job Description Gap | | | | s | | | | **P** | s | | |
| 22 | The Future Self Interview | s | | | | s | | s | | | **P** | |

### Coverage findings

**Over-sampled:** Emotional Stability (6 primaries) and Motivation (4). Both are well covered by a short question set — no need to select for them deliberately.

**Under-sampled — the real gaps:**
- **Thinking Style (8)** — one primary (Q21), and that question is really about meta-analysis of hiring, not decision process.
- **Detail Orientation (9)** — one primary (Q9), which conflates it with conscientiousness.
- **Work Style (11)** — one primary (Q8), and it's a fairly transparent "how do you like to work" question, the weakest in the library by the library's own standard.
- **Dominance (3)** — one primary (Q12), acceptable but thin.

### Three questions to close the gaps

**23. The Gut Call** *(→ Thinking Style P, Change Orientation s, Emotional Stability s)*
> "Tell me about a call you made where the data pointed one way and your instinct pointed the other. Which did you follow? And knowing how it turned out — do you trust yourself more or less on that kind of call now?"

Loads on Thinking Style directly through revealed behavior rather than self-description. The final clause is the good part: it separates people who updated from people who narrativized.

**24. The Thing You'd Catch** *(→ Detail Orientation P, Agreeableness s, Conscientiousness s)*
> "When you're reviewing someone else's work — a doc, a design, a pull request — what do you notice first? And what's the thing you know you consistently miss that someone else on the team always catches?"

Detail orientation without asking "are you detail-oriented." The second half also produces genuine self-knowledge, which is the kind of moment that makes the product feel worth doing.

**25. The Balance You Got Wrong** *(→ Work Style P, Social Energy s, Dominance s)*
> "In an ideal week, how much of your time is you alone with a problem versus you in a room with other people? Now tell me about a stretch of work where that balance was badly wrong — in either direction — and what it did to you."

Replaces or supplements Q8. Asking about the failure mode is what makes it non-obvious; anyone can state a preference, fewer can describe what happens when it's violated.

### Selection logic

There is no fixed session length and no fixed script. The engine always holds a ranked "next question" and serves it whenever the user shows up, in whichever channel they're in.

1. **Core set first.** The seed question (Q0 — doubles as culture capture, see §7) plus one question per under-sampled dimension (23, 24, 25), since nothing else covers those. These form the spine of the core persona (§3.5).
2. **Then select to close coverage.** After each answer is scored, compute per-dimension confidence and pick the next question whose primary dimensions have the lowest confidence. Coverage, never count, drives selection.
3. **Never two heavy questions in a row.** Q5 (Breaking Point), Q6 (Pattern), Q19 (Pressure Gauge), and Q20 (Mistake Autopsy) are emotionally demanding. Alternate with lighter ones (Q18 Curiosity Catalog, Q25, Q13).
4. **Prefer temporal spread over batch efficiency.** When two questions are near-equal on coverage value, choose the one that revisits a dimension last sampled longest ago. Re-sampling a dimension weeks later is worth more than first-sampling a marginal one (§4.4).
5. **Follow the energy.** A long, specific answer earns a follow-up rather than a new question. A short, flat one earns a move — a second flat answer on the same topic is worse signal than a first answer on a new one.

### Adaptive follow-up probes

Follow-ups are where thin answers become scoreable. Attach a probe rule set per question; the seed question's rules, as the pattern to replicate:

| Trigger in answer | Probe | Targets |
|---|---|---|
| Mentions themselves among the stars | "What would your colleagues say your biggest contribution was?" | Modesty, self-efficacy |
| Doesn't mention themselves at all | "And where did your own work fit into that picture? What were you known for?" | Self-efficacy vs. genuine modesty |
| Emphasizes politics | "Do you think the right people generally got recognized, or was it more about who you knew?" | Trust, cynicism |
| Shows resentment | "Sounds like that was frustrating — how did you handle that dynamic?" | Anger, coping style |

**Probe depth is channel-dependent, not capped at one.** In live chat, one probe is usually right — more reads as interrogation. In an email thread, a topic can reasonably run four or five exchanges over a week, each going somewhere a live conversation wouldn't have time to reach. The constraint isn't a number, it's whether the last exchange produced new evidence.

### Topic completion

A question stays open until it's closed, by either party:

- **The user closes it.** Always available, always honored, never penalized in the completeness model. "That's all I've got on that" ends the thread.
- **The model closes it** when its criteria are met. Criteria live in the prompt, not in the code:

```
CLOSE THIS TOPIC WHEN ANY OF THE FOLLOWING HOLD:
- The primary dimension(s) for this question have ≥2 pieces of evidence at
  moderate strength or better, and the last exchange added none.
- The person has given at least one concrete, situated incident (a specific
  time, place, and outcome) rather than only general self-description.
- Two consecutive exchanges have restated earlier material without new
  specifics.
- The person signals fatigue, reluctance, or discomfort with the topic —
  close immediately and do not return to it.

OTHERWISE, ask one follow-up that goes after what is missing: the incident if
they gave generalities, the outcome if they gave setup, their own role if they
described only others.

Never ask a follow-up whose only purpose is to confirm something already said.
```

---

## 3.5 Progression, Pacing & Completeness

The drip model needs a visible structure or it reads as an assessment that never ends. Progression is expressed as **tiers**, each independently useful, with everything past the first tier explicitly optional.

**The metric is confidence, not completeness.** Nothing anywhere in the product — user-facing or recruiter-facing — displays how much of something has been finished. What's displayed is how well-evidenced each dimension is. This is not a cosmetic distinction:

- **It can't be gamed by volume.** Confidence requires specific situated incidents, across multiple questions, on multiple distinct days, that stay mutually consistent (§4.4). Answering more questions about an already-confident dimension moves nothing.
- **It imposes effort symmetry.** A bad-faith user who wants a high-confidence profile has to construct and maintain a coherent fictional person across weeks. That is strictly more work than recalling a real one, which has the advantage of actually having happened.
- **It's the same quantity the citation methodology exposes.** Confidence *is* the density and consistency of quotable evidence. There's no separate number to defend.

**What confidence does not do** — and this needs to be stated plainly in any external positioning, because the stronger claim will eventually be tested:

- Confidence measures evidential richness, not truthfulness. A well-maintained fabrication scores high, correctly. The defense against fabrication is not the metric, it's the citation layer: every assertion traces to a quoted span, so a recruiter is reading falsifiable statements that a reference call or interview can check. The product makes faking *checkable*, not impossible.
- LLM-assisted fabrication collapses the effort asymmetry entirely. Someone can have a model maintain an invented persona indefinitely at near-zero cost. Again the citation layer, not confidence, is what survives this — invented incidents don't hold up under downstream verification.

| Tier | Reached when | What the user gets |
|---|---|---|
| **Sketch** | Any dimension reaches medium confidence | First narrative insights, no scores. Enough to feel the product works. |
| **Core persona** | All 11 dimensions at ≥ medium confidence | Full profile, scores with bands, shareable link enabled. **This is "done."** |
| **In depth** | Every dimension evidenced from ≥2 questions on ≥2 distinct occasions | Tightened bands, context-dependence and pattern insights unlocked (§6) |
| **Ongoing** | Open-ended | New questions on a cadence the user sets. Reflection, not requirement. |

### Rules

- **Every tier is a real stopping point.** A user who quits after Sketch has something worth having. Drop-off should cost them depth, not the product.
- **Pace is user-set and changeable**, including "send me one whenever," "one a week," and "give me the rest now."
- **Recruiter-facing state is coarse:** *core persona* / *in depth*, plus per-dimension confidence bands on the profile itself. No aggregate number, no percentage, nothing rankable across candidates. A rankable score turns the profile into the SEO game this product exists to avoid.
- **Past Core persona, questions are pitched as their own reward.** The invitation is "here's one worth thinking about," never "your profile is 78% complete."

### Re-engagement cadence

**One email per week, per user.** Not per open thread — a user with three open topics still gets one email. Default for everyone; user-adjustable.

Each week the engine picks one of two payloads:

| Condition | Payload |
|---|---|
| An open thread had activity in the last ~14 days | Continue it — the model's next follow-up, with the person's prior answer quoted for context |
| No recently active thread | A new question, selected by §3 coverage logic |
| A thread has sat open and idle > 3 weeks | Offer to close it ("shall we call that one done?") and include the next question |

**Requirements:**

- **The email must be worth opening on its own.** The question or follow-up is readable in full in the body — never a teaser linking back to the site. If a new insight has been generated since last contact, lead with it: the person gets something before being asked for anything.
- **Every email carries a link back to the site** for pace controls, suspend, and unsubscribe. Present three distinct options, because they mean different things: **change cadence**, **pause** (30 / 90 days / indefinitely, resumable with no penalty and no loss of state), and **stop emails entirely** — which must be clearly separable from deleting the account or profile.
- **Hard stop at 4 unanswered prompts.** The account goes dormant; no further outbound. Returning is a single click from any prior email or from the site, and the profile is exactly where they left it.
- **Never send a second email in a week for any reason** — no "just checking in," no streak reminders, no re-sends. The whole premise is that this is worth doing at the user's pace; nagging contradicts it more expensively than a missed week costs.

**Deliverability note.** Scheduled recurring outbound to the full user base pattern-matches to bulk/marketing traffic during vendor approval, even though every message is user-initiated and conversational — Postmark in particular rejects accounts that look like marketing use. Sending prompts on the same infrastructure as the reply threads keeps the conversation coherent but concentrates that risk in one vendor relationship. Be explicit with the provider about what this traffic is during onboarding, and keep prompt-sending isolated enough at the module level that it could be split to a different sender later without breaking threading. (See the email-channel vendor notes.)

---

## 4. Scoring Framework — Generalized

The existing framework was built and validated for Emotional Stability only. This generalizes it to a dimension-agnostic template that gets instantiated eleven times.

### 4.1 Per-answer scoring pass

One LLM call per (question, answer, dimension) pair where the dimension is P or s for that question. Output is **not a number** — it's an evidence object:

```json
{
  "question_id": "Q0",
  "dimension": "emotional_stability",
  "evidence": [
    {
      "span": "I tend to be more of a quiet grinder, especially when I'm nervous",
      "direction": "low",
      "strength": "strong",
      "type": "explicit_statement",
      "facet": "self_consciousness",
      "note": "Direct admission of nervousness tied to workplace visibility"
    },
    {
      "span": "I'm working on that balance myself",
      "direction": "high",
      "strength": "moderate",
      "type": "behavioral_report",
      "facet": "resilience",
      "note": "Constructive framing, active remediation rather than rumination"
    }
  ],
  "provisional_score": 42,
  "confidence": "medium-high",
  "reasoning": "Moderate anxiety around visibility, offset by self-awareness and active effort"
}
```

Separating evidence extraction from scoring is the single biggest reliability upgrade over the POC. It makes scores auditable, makes aggregation across questions principled, and gives the insight layer (§6) direct material to quote back.

### 4.2 Evidence strength weighting

| Type | Weight | Example |
|---|---|---|
| **Explicit statement** | 1.0 | "I get nervous when I have to present" |
| **Behavioral report** | 0.8 | "I rewrote the deck four times the night before" |
| **Attribution pattern** | 0.6 | Consistently crediting circumstances vs. people |
| **Linguistic marker** | 0.3 | Hedging density, qualifier frequency, emotional word rate |

Linguistic markers are deliberately down-weighted. They're real (this is the LIWC tradition) but they're also where the model is most likely to over-read verbal style as personality — a terse writer is not a low-Agreeableness writer.

### 4.3 The prompt template

Instantiate per dimension. The Emotional Stability version already exists and is the reference implementation; the others follow this shape:

```
DIMENSION: {name}
SCALE: 0–100. 0 = {left_pole_description}. 50 = balanced. 100 = {right_pole_description}.
FACETS: {facet_list}

Extract evidence from the response below. For each piece of evidence:
- Quote the exact span
- Direction (toward 0 / toward 100)
- Strength (strong / moderate / weak)
- Type (explicit_statement / behavioral_report / attribution_pattern / linguistic_marker)
- Which facet it bears on

Then:
STEP 1 — List all evidence. Do not score yet.
STEP 2 — Weigh it. Explicit > behavioral > attribution > linguistic.
         Repeated themes outweigh single mentions.
STEP 3 — Check for confounds. Is self-deprecation genuine insecurity or social
         lubricant? Is terseness a trait signal or just a writing style? Is this
         answer describing the person, or describing their former employer?
STEP 4 — Emit a provisional score with explicit reasoning.
STEP 5 — Emit confidence: high / medium-high / medium / low.
         Return "insufficient_signal" rather than guessing. A missing score is
         recoverable; a confidently wrong one is not.

CONSTRAINTS:
- Never infer from demographic, cultural, linguistic, or educational markers.
- Non-native-English phrasing, brevity, and formality are not personality signals.
- Anchor to 50 by default. Move toward the poles only on real evidence.
```

That last constraint fights a known failure mode: LLMs regress toward predicting moderate trait levels, so under-calibrated prompts produce everyone-is-a-55 profiles. But over-correcting produces spurious extremes. The fix is calibration examples, not prompt exhortation (§9).

### 4.4 Aggregation across answers

Per dimension, across the full profile history — not per session:

```
score = Σ(evidence_score × type_weight × strength_weight) / Σ(weights)
```

Anchored at 50 with a prior weight equivalent to one moderate piece of evidence, so a dimension with a single weak signal doesn't swing to an extreme.

**Confidence** is a function of four things, not just volume:
- **Evidence count** — how many distinct pieces
- **Source diversity** — evidence from 3 different questions beats 6 pieces from one
- **Temporal diversity** — evidence from 3 separate occasions beats 6 pieces from one sitting. This is the payoff of the slow-cooker model: repeated sampling across days cancels occasion-specific variance (mood, fatigue, recency of a bad meeting) that a single session bakes in as if it were trait. Weight a dimension's confidence by the number of *distinct days* contributing evidence, not just the number of questions.
- **Consistency** — high variance lowers confidence, but only after checking which kind it is (below)

**Two kinds of variance, handled differently:**

| Pattern | Interpretation | Action |
|---|---|---|
| Varies by **topic**, stable over time | Genuine context-dependence | Keep confidence; emit a context-dependence insight (§6.4) |
| Varies by **occasion**, same topic re-asked | Occasion noise | Average it out; this is what the model is designed to absorb |
| **Drifts monotonically** over weeks | Possible real change, or the person getting more candid as trust builds | Flag; do not average blindly. Weight recent evidence higher and note the direction |

The third case is the one to watch. People get more honest several weeks in, and a profile that treats week-one guardedness and week-six candor as equal samples will systematically understate whatever the person was initially reluctant to say.

Report as `score ± band`. Bands: high = ±5, medium-high = ±10, medium = ±15, low = suppress the score, show the narrative only.

---

## 5. Data Model

The unit of work is the **topic thread**, not the session. A thread spans days, channels, and any number of exchanges, and stays open until closed by the user or the model (§3).

```
topic_thread (question_id, opened_at, closed_at, closed_by, status)
  └── exchange (role, text, sent_at, channel, occasion_id)
        └── evidence[] (span, dimension, direction, strength, type, facet)

profile
  └── dimension_score[] (dimension, score, confidence, band, tier,
                         contributing_evidence_ids[], distinct_occasions)
  └── insight[] (type, text, supporting_evidence_ids[], surfaced_to_user,
                 surfaced_to_recruiter)
  └── culture_signal[] (cvf_quadrant, source_evidence_ids[])
  └── progression (tier, dimensions_at_confidence[], pace_preference,
                   next_question_id, last_contact_at)
```

Four properties that matter downstream:

- **`occasion_id` is the load-bearing new field.** Distinct calendar days, not distinct messages. It's what makes temporal-diversity confidence (§4.4) computable and what separates genuine context-dependence from occasion noise. Without it the slow cooker is just a slow form.
- **Session is not a concept in this model.** A user may answer one question across three channels and two weeks. Nothing should require a session boundary to be scored, resumed, or displayed.
- **Evidence is the join key between the score and the RAG layer.** When a recruiter asks the shared chat "how does this person handle pressure?", retrieval should hit evidence spans and their surrounding thread context — not the numeric score. The number is for ranking; the words are for the conversation.
- **Scores are versioned, evidence is immutable.** Re-running scoring with an improved rubric must not mutate what the person actually said, and must be re-runnable against the full history for calibration.

---

## 5.5 Calibration & Review Console (internal)

An admin surface in the MVP, not a later addition. Without it, calibration is a one-off spreadsheet exercise that decays the moment the rubrics change, and the §9.9 variance question never accumulates the evidence needed to answer it. Two functions, one tool.

### Additional tables

```
calibration_rating (evidence_id | answer_id, rater_id, dimension,
                    human_score, confidence, notes, rated_at,
                    saw_model_score BOOLEAN)

variance_flag (profile_id, dimension, flag_type, magnitude,
               contributing_evidence_ids[], topic_spread, occasion_spread,
               model_call, human_adjudication, adjudicated_by, adjudicated_at)
```

`flag_type` is the model's provisional read: `topic_linked` / `occasion_linked` / `monotonic_drift` / `ambiguous`. `human_adjudication` is the label that eventually resolves §9.9.

### Function 1 — Rating workbench

- Presents a single answer with one dimension's rubric alongside it. Rater enters a 0–100 score and confidence.
- **Blind by default.** The model's score is hidden until the human score is submitted, then both are shown. `saw_model_score` records any exception — ratings taken non-blind are excluded from agreement statistics. Anchoring destroys the validity of the whole exercise, and it happens silently.
- Queue is assignable, so a paid outside rater can work through a set without seeing anyone else's ratings.
- **Agreement dashboard**, per dimension: model-vs-human ICC, human-vs-human ICC, n, and pass/fail against the ship bar. The human-vs-human column is the one that matters — it's the ceiling the model is measured against.

### Function 2 — Variance review queue

- Every ambiguous variance case is written as a `variance_flag` row automatically, whether or not anyone ever looks at it. Logging is not conditional on review.
- Queue is filterable by dimension and sortable by magnitude, so review effort goes to the cases that move scores most.
- Each case shows the conflicting evidence spans with their topics and dates side by side. The reviewer picks a label; the row becomes training data for the flag classifier.
- Reviewing is optional and asynchronous. The point is that the data exists when someone has time.

### Access controls

This console exposes verbatim answers to Q5, Q6, Q19, and Q20 — material §8 explicitly keeps from recruiters. Internal access is a different question but not an automatic yes:

- Named individual accounts only. No shared admin login.
- Every view of a user's answer is access-logged with the viewer and timestamp.
- Outside raters see answers detached from identity — no name, employer, or contact fields.
- Privacy policy must disclose that answers may be reviewed internally for quality and calibration. This is standard, but it has to actually be written before the console is used on real user data.

---

## 6. The Insight Layer

This is the gap between "we computed eleven numbers" and "this told me something about myself." Scores alone are not a product — nobody is delighted by *Conscientiousness: 71*. Six insight types, generated post-session:

**1. Distinctiveness** — where the person deviates most from the population baseline. Requires a baseline; until there's real user data, seed it from published Big Five norms and mark it provisional.
> "Your curiosity range is unusually wide even among people who describe themselves as curious — you moved between four unrelated domains without prompting."

**2. Tension** — two scores that are individually unremarkable but interesting in combination. The highest-value insight type and the one most likely to produce the "how did it know that" reaction. Define an explicit tension table; candidates:
- High Motivation + low Dominance → drive without appetite for visibility
- High Openness + high Detail Orientation → wants novelty, insists on rigor; often frustrated by both fast teams and slow ones
- High Collaboration preference + low Agreeableness → wants to be in the room *in order to* argue
- High Conscientiousness + low Emotional Stability → the reliability is expensive to maintain

**3. Pattern** — a theme recurring across unrelated answers. Detected by clustering evidence spans semantically, not by dimension.
> "Three separate stories — the obstacle, the mistake, and the pattern question — all turned on you noticing something early and not saying it loudly enough."

**4. Context-dependence** — high variance on a dimension across questions is not noise, it's a finding.
> "You read as highly assertive when describing technical decisions and markedly less so around organizational ones."

**5. Environment implication** — translate scores into what kind of team this suits, framed as information for the person, not a verdict.
> "This profile tends to do well where ownership is clear and reviews are substantive, and to chafe in consensus-heavy processes."

**6. Their own words** — the closing move. Surface the two or three spans the model found most revealing, verbatim, with the reason. This is the product's core promise made literal, and it's the cheapest insight to build.

### Rules for insight generation

- **Every insight cites evidence.** No unattributed claims about the person.
- **Minimum confidence to surface**: medium. Low-confidence dimensions produce no insights.
- **Cap at 5–7 insights.** Twenty observations reads as a horoscope; the Barnum effect is the exact failure mode to avoid, and volume is what triggers it.
- **Falsifiability test**: if an insight would feel true to 80% of readers, cut it. "You value both independence and collaboration" is a Barnum statement. "You describe collaboration as something you seek out specifically when you disagree" is not.
- **Never pathologize.** Low Emotional Stability is described in terms of what it costs and what it's good for (vigilance, quality-consciousness), never as a deficit or a diagnosis.

---

## 7. Culture Capture as a Byproduct

Several questions reveal the *former employer's* culture as much as the candidate's personality — a free second data stream, and one that partly routes around the problem that employers won't self-report culture honestly.

Map to Competing Values Framework quadrants:

| Signal in answer | Quadrant |
|---|---|
| Stars rewarded for technical excellence, process mastery | Hierarchy |
| Stars rewarded for innovation, risk-taking | Adhocracy |
| Stars rewarded for team-building, mentorship | Clan |
| Stars rewarded for results, wins, numbers | Market |

Sources: Q0 (what gets rewarded), Q15 (deal-breakers — reveals which cultures they've rejected), Q21 (job description gap — reveals espoused vs. enacted).

Store separately from personality scores. This is *environmental preference data*, and it's what actually powers fit matching later — but tag it clearly, because inferring a person's traits from their employer's culture would be a serious methodological error.

---

## 8. Guardrails

Non-negotiable for anything used in a hiring context.

**Never surface to recruiters:**
- Raw Emotional Stability / Neuroticism scores. Surface derived work-relevant statements instead ("performs consistently under sustained deadline pressure") backed by the same evidence.
- Anything from Q5 (Breaking Point), Q6 (Pattern), Q19 (Pressure Gauge), or Q20 (Mistake Autopsy) verbatim. These questions exist to generate signal for the *person's own* profile insight; they are not recruiter-facing material. If a question's answer can't be shown, its derived score can still inform ranking — but the raw text stays private.
- Any inference not traceable to job-relevant behavior.

**Bias controls in the scoring prompt:**
- Explicit instruction to ignore verbal fluency, vocabulary sophistication, non-native phrasing, and answer length as trait signals. All four correlate with education and national origin, none are personality.
- Periodic adverse-impact audit once there's volume: score distributions segmented by whatever demographic data is voluntarily provided. Cannot be done at zero users, but the logging needed to do it later has to be built now.

**Framing:**
- Product copy says "signals," "tendencies," "how you described it" — never "your score," "your type," "your assessment."
- No clinical language anywhere in the user-facing surface.
- The person sees their full profile before any share link can be generated. Non-negotiable — it's the ownership promise.

---

## 9. Open Decisions

Carried forward from the scoring conversation, still unresolved. Each blocks part of the build:

1. **Facet-level or dimension-level scoring?** Facets (30 Big Five facets) are more diagnostic and produce better insights, but need far more evidence per unit and will mostly return `insufficient_signal` in a 10-question session. *Recommendation: dimension-level scores, facet-level evidence tags.* Tag the facet on each piece of evidence so facets can be rolled up later without re-scoring; don't emit facet scores in v1.

2. **When does full re-scoring run?** Adaptive selection (§3) needs a fast evidence-extraction pass per exchange. But with no session boundary, there's no natural moment for the expensive full pass. *Recommendation:* cheap extraction on every exchange; full re-scoring over complete history on topic-thread close and on tier transitions. Both are well-defined events in the §5 model.

3. **Minimum evidence threshold to emit a score.** Currently undefined. Suggested: 2 pieces from ≥2 different questions on ≥2 distinct occasions, at least one of strength `moderate` or better. Below that, suppress. The occasion requirement is what makes Core persona meaningfully harder to reach in one sitting than over two weeks — which is the intent.

4. **Calibration set.** *Decided; execution pending.* Nothing here is validated, and the 0–100 precision is theater until it is. The plan:
   - **Corpus:** instrument the Phase 3 prototype sessions from the validation roadmap (15–20 job seekers) to capture transcripts as calibration data. No separate exercise — the work is already scheduled.
   - **Raters:** Michael plus at least one paid outside rater, ideally one of the I/O psychologists already on the roadmap's interview list. Two raters minimum for a human-vs-human baseline; three is better.
   - **Ship bar:** ICC ≥ 0.75 per dimension, *measured against the human-vs-human ceiling rather than against 1.0.* If the two humans agree at 0.70, the model cannot beat that and must not be held to more.
   - **Per-dimension failure is not release-blocking.** Dimensions that miss the bar ship as narrative-only — no numeric score, no confidence band, insights suppressed — while the rest ship normally. Thinking Style and Detail Orientation are the likeliest failures, being the thinnest in the question library.
   - **Tooling:** the rating workbench in §5.5. Blind rating is not optional.

5. **Score stability check.** Run the same transcript through scoring 5× and measure variance. If a dimension swings more than its confidence band, the rubric for that dimension isn't ready. Cheap to build, and it's the fastest way to find which of the eleven rubrics are weakest.

6. ~~**Is completeness recruiter-visible?**~~ **Resolved:** completeness is not measured or displayed to anyone. Confidence replaces it in every surface (§3.5). Recruiters see coarse tier plus per-dimension confidence bands — nothing rankable across candidates.

7. ~~**Re-engagement cadence.**~~ **Resolved:** one email per week per user, continuing an open thread or opening a new question, with pace/pause/unsubscribe controls in every message and a hard stop at 4 unanswered (§3.5).

8. **Does the profile decay?** *Deferred — post-customer.* Evidence from eighteen months ago describes a real person, but possibly not the current one. Options when it matters: no decay, recency weighting past some horizon, or explicit re-asks of previously closed topics. **Nothing in this spec forecloses any of them** — because evidence is immutable and carries `occasion_id`, decay is a scoring-layer change applied retroactively to the full history, not a data migration. Not a blocker for the build.

9. **Topic-linked vs. occasion-linked variance.** *Empirical — cannot be resolved without longitudinal data. Default decided.* Distinguishing "genuinely different in different contexts" from "had a bad Tuesday" needs the same dimension sampled repeatedly across weeks, so beta is the only path. Until then:
   - **Default behavior:** when variance is ambiguous, **suppress the context-dependence insight and lower confidence.** Conservative and honest about not knowing. The alternatives — averaging it away, or surfacing the insight anyway — either flatten real people or ship claims that can't yet be stood behind.
   - **Every ambiguous case is logged** as a `variance_flag` (§5.5), automatically and unconditionally, with topic and occasion metadata. Beta then produces the labeled dataset that resolves this rather than merely revealing it.
   - **Watch item:** this default mildly penalizes genuinely context-dependent people, who look noisier than smooth fabricators — exactly the nuanced candidates the product claims to see better than a resume does. Make the discrimination an explicit calibration target, not an assumption.

---

## 10. Build Sequence

1. Instantiate the scoring prompt for the remaining ten dimensions from the §4.3 template. Emotional Stability is the reference.
2. Build the topic-thread data model with `occasion_id` (§5) — load-bearing; scoring, confidence, insights, and RAG all depend on it. Getting this wrong makes the async model unrecoverable later.
3. Build the evidence extraction pass.
4. Write the three gap-closing questions into the library and wire up coverage-driven selection (§3), including topic-close criteria in the prompt.
5. Build the aggregation and confidence layer with temporal diversity (§4.4), including automatic `variance_flag` writes on every ambiguous case.
6. Build the calibration & review console (§5.5). Early, not late — it has to be running before beta traffic starts, or that traffic produces no usable calibration data.
7. Build the progression/tier engine (§3.5) — this is what makes the drip legible to the user rather than endless.
8. Build channel switching (web ↔ email) against the thread model, not against sessions.
9. Build the weekly scheduler with pace/pause/unsubscribe controls and the 4-unanswered dormancy rule (§3.5). Keep prompt-sending isolated from thread-reply handling at the module level.
10. Build the insight generator with the tension table and the falsifiability filter (§6).
11. Run calibration (§9.4) and the stability check (§9.5). **Do not ship user-visible scores before this step** — narrative insights only until each dimension clears its bar; dimensions that fail stay narrative-only.
12. Wire evidence spans into the RAG index so the recruiter-facing chat answers from the person's own words.

---

*Supersedes: the standalone question list, the 11-dimension continuum tables, and the Emotional Stability scoring pilot. Companion to the onboarding UX flow spec.*
