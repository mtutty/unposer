# Product Walkthrough — Screens & Flow

*A guided tour for anyone getting oriented on the product: what screen you're on, what it's for,
what you do there, and where it sends you next. This is the "show me around" companion to
`docs/system-test-plan.md` (which is written for verifying things work) and
`docs/onboarding-ux-flow-spec.md` (which is the locked design spec) — read this one first if
you're new.*

There are three people who use this product, and each has their own small set of screens:

| Who | What they're doing | Screens |
|---|---|---|
| **Candidate** | Builds their career profile through a guided conversation | Login → Dashboard → the 6-step flow below |
| **Recruiter** | Reads a candidate's profile and chats with it | One screen — the public share link |
| **Admin** | Manages accounts | One screen — `/admin/users` |

The candidate journey is the bulk of the product and the bulk of this doc. It's presented as **two
stages** in the UI ("Tell Your Story" and "Interview Yourself"), covering **six steps** total, plus
one settings screen a candidate returns to over time as the system keeps checking in with them.

---

## 1. Before login: Splash and Login

**Splash (`/`)** — what an unauthenticated visitor sees. Marketing framing: "The real you.
Unposed." Explains the pitch in three cards ("Share your story," "Go deeper," "Review & share")
before a sign-in call to action. If you're already logged in, you skip straight past this to the
Dashboard.

**Login (`/login`)** — "Continue with Google" / "Continue with GitHub" buttons (whichever OIDC
providers are configured), or the dev-only `devuser`/`devpass` bypass. LinkedIn isn't wired up yet.
A failed OAuth attempt lands back here with a plain-English reason ("Sign-in was cancelled," "Your
sign-in session expired").

---

## 2. Dashboard (`/dashboard`) — home base

This is the screen a candidate returns to every time they log back in. It shows the two-stage rail:

```
 ┌─ Tell Your Story ──────────────────────┐   ┌─ Interview Yourself ──────────┐
 │  ● Resume        ● Logistics   ○ Stories │ → │  ○ Your Profile                │
 └─────────────────────────────────────────┘   └─────────────────────────────────┘
```

Each stage is a card showing its steps as small numbered bubbles (done / in-progress / not yet),
plus a "Continue: <step name>" button that jumps straight to wherever the candidate left off.
"Interview Yourself" stays locked-looking until "Tell Your Story" is complete — practice interview
and share aren't their own rail entries at all; they're reached from inside the profile screen once
it's approved (see §7–8).

**Nothing on this page is hardcoded** — it's rendered entirely from what the server reports as the
current steps/stages, so the exact wording and step list can change without a frontend change.

---

## 3. Step 1 — Resume (`/onboarding/resume`)

*"Start with your resume — or don't."*

Two paths:
- **Upload a resume file.** It gets parsed automatically — contact info, skills, "moving toward"
  (career direction), and work history all show up in a review card.
- **"I'm changing careers" / no resume.** Manual entry instead, same fields.

Either way, nothing is used downstream until the candidate hits **"Does this look right?"** and
confirms it. This confirm screen exists specifically so a bad parse never gets silently treated as
truth.

---

## 4. Step 2 — Goals & Logistics (`/onboarding/logistics`)

*"Goals & logistics."*

First decision point: **live chat now**, or **answer by email when it's convenient**. This is a
real fork — email isn't a fallback, it's an equally-supported first-class option, and it comes back
throughout the flow.

Below the channel picker sits a small **tracker** ("What we're gathering") that fills in as the
conversation covers each area — career goals, target roles/industries, location or remote
preference, current search status, and top priorities (comp vs. growth vs. stability). This step is
purely factual — it never probes personality, that's the next step's job.

- **Chose live chat:** a chat panel opens right there on the page.
- **Chose email:** an in-app "inbox" view opens instead, showing the same conversation as a thread
  of real-looking email messages. Replying here keeps the conversation in-app; if the candidate
  instead replies from their *actual* email inbox, that also works — see §10.

The step completes itself once the model judges it has enough — there's no fixed question count.

---

## 5. Step 3 — Your Stories (`/onboarding/deep-prompts`)

*"A few open-ended questions — tell me about times things happened, not how you'd rate yourself."*

This is where the personality/work-style engine actually runs. It's structured as a series of
**topics** — "The Stars on Your Team," "The Unofficial Curriculum," "The Breaking Point," and so
on — each a "tell me about a time..." style open-ended question, followed by natural follow-ups
within that topic. The system picks which topic comes next based on what it still needs to learn,
not a fixed script.

- A **"Continue this by email instead"** button lets the candidate move the *current* topic to
  email mid-conversation without losing their place.
- There is **no self-rating anywhere** — no sliders, no "rate yourself 1-5." The stories themselves
  are the signal.
- The step completes the moment the system has learned *enough* about the candidate to produce a
  first real (if early) read — it's entirely possible to finish this step in one sitting. When that
  happens, later screens (§7, §8) will visibly flag that the read is based on one session so far,
  rather than blocking the candidate from moving on. The "unfair advantage" version of this profile
  comes from answering more, on different days, over time — but that depth is a bonus the system
  earns, never a gate the candidate has to clear.

Once through, a **"Review your profile"** button appears.

---

## 6. Step 4 — Your Profile (`/onboarding/profile`)

*"Your profile."*

The generated profile: a headline, a set of **insights** ("What we picked up on") each written as a
plain-English statement with the actual quote/story it came from underneath it, and a "Work style &
goals" section (preferred environment, team dynamics, communication style, short/long-term goals,
ideal next role).

