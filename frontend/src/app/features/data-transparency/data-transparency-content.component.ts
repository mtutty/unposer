import { Component, ChangeDetectionStrategy } from '@angular/core';

interface FaqItem {
  q: string;
  a: string;
}

interface FaqSection {
  title: string;
  tag: string;
  items: FaqItem[];
}

// Candidate-side only for now — see the component-level comment on DataTransparencyComponent for
// why. Content is drawn from docs/personality-analysis-engine-spec.md and the onboarding flow
// spec; keep it in sync with those when either changes rather than letting this page drift into
// its own account of how the system works.
//
// `a` fields are rendered via [innerHTML] below (one item currently uses a plain <a mailto:>
// link) — safe because this array is static, developer-authored copy, never user input.
const SECTIONS: FaqSection[] = [
  {
    title: 'What we ask, and why',
    tag: 'Inputs',
    items: [
      {
        q: 'What information actually feeds my profile?',
        a: 'Three things: your resume (or a from-scratch entry if you\'re changing careers), your answers about goals/target roles/location/priorities, and a set of open-ended "tell me about a time…" conversations. That\'s the whole input. Nothing is pulled from anywhere else — no social profiles, no public records, no data about you that didn\'t come from you.'
      },
      {
        q: 'Do you ever ask me to rate myself?',
        a: 'No, deliberately, never. There are no sliders, no "rate yourself 1–5," no personality-test-style forced choices anywhere in the product. Every signal we use comes from you describing something real that happened — a decision, a conflict, a mistake, a win — in your own words. Self-ratings are easy to game and easy to get wrong even in good faith (most people are poor judges of their own patterns); a specific story about a specific Tuesday is neither.'
      },
      {
        q: 'Why do some of these conversations take days or weeks instead of five minutes?',
        a: "Because a single sitting bakes in whatever was true that day — a bad night's sleep, a rough meeting an hour earlier — as if it were a permanent trait. Sampling the same topic across separate days cancels that noise out, the same reason a good doctor doesn't diagnose off one blood pressure reading. You set the pace: answer everything today if you want, or let it run one question every few days by chat or email. Either way, we're optimizing for your best answer, not your fastest one."
      }
    ]
  },
  {
    title: 'How an answer becomes an insight',
    tag: 'Method',
    items: [
      {
        q: 'What actually happens to something I write?',
        a: "It's read for specific, quotable evidence — a phrase, a decision, an outcome — not for tone or vocabulary. That evidence is what everything downstream is built from. Every insight that ends up on your profile has to trace back to a real span of your own words; nothing is asserted about you that can't be pointed to in something you actually said."
      },
      {
        q: 'Do you compute a numeric personality score?',
        a: 'Internally, yes — the system tracks how well-evidenced a set of underlying work-style dimensions are, on a continuum rather than a category. Publicly, no number appears anywhere yet: we don\'t consider 0–100 precision meaningful until it\'s been checked against real human raters, and that validation hasn\'t run yet (it needs real usage data we don\'t have at this stage). Until it does, every insight you or a recruiter ever sees is written in plain language and cites the story behind it — never a bare score.'
      },
      {
        q: 'What do the insights on my profile actually look like?',
        a: 'Short, specific, narrative statements — never a label ("you\'re a Driver"), never a single adjective, never unattributed. Some point out something distinctive in how you described a situation; some notice two things about you that are only interesting in combination; some point out a theme showing up across otherwise-unrelated stories; a few are simply your own most telling words, quoted back to you because they said it better than a summary could. Each one names or quotes what it\'s based on.'
      },
      {
        q: 'Could two different people give a similar answer and get a different read?',
        a: 'Yes, and that\'s intentional. The same sentence can mean different things depending on what else you\'ve said — a terse answer from someone who writes tersely everywhere isn\'t treated the same as a terse answer from someone who is usually expansive. We also explicitly instruct the system to ignore vocabulary, phrasing style, non-native English patterns, sentence length, and how much you wrote as signal of anything — those track education and background, not the thing we\'re trying to understand, and treating them as signal would be exactly the kind of bias this product exists to avoid.'
      }
    ]
  },
  {
    title: 'What "done" means',
    tag: 'Progression',
    items: [
      {
        q: 'Is there a percentage or progress bar for my profile?',
        a: "No, and this is a deliberate choice, not a missing feature. What's shown instead is how well-evidenced each area of your profile currently is. That's a meaningfully different thing from \"percent complete\": answering more questions about something already well-covered doesn't move it, only new, specific, situated stories do — and stories spread across separate days count for more than the same volume answered in one sitting."
      },
      {
        q: 'What are the stages I might see referenced?',
        a: 'Loosely: a first sketch once anything has enough evidence to say something real about it; a "core" profile once every area has at least reasonable evidence, which is the point a share link becomes available; a deeper profile once most areas have been sampled more than once, on more than one occasion, which tightens the picture and unlocks a couple of additional insight types; and after that, it\'s open-ended — new questions arrive on whatever cadence you\'ve set, purely as something worth reflecting on, never as unfinished business.'
      }
    ]
  },
  {
    title: 'Correcting the record',
    tag: 'Your control',
    items: [
      {
        q: 'What if the profile gets something wrong?',
        a: 'You flag it. Flagging never triggers a silent edit — it triggers one targeted follow-up question about specifically that insight, and only your answer to that follow-up changes what\'s on your profile. Every correction is kept in a visible log alongside the insight it replaced, so there\'s no quiet rewriting of history, by you or by us.'
      },
      {
        q: 'Do I see my profile before anyone else does?',
        a: 'Always, and this isn\'t adjustable. You review and approve the generated profile before a share link can ever be created, and your resume\'s extracted details similarly need your confirmation before they\'re treated as fact rather than a draft.'
      },
      {
        q: 'Can I delete my data?',
        a: 'Yes. Deleting your account removes your profile and the conversations behind it. A share link you\'ve already sent out stops working the moment it expires (every link is time-boxed by design), and you separately control whether you\'re listed as discoverable to employers at all — off by default, and reversible at any time.'
      }
    ]
  },
  {
    title: 'Who sees what',
    tag: 'Guardrails',
    items: [
      {
        q: 'What does a recruiter actually get?',
        a: "The same kind of conversation you had with your own profile — they can ask it questions and get answers grounded in what you actually said, evidence and all. What they don't get: your literal transcript, a raw score on anything, or a ranking against other candidates. There's no leaderboard in this product, for anyone."
      },
      {
        q: 'Are some of my answers more private than others?',
        a: "Yes. A few of the conversation topics are designed to be candid — about mistakes, setbacks, and pressure — specifically because candor there produces the most honest picture for *you*. Those particular answers are never shown to a recruiter verbatim, in the shared chat or anywhere else. If something in them is genuinely job-relevant, it can inform a general, work-relevant statement about how you handle that kind of situation — never your original words on the subject."
      },
      {
        q: 'Could a recruiter see something like a raw "emotional stability" number?',
        a: "No — some of what we track is explicitly never shown to a recruiter as a number under any circumstances, on the view that a raw score on that kind of dimension invites exactly the wrong kind of snap judgment. Where it matters for fit, it's translated into a plain, work-relevant statement instead — something like \"performs consistently under sustained deadline pressure\" — backed by the same evidence, but framed around the work, not a diagnosis."
      }
    ]
  },
  {
    title: 'What we don\'t publish, and why',
    tag: 'Disclosure policy',
    items: [
      {
        q: 'Why isn\'t this page more specific about exact numbers and rules?',
        a: "This page is public — no login required — on purpose: nothing about how we treat you should depend on whether you've registered. That only works if the line we draw isn't \"hide the mechanism,\" it's \"disclose the mechanism, withhold the answer key.\" So everything about intent and method is here in full: what we look at, what we ignore, why time and specificity matter more than volume, what recruiters never see and why. What's left out is narrowly the stuff whose only function is to be un-gameable *because* it's unpublished — the exact thresholds a rubric uses, and which particular questions are the candid, never-shown-to-recruiters ones. Naming those wouldn't inform you, it would just tell you which topic to answer evasively — and if it did, we'd owe you the fix, not a longer disclaimer."
      },
      {
        q: 'Is that distinction just an excuse to hide things?',
        a: 'It\'s a testable claim, and you\'re welcome to test it: if any answer on this page reads as evasive rather than as "this specific number would only be useful for gaming it," that\'s a bug in the page, not an intentional gap. Want to know more? Email us your questions — <a href="mailto:contact@my.unposer.com">contact@my.unposer.com</a>.'
      }
    ]
  },
  {
    title: 'Can this be gamed?',
    tag: 'Fabrication & fairness',
    items: [
      {
        q: 'Could someone just answer in a way designed to score well?',
        a: 'They could try, but it\'s worth understanding why that\'s harder than it sounds. Nothing here rewards volume — answering more about something already well-covered doesn\'t move it. What actually builds a strong profile is specific, situated, consistent stories across multiple separate days, which means a bad-faith answer has to hold up as a coherent invented history over weeks, not one clever paragraph. That is strictly more effort than describing something that actually happened, which has the built-in advantage of already being consistent.'
      },
      {
        q: 'So it\'s impossible to fake?',
        a: 'No, and we don\'t claim that. Being candid about the limits of this is part of the point of this page. The real defense against fabrication isn\'t that the system can detect a lie — it\'s that every claim on your profile traces back to a specific, quoted thing you said, which makes it checkable. A recruiter\'s reference call or follow-up interview can test a cited story the way it never could test a bare number; that verifiability, not an unbeatable detector, is what keeps this honest.'
      },
      {
        q: 'Does writing more, or writing more impressively, help my profile?',
        a: "No. Vocabulary, sentence length, and how polished an answer sounds are explicitly excluded from what the system reads as signal — see the answer above on bias. A short, plain, specific story outperforms a long, well-written, vague one every time, by design."
      }
    ]
  }
];

