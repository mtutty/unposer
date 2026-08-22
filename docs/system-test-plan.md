# System Walkthrough & High-Level Test Plan

*Manual verification guide for the full candidate-intake platform as it stands after
`docs/personality-engine-implementation-plan.md` Iterations 0–9 — the original 8-step onboarding
flow (`docs/onboarding-ux-flow-spec.md`) plus the personality engine layered on top of it
(`docs/personality-analysis-engine-spec.md`, `docs/personality-engine-flow-addendum.md`). Written
for a human tester exercising the app through the browser and a few scripted checks, not a set of
automated assertions — those already exist (`backend: npm test`, `frontend: npm run test:ci`,
`.github/workflows/ci.yml`) and are out of scope here except where noted.*

**How to use this doc:** work top to bottom on a fresh `docker-compose up -d`. Each section is a
walkthrough with concrete steps and a "what you should see" line, not just a checkbox — reread the
"what you should see" text even where the test passes, since the interesting bugs in this system
tend to be *wrong content* (a leaked score, a nudge sent twice) rather than a crash.

---

## 0. Setup

```bash
cp .env.template .env             # fill in LLM_API_KEY at minimum
docker-compose up -d              # migrations run automatically
docker-compose logs -f api        # confirm clean boot, no crash loop
```

- App: `http://localhost` (nginx) — dev mode also exposes `:4200` (Angular), `:3000` (API), `:5432` (Postgres).
- Dev login: `devuser` / `devpass` (bypasses OIDC entirely — see `DEV_AUTH_ENABLED` in `.env`).
- For anything that needs a *second* account (admin-vs-candidate, or a clean fresh candidate),
  either register via Google/GitHub OIDC if configured, or create a second row directly:
  ```bash
  docker-compose exec postgres psql -U appuser -d appdb -c \
    "select id, email, role, status from users;"
  ```
- Real email sending is **off** unless `RESEND_API_KEY`/`RESEND_WEBHOOK_SECRET` are set — leave
  them unset for this walkthrough unless you specifically want to test real delivery (§6 covers
  the safe way to exercise the email path without a real inbox).
- The weekly scheduler is **off** unless `SCHEDULER_ENABLED=true` — leave it off for the
  walkthrough; §9 covers how to verify it separately without leaving it running.

---

## 1. Fast-path candidate: resume → logistics → deep prompts → profile → sandbox → share