Two things never appear here, by design: a numeric score, or a self-rating. Every claim traces back
to something the candidate actually said.

**"Not quite right"** sits under each insight. Clicking it doesn't let the candidate edit the text
directly — instead it sends one targeted follow-up question back into the Step 3 chat, and a banner
appears here pointing the candidate to go answer it. This keeps every insight tied to something the
candidate actually said, even the corrections.

Once satisfied, **"Approve this profile"** unlocks two new buttons that weren't there before:
**"Try the practice interview"** and **"Get your share link"** — this is the moment "Interview
Yourself" stops being locked.

---

## 7. Practice Interview (`/onboarding/sandbox`)

*"Ask your profile the way a recruiter would."*

A chat interface where the candidate interviews their *own* profile — asking it questions the way a
recruiter would, and seeing how it answers. If an answer falls short, there's a **flag** action that
turns that gap into an "open question," which loops back and shows up on the profile screen (§6) —
another way corrections happen without hand-editing anything.

A banner up top nudges the candidate to keep going if their profile is still thin or based on one
sitting — "Answer one more question" links straight back to Step 3.

This screen isn't a rail tab; it's reached only via the "Try the practice interview" button that
appeared after approving the profile.

---

## 8. Share (`/onboarding/share`)

*"Share with recruiters."*

Generates a **time-boxed link** (candidate picks the expiry, up to 60 days) that gives anyone
holding it the exact same chat experience as the practice interview above — except this time it's
being asked by a real recruiter, not the candidate themselves.

One gate here: the button is disabled until the profile has reached enough depth across enough of
its dimensions (the system explains which ones are still thin if so). This is the one place in the
whole flow where the system says "not yet" instead of just showing a caveat — because this is the
point the candidate is handing the profile to someone else's judgment, not just their own.

Also not a rail tab — reached from the profile screen the same way the practice interview is.

---

## 9. The recruiter's screen — Public Share (`/shared/:token`)

The only screen a recruiter ever sees. No login, no account — just the link. It opens straight into
the same style of chat as the candidate's own practice interview, answering questions about the
candidate grounded in their actual stories. A few things are deliberately different behind the
scenes even though the screen looks the same: the most sensitive stories the candidate shared are
never quoted back verbatim here, even if the recruiter asks directly for them — that's a hard rule,
not something the chat can be talked out of.

---

## 10. The "answer by email" experience, wherever it shows up

Two steps (Goals & Logistics, Your Stories) let a candidate answer by real email instead of
in-app chat. When that's chosen:

- The system sends a real email with the next question.
- The candidate can reply from their actual inbox, and that reply comes right back into the same
  conversation the in-app screens show — no separate "email version" of anything.