/**
 * The Q&A body shared by /how-your-profile-works (public page) — factored out the same way
 * HowItWorksContentComponent is, in case another surface (e.g. a future in-app help panel) wants
 * to reuse it without the page chrome around it.
 */
@Component({
  selector: 'app-data-transparency-content',
  template: `
    <div class="faq">
      @for (section of sections; track section.title) {
        <section class="faq-section">
          <div class="section-head">
            <span class="stamp stamp-brass">{{ section.tag }}</span>
            <h2>{{ section.title }}</h2>
          </div>
          @for (item of section.items; track item.q) {
            <details class="card item">
              <summary>
                <span class="q">{{ item.q }}</span>
                <span class="chevron" aria-hidden="true"></span>
              </summary>
              <p class="a" [innerHTML]="item.a"></p>
            </details>
          }
        </section>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [
    `
      .faq {
        display: flex;
        flex-direction: column;
        gap: 2.5rem;
        max-width: 42em;
        margin: 0 auto;
      }

      .section-head {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 0.5rem;
        margin-bottom: 1rem;
      }

      .section-head h2 {
        margin: 0;
      }

      .item {
        padding: 0;
        margin-bottom: 0.75rem;
        overflow: hidden;
      }

      summary {
        list-style: none;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
        padding: 1rem 1.25rem;
        cursor: pointer;
        font-family: var(--font-display);
        font-weight: 600;
        color: var(--ink);

        &::-webkit-details-marker {
          display: none;
        }

        &:hover .q {
          color: var(--brass-strong);
        }
      }

      .chevron {
        flex-shrink: 0;
        width: 0.6em;
        height: 0.6em;
        border-right: 2px solid var(--pencil);
        border-bottom: 2px solid var(--pencil);
        transform: rotate(45deg);
        transition: transform 0.15s ease;
      }

      details[open] .chevron {
        transform: rotate(-135deg);
      }

      .a {
        margin: 0;
        padding: 0 1.25rem 1.25rem;
        color: var(--ink-soft);
        line-height: 1.6;

        a {
          color: var(--brass-strong);
        }
      }

      @media (max-width: 560px) {
        summary {
          padding: 0.85rem 1rem;
        }

        .a {
          padding: 0 1rem 1rem;
        }
      }
    `
  ]
})
export class DataTransparencyContentComponent {
  sections = SECTIONS;
}
