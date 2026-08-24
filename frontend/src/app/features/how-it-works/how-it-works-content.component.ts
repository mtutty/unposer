import { Component, ChangeDetectionStrategy } from '@angular/core';

interface TimelineStop {
  num: string;
  title: string;
  body: string;
  tag: string;
}

const STOPS: TimelineStop[] = [
  {
    num: '01',
    title: 'Tell your story, on your terms',
    tag: 'Chat or email, any hour',
    body:
      "Start with your resume — or a from-scratch entry if you're changing careers — then walk through your goals, target roles, and priorities. Every question here is long-form, not a dropdown: we're building context, not a checklist. Pick live chat or email as you go, and switch whenever it suits you; nothing has to happen in one sitting."
  },
  {
    num: '02',
    title: 'Go deeper, in real conversation',
    tag: 'Chat or email, any hour',
    body:
      'A handful of open-ended "tell me about a time…" conversations surface what a resume never captures: the calls you made under pressure, how you actually work with people, what conditions bring out your best. Answer live or by email, and move any story to the other channel whenever it suits you — the adaptive follow-ups are what get past a rehearsed answer to the real one.'
  },
  {
    num: '03',
    title: 'Review the profile — and correct it',
    tag: 'Flag, never silently rewrite',
    body:
      "The AI drafts a profile from everything you've shared, and every insight in it cites the story it came from — never a bare score. If anything reads wrong, flag it. That never triggers a quiet edit: it triggers one targeted follow-up question, and only your answer changes the record. You approve the final version before it goes anywhere."
  },
  {
    num: '04',
    title: 'Practice on your own twin',
    tag: 'Your sandbox, your pace',
    body:
      "Once you approve it, your profile becomes a live conversation partner you can interview yourself. Ask it the hard questions a recruiter would. If it comes up short on something, flag the gap right there — it feeds straight back into the profile as an open question worth another look."
  },
  {
    num: '05',
    title: 'Share it with confidence',
    tag: 'Time-boxed, on your terms',
    body:
      'When you\'re ready, generate a time-boxed link that gives a recruiter the identical conversation you just had — grounded answers pulled from what you actually said, any hour. By the time anyone books a meeting, the fit has already been tested.'
  }
];

/**
 * The vertical-timeline body shared by the public /how-it-works page and the signed-in "pending
 * approval" waiting page (PendingApprovalComponent) — same content, different chrome around it.
 */
@Component({
  selector: 'app-how-it-works-content',
  template: `
    <div class="timeline">
      @for (stop of stops; track stop.num) {
        <div class="stop">
          <div class="rail">
            <span class="node font-display">{{ stop.num }}</span>
            <span class="line" aria-hidden="true"></span>
          </div>
          <div class="stop-body card">
            <span class="stamp stamp-brass">{{ stop.tag }}</span>
            <h3>{{ stop.title }}</h3>
            <p>{{ stop.body }}</p>
          </div>
        </div>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [
    `
      .timeline {
        display: flex;
        flex-direction: column;
        max-width: 42em;
        margin: 0 auto;
      }

      .stop {
        display: grid;
        grid-template-columns: 3rem 1fr;
        gap: 1.25rem;
      }

      .rail {
        display: flex;
        flex-direction: column;
        align-items: center;
      }

      .node {
        width: 3rem;
        height: 3rem;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--cover);
        color: var(--brass);
        font-size: 0.95rem;
        font-weight: 600;
        flex-shrink: 0;
      }

      .line {
        flex: 1;
        width: 2px;
        background: var(--border);
        margin: 0.35rem 0;
      }

      .stop:last-child .line {
        display: none;
      }

      .stop-body {
        padding: 1.5rem;
        margin-bottom: 1.75rem;
      }

      .stop-body h3 {
        margin: 0.5em 0 0.4em;
      }

      .stop-body p {
        color: var(--ink-soft);
        margin: 0;
        line-height: 1.55;
      }

      @media (max-width: 560px) {
        .stop {
          grid-template-columns: 2.25rem 1fr;
          gap: 0.85rem;
        }

        .node {
          width: 2.25rem;
          height: 2.25rem;
          font-size: 0.8rem;
        }
      }
    `
  ]
})
export class HowItWorksContentComponent {
  stops = STOPS;
}