- If a candidate replies from the **in-app inbox view** instead of their real email client, the
  system's next question stays in-app only, rather than *also* landing in their real inbox — so
  someone who's engaging in-app doesn't get a duplicate copy of every question by email too.

---

## 11. Check-in settings (`/settings/schedule`)

The one screen that exists for the *ongoing* relationship after onboarding, not a step in the
6-step flow. Reachable any time from the top bar ("Check-in settings"), and every weekly check-in
email links straight back to it too.

What's there:
- **Pace** — Whenever / One a week / All at once — how eager the candidate is about further
  check-ins.
- **Pause** — 30 days, 90 days, or indefinitely. Resumable any time with nothing lost.
- **Unsubscribe** — stops check-ins for good, clearly separate from deleting anything: the profile,
  account, and everything already shared stay exactly as they are.

Once a candidate has moved past their first sitting, the system checks in about once a week with
either a new topic or a nudge to finish one left open — this is the "unfair advantage" longitudinal
depth mentioned in Step 3, delivered proactively instead of waiting for the candidate to come back
on their own. Four unanswered check-ins in a row and it backs off automatically (marked "dormant")
rather than pestering — replying to *any* past message brings it right back with no extra steps.

---

## 12. The admin screen (`/admin/users`)

The only screen an admin sees, and the only place account management happens — there's no
self-serve path to becoming an admin. From here: search/filter the user list by role or status,
and per-user, change their role (user/admin) or status (active/suspended). Last login and basic
profile info show alongside each row. An admin can't change their *own* role or status from here —
that has to come from a different admin account, so nobody can accidentally lock themselves out.

There's a designed-but-not-built **calibration console** (for eventually reviewing/rating how well
the system's scoring matches reality) — if you're looking for it and don't find it, that's expected
for now, not a bug.

---

## Putting it together: the whole candidate path, start to finish

```
Splash/Login
     │
     ▼
Dashboard  ───────────────────────────────────────────────────────────┐
     │                                                                 │
     ▼                                                                 │
┌─ Tell Your Story ─────────────────────────────────────┐              │
│  1. Resume  →  2. Goals & Logistics  →  3. Your Stories │              │
│     (upload/       (chat or email)        (topic-based    │              │
│      manual)                               chat/email)   │              │
└──────────────────────────┬────────────────────────────┘              │
                            ▼                                          │
┌─ Interview Yourself ──────────────────────────────────┐              │
│  4. Your Profile  →  [approve]  →  Practice Interview  │              │
│     (review, flag        │             (own sandbox,   │              │
│      insights)           │              flag gaps)     │              │
│                          └──────────→  Share            │              │
│                                        (time-boxed link) │              │
└─────────────────────────────────────────────────────────┘              │
                                                                          │
     Ongoing, any time after Step 3 finishes: weekly check-in email  ◄───┘
     ("New topic / continue an open one / offer to wrap one up")
     → links to Check-in Settings (pace / pause / unsubscribe)
```

Two other, entirely separate journeys sit alongside this: a **recruiter** who receives a share link
never sees any of the above, just the one chat screen (§9); an **admin** never sees any of the
above either, just the user-management screen (§12).

---

## A few terms worth knowing

- **Dimension** — one of 11 measurable facets of how someone works (e.g. how they handle conflict,
  how detail-oriented they are). Never shown as a number to anyone, ever — only as narrative.
- **Insight** — a plain-English statement on the profile screen, always paired with the real quote
  or story it came from.
- **Tier** — how much confidence the system has earned across those 11 dimensions so far: *none →
  Sketch → Core persona → In depth → Ongoing*. Sketch is reachable in one sitting; In depth requires
  evidence spread across multiple separate days, on purpose — that's the part a one-time
  conversation genuinely can't fake.
- **Occasion** — a distinct calendar day of conversation. The system explicitly tracks whether
  evidence came from one sitting or several, since that distinction is the whole point of the
  longer-term depth this product is built around.

---

*Companion to: `docs/onboarding-ux-flow-spec.md` (locked design spec),
`docs/personality-analysis-engine-spec.md` and `docs/personality-engine-flow-addendum.md` (how the
depth/tier system actually works under the hood), `docs/system-test-plan.md` (verification-oriented
version of this same tour).*