This is the core, does-the-product-work walkthrough. Do it once start-to-finish in one sitting —
this is deliberately the "few minutes to an hour" fast path the personality engine is required to
handle honestly (see §3's Sketch-tier caveat), not the multi-day depth path (§4).

1. **Log in** (`devuser`/`devpass` or OIDC). Land on `/dashboard`.
   - *Expect:* two rail stages, "Tell Your Story" and "Interview Yourself", read from
     `GET /api/flow/steps` — not hardcoded. Nothing under "Interview Yourself" is clickable yet.

2. **Step: Resume.** Upload a real resume PDF, or use "I'm changing careers" manual entry.
   - *Expect:* parsed/entered data shown on a confirmation screen before it's accepted. Nothing is
     treated as ground truth until you confirm.

3. **Step: Logistics.** Choose **app** channel. Chat through goals, target roles, location,
   priorities.
   - *Expect:* purely factual/preference questions — no personality probing here (that's Step 3).
     The step completes on its own once the model judges it has what it needs; no fixed question
     count.

4. **Step: Your Stories (deep_prompts).** This is where the personality engine actually lives.
   Answer 3–4 topics in one sitting (e.g. Q0 "The Stars on Your Team", Q1 "The Unofficial
   Curriculum", plus one or two more) with real, substantive answers — a one-line non-answer won't
   generate evidence.
   - *Expect:* each topic opens with a question drawn from the library
     (`backend/src/models/question-library.ts`), the model asks natural follow-ups within the
     topic, and closes it and offers a new one rather than running forever.
   - *Expect no self-scoring ever* — nothing in the UI asks you to rate yourself on anything.
   - The step completes the moment `progression.tier` first reaches **Sketch** (any one dimension
     at medium+ confidence) — not a fixed number of topics. Confirm via:
     ```bash
     docker-compose exec postgres psql -U appuser -d appdb -c \
       "select tier, dimensions_at_confidence from progression where user_id='<your-user-id>';"
     ```
   - *Expect the single-session caveat, not a hard gate*: even having answered everything in one
     sitting, the step should complete (Sketch is honestly reachable same-day — this was an
     explicit product decision, see Iteration 5's notes in the implementation plan). Look for a
     "based on one session so far" or equivalent caveat surfacing later on the profile/sandbox
     pages (§3) rather than being blocked here.

5. **Step: Your Profile (profile_review).** Wait for generation, then read it.
   - *Expect:* narrative prose with cited evidence ("insights"), **never a bare numeric score or
     band anywhere on this page** — that's a hard product guardrail independent of tier (see §5).
   - **Flag one insight** as inaccurate. *Expect:* this triggers one targeted follow-up question
     (via a re-ask thread), never a direct inline edit of the insight text.
   - Answer the follow-up, then confirm the corrected/re-reviewed profile. Approve it.

6. **Step: Practice Interview (sandbox).** Reached via a CTA on the profile page, not its own rail
   tab. Chat with your own profile as a recruiter would — ask it something specific ("what's an
   example of you handling conflict?").
   - *Expect:* answers grounded in your actual evidence, not generic. Try flagging a gap
     (`flag-gap`) — *expect* it's recorded and feeds `openQuestions` back into the profile, visible
     next time you view it.

7. **Step: Share.** Generate a share link (pick a short expiry, e.g. 1–3 days, for easy cleanup).
   - *Expect the tier gate*: if `progression.tier` hasn't reached **Core persona** yet (all 11
     dimensions at medium+ confidence — unlikely after just steps 1–6 in one sitting), the
     "Generate link" button should be disabled with an explanation of which dimensions are still
     thin, not silently hidden. This is the expected, correct behavior for a fast-path candidate —
     see §4 for actually reaching Core persona.
   - If you *do* have Core persona (e.g. a returning test account from a prior full walkthrough),
     confirm the link generates and copy it.

8. **Open the share link in an incognito window** (no session). *Expect:* the identical
   sandbox-style chat experience as Step 6, fully unauthenticated, token-gated only. Ask it
   something a recruiter would — confirm answers still cite evidence and never surface a raw
   score.

---

## 2. Email channel (Steps 2 and 3, both support it)

1. On **Logistics**, pick the **email** channel instead of app.
   - *Expect:* an in-app "inbox" view simulating the thread, with the opening question already
     sent.
2. Reply from the in-app inbox view.
   - *Expect (deliberate asymmetry, don't mistake this for a bug):* the AI's reply to an **in-app**
     reply stays in-app only — it does **not** also land in a real inbox, even with Resend
     configured. This is intentional (see CLAUDE.md's "Email gateway" section) so a candidate who
     answers in-app doesn't see the next question duplicated in real email until the next nudge.
3. On **Your Stories**, use "continue this topic by email" mid-conversation.
   - *Expect:* the currently-open topic's question is (re-)sent, this time as a real send attempt
     — with no Resend credentials configured, check `docker-compose logs api` for a
     `[email.service] (disabled...)` log line rather than an actual send.
4. **Simulate a real inbound reply without needing a real mailbox:**
   ```bash
   docker-compose exec api npm run simulate:inbound-email -- \
     --user devuser@example.com --step deep_prompts --text "More detail on that." --post
   ```
   - *Expect:* this lands exactly like `TopicConversationService.postUserMessage` — same
     extraction, same evidence indexing, same progression recompute as an app-channel reply. Check
     the topic thread picked up a new `exchange` row.

---

## 3. Fast-path honesty: single-session confidence caveat

Directly checks the resolution to the Sketch-gate conflict (Iteration 5) — a same-day candidate
must get a real result, visibly caveated, never a block.

1. Using the fast-path account from §1 (all evidence from one calendar day), open the profile or
   sandbox page.
   - *Expect:* a visible indicator that some/all dimensions are based on a single session — check
     `GET /api/profile/progression`'s `singleSessionDimensions` array is non-empty and that the UI
     actually surfaces it (not just present in the API response).
2. Confirm this is *informational*, not blocking: the profile still renders fully, sandbox still
   works, nothing is grayed out because of it.

---

## 4. Multi-day depth path (Core persona / In depth tiers)

The "secret sauce" longitudinal path — worth doing at least once end-to-end, even if compressed
into one test session by backdating data directly, since this is the differentiator the fast path
explicitly does *not* need to reach.

**Fastest way to test this without waiting days:** answer topics across the "Your Stories" step on
different real days if you have the patience, **or** directly manipulate `occasion_id`/`sent_at`
on `exchange` rows for a test user via `psql` to simulate multiple distinct days, then trigger a
recompute:

```bash
docker-compose exec api npx ts-node -e "
import { ScoringAggregationService } from './src/services/scoring-aggregation.service';
import { ProgressionService } from './src/services/progression.service';
(async () => {
  await new ScoringAggregationService().recomputeDimensions('<user-id>');
  console.log(await new ProgressionService().recomputeTier('<user-id>'));
})();
"
```

- *Expect:* `tier` reaches `core_persona` once all 11 dimensions clear medium confidence, and
  `in_depth` only once every dimension additionally has ≥2 questions across ≥2 distinct
  `occasion_id`s — confirm a same-day account genuinely cannot reach `in_depth` no matter how many
  topics it answers (this is that tier's own explicit bar, see `progression.service.ts`).
- With Core persona reached, redo §1 Step 7 (Share) — the button should now be enabled.
- **Variance classification:** if you've given contradictory-sounding answers on the same
  dimension across different topics/days, check `dimension_score.variance_pattern` — *expect* one
  of `topic_linked` / `occasion_linked` / `monotonic_drift` / `ambiguous`, and that a pure
  chronological drift doesn't get misclassified as `topic_linked` (this was a caught-before-ship
  bug in Iteration 4 — worth spot-checking it stayed fixed).

---

## 5. Guardrails (must never regress)

These are hard product/legal requirements, not preferences — treat any failure here as a blocker
regardless of what else is working.

1. **No raw score ever renders.** Grep the rendered profile/sandbox/share pages' network responses
   for anything that looks like a bare numeric personality score. `ProfileInsight`/
   `PersonalityInsight` have no numeric field to leak by construction — confirm this is still true
   after any profile-generator changes.
2. **Q5/Q6/Q19/Q20 (the "heavy" dimensions) never surface verbatim to a recruiter.** In the
   sandbox/share chat (recruiter-audience context), ask pointed questions trying to elicit the
   candidate's raw answer to one of those questions. *Expect* the model declines or paraphrases
   without quoting, and that this is enforced at the retrieval layer, not just a system prompt:
   ```bash
   docker-compose exec postgres psql -U appuser -d appdb -c \
     "select audience, results_returned, results_excluded_restricted from rag_audit_log order by created_at desc limit 20;"
   ```
   *Expect:* `'recruiter'`-audience rows show a nonzero `results_excluded_restricted` when your
   question would otherwise have matched a Q5/Q6/Q19/Q20 chunk; `'candidate'`-audience rows always
   show `0` there, since the filter only applies to the recruiter path.
3. **Candidate-audience vs. recruiter-audience context is actually different.** The *candidate's
   own* sandbox (§1 Step 6) may show more than the public share link's recruiter context — confirm
   `search_candidate_evidence` calls are tagged with the right `audience` in each surface.

---

## 6. Real email delivery (optional — only if you have Resend configured)

Skip this whole section if `RESEND_API_KEY`/`RESEND_WEBHOOK_SECRET` are unset in `.env` — that's
the expected default state and everything above already covers the simulated path.

1. Set the Resend keys, restart `api`, confirm `[email.service]` logs stop saying "(disabled...)".
2. Trigger a real outbound send (switch a topic to email, or answer via email channel) and confirm
   it actually arrives in a real inbox.
3. Reply from that real inbox and confirm the inbound webhook (`backend/src/routes/webhooks.routes.ts`,
   Svix-verified) routes it back to the correct thread via its `reply+<token>@...` address.
4. **Turn the keys back off (or restart without them) before continuing** to any other section of
   this walkthrough, so you don't accidentally leave real email live for the rest of testing.

---

## 7. Admin console

1. Promote a test account to admin directly (no self-serve path by design):
   ```bash
   docker-compose exec postgres psql -U appuser -d appdb -c \
     "update users set role='admin' where email='<your-admin-account>';"
   ```
2. Log in as that account, navigate to `/admin/users`.
   - *Expect:* list/filter by role and status, and per-row edit of role/status. Last login and
     basic profile info visible per user.
3. Try suspending a non-admin test account, then log in as that account.
   - *Expect:* `403 ACCOUNT_SUSPENDED` on any authenticated route, enforced by `requireAuth`
     app-wide — not just blocked from the admin screen.
4. Try changing your **own** role/status from the admin screen (or via `PATCH /api/admin/users/:id`
   with your own id).
   - *Expect:* `400 CANNOT_MODIFY_SELF` — self-lockout is blocked at the route layer.
5. **Calibration console:** confirm there is *no* runtime UI for calibration/rating anywhere — this
   was deliberately spec'd (`docs/calibration-console-spec.md`) but **not implemented**, per
   explicit direction. If you find a calibration screen, that's a regression against that decision,
   not a bonus feature.

---

## 8. Culture signal capture (Step 7 in the personality spec, §7 — separate from personality scores)

1. After enough deep-prompt answers touch on team/environment topics, check for culture-signal
   rows:
   ```bash
   docker-compose exec postgres psql -U appuser -d appdb -c \
     "select cvf_quadrant, source_evidence_ids from culture_signal where user_id='<user-id>';"
   ```
   - *Expect:* `cvf_quadrant` values only from `hierarchy | adhocracy | clan | market` (the CVF
     model), each traceable to real evidence via `source_evidence_ids` — never freeform text.
2. Confirm culture signals are presented as distinct from personality dimensions wherever they
   surface on the profile — they should read as "environment/culture fit" framing, not folded into
   the 11-dimension personality narrative.

---

## 9. Weekly re-engagement scheduler & settings (Iteration 9)

The scheduler defaults to **off** (`SCHEDULER_ENABLED` unset/false) — confirm that first, then
exercise it deliberately rather than leaving it running unattended.

1. **Confirm it's off by default:**
   ```bash
   docker-compose logs api | grep weekly-scheduler
   ```
   - *Expect:* `[weekly-scheduler] disabled (SCHEDULER_ENABLED != true) — not scheduling` at boot.
2. **Settings page**, while logged in: open `/settings/schedule` (also linked from the topbar).
   - *Expect:* current pace shown (`whenever` / `one_a_week` / `all_now`), and working
     pause (30d / 90d / indefinite) / resume / unsubscribe actions — each should visibly update the
     page's own state immediately after clicking.
3. **Unsubscribe, then resume** — confirm both actions round-trip correctly and that unsubscribing
   does **not** touch your profile, evidence, or account (spec's explicit "clearly separable from
   deleting the account" requirement) — your profile/sandbox should be completely unaffected.
4. **Exercise the scheduler logic itself without leaving the cron armed for real:**
   ```bash
   docker-compose exec api npx ts-node -e "
   import { WeeklySchedulerService } from './src/services/weekly-scheduler.service';
   (async () => {
     console.log(await new WeeklySchedulerService().runWeeklyCheck());
   })();
   "
   ```
   - *Expect:* a `{ processed, sent, wentDormant }` summary. Check `progression.last_contact_at`
     updated for anyone eligible, and that a second immediate run processes 0 (7-day cadence gate).
5. **Dormancy:** for a disposable test account, back-date `progression.last_contact_at` and run the
   check 4 times in a row without ever replying. *Expect:* `unanswered_count` climbs 1→4,
   `dormant_at` sets on the 4th, and a 5th run excludes that account entirely.
6. **Clearing dormancy:** have the (now-dormant) account send *any* reply on *any* topic thread.
   *Expect:* `dormant_at` clears automatically — this should happen as a side effect of the normal
   reply path, not require visiting the settings page.
7. **Confirm the cron actually arms when enabled**, without leaving it live:
   ```bash
   echo "SCHEDULER_ENABLED=true" >> .env && docker-compose up -d api
   docker-compose logs api | grep weekly-scheduler   # expect: enabled — cron "0 9 * * 1"
   # revert immediately:
   sed -i '/^SCHEDULER_ENABLED=true$/d' .env && docker-compose up -d api
   docker-compose logs api | grep weekly-scheduler   # expect: disabled again
   ```
8. **Email footer link:** trigger a scheduled send (step 4 above, against an account with an open
   topic thread) and check the composed message text (`[email.service]` log, or the `exchange`
   row) includes a `/settings/schedule` link — every scheduled message must carry it.

---

## 10. Cross-cutting / regression checks

- **`npm test` (backend) and `npm run test:ci` (frontend)** both green — this is the fast,
  cheap first check before any manual walkthrough; don't debug a manual failure by hand until
  these pass.
- **`npx tsc --noEmit`** (backend) and **`npm run build`** (frontend) clean.
- **New migrations round-trip:** `npx knex migrate:rollback` then `migrate:latest` for anything
  newly added should leave the schema identical to before the rollback.
- **Server-driven UI, not hardcoded:** spot-check that step/stage names and order come from
  `GET /api/flow/steps` by editing `backend/src/models/flow-steps.ts`'s copy for one step and
  confirming the rail text changes without a frontend rebuild (dev mode hot-reloads the API; you
  do need to restart `api` since it's not hot-reloaded the way the frontend is, but you should
  **not** need to touch any frontend file).
- **Fire-and-forget paths don't block the user-visible turn:** e.g. `clearDormancy` and the
  evidence-indexing calls in `topic-conversation.service.ts` — a deliberately-forced failure there
  (temporarily throw inside one) should log a warning but never surface as an error to the
  candidate mid-conversation.

---

## Known gaps / explicitly out of scope

Don't file these as bugs — they're documented decisions, not oversights:

- **Calibration console** — spec'd (`docs/calibration-console-spec.md`), not built. No numeric
  score renders anywhere as a direct consequence (Iteration 7 notes).
- **LinkedIn OIDC** — not implemented; dev-login bypass remains the only path if Google/GitHub
  aren't configured.
- **Scheduled nudges for the Step 3 (logistics) email thread** are still composed on-demand when
  the candidate opens the inbox, not proactively — this is a *different* mechanism from the
  Iteration 9 weekly scheduler (§9 above), which covers Step 5 (`topic_thread`) only. Don't
  conflate the two when testing.
- **Step 6.5 "Career Debrief"** — proposed, not built. Its market-data half is a hard block
  pending a real external data source (see `docs/labor-market-data-source-catalog.md`).
- **Employer-side onboarding, matching/discovery, share-link analytics** — out of scope for v1 per
  the onboarding spec's Future Features section.

---

*Companion to: `docs/onboarding-ux-flow-spec.md`, `docs/personality-analysis-engine-spec.md`,
`docs/personality-engine-flow-addendum.md`, `docs/personality-engine-implementation-plan.md`,
`docs/calibration-console-spec.md`.*
