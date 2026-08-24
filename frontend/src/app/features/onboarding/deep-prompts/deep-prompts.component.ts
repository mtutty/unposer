import { Component, OnInit, computed, signal, ChangeDetectionStrategy } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ChatPanelComponent } from '../../../shared/components/chat-panel/chat-panel.component';
import { StoryTrackerComponent } from '../../../shared/components/story-tracker/story-tracker.component';
import { FlowService } from '../../../core/flow/flow.service';
import { DeepPromptsService, DeepPromptsThreadView } from '../../../core/deep-prompts/deep-prompts.service';
import { Channel, STEP_ROUTES } from '../../../models/flow.model';

@Component({
  selector: 'app-deep-prompts-step',
  imports: [ChatPanelComponent, StoryTrackerComponent, RouterLink],
  template: `
    <span class="eyebrow">Tell Your Story · Your Stories</span>
    <h1>Your stories</h1>
    <p class="lede">
      A few open-ended questions — tell me about times things happened, not how you'd rate
      yourself. The stories carry the signal; there's nothing to score.
    </p>

    @if (!committed()) {
      <div class="choice-grid">
        <button
          type="button"
          class="card option"
          [class.option-selected]="selectedChannel() === 'app'"
          (click)="selectedChannel.set('app')"
        >
          @if (selectedChannel() === 'app') {
            <span class="option-check" aria-hidden="true">✓</span>
          }
          <span class="eyebrow">Live chat</span>
          <h3>Answer now</h3>
          <p class="meta">A quick back-and-forth, right here.</p>
        </button>
        <button
          type="button"
          class="card option"
          [class.option-selected]="selectedChannel() === 'email'"
          (click)="selectedChannel.set('email')"
        >
          @if (selectedChannel() === 'email') {
            <span class="option-check" aria-hidden="true">✓</span>
          }
          <span class="eyebrow">By email</span>
          <h3>Answer when it's convenient</h3>
          <p class="meta">We'll send questions to your inbox and pick this back up whenever you reply.</p>
        </button>
      </div>

      <div class="next-row cta-row">
        <span class="cta-line" aria-hidden="true"></span>
        <button class="btn btn-primary" (click)="commitChannel()" [disabled]="committing()">
          {{ committing() ? 'Starting…' : 'Continue' }}
          <svg class="arrow-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M2 8h11M9 4l4 4-4 4" />
          </svg>
        </button>
      </div>
    }

    @if (committed()) {
      <app-story-tracker />

      <div class="conversation-header">
        <span class="stamp" [class.stamp-brass]="channel() === 'app'" [class.stamp-muted]="channel() === 'email'">
          {{ channel() === 'app' ? 'Live chat' : 'By email' }}
        </span>
        <button type="button" class="btn btn-ghost" (click)="openPicker()">Switch channel</button>
      </div>

      @if (channel() === 'app') {
        <div class="chat-frame">
          <app-chat-panel step="deep_prompts" (completeChange)="onComplete()">
            <a doneAction class="btn btn-secondary" [routerLink]="nextRoute">Review your profile</a>
          </app-chat-panel>
        </div>
      }

      @if (channel() === 'email') {
        <div class="chat-frame email-thread">
          <div class="thread">
            @for (message of thread()?.messages ?? []; track message.id) {
              <div class="chat-bubble" [class.from-user]="message.role === 'user'" [class.from-assistant]="message.role === 'assistant'">
                {{ message.content }}
              </div>
            }
            @if (!thread()?.messages?.length) {
              <p class="meta">Sending your first question by email…</p>
            }
          </div>

          @if (stepComplete()) {
            <div class="completed-banner">
              <span class="stamp stamp-brass">Step complete</span>
              <a class="btn btn-secondary" [routerLink]="nextRoute">Review your profile</a>
            </div>
          } @else {
            <div class="email-waiting">
              <span class="stamp stamp-muted">Waiting on your reply</span>
              <p class="meta">
                Check your inbox and reply whenever works — we'll pick this back up automatically
                the next time you're here.
              </p>
            </div>
          }
        </div>
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [
    `
      .lede {
        color: var(--ink-soft);
        max-width: 42em;
      }

      .choice-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 1.25rem;
        margin-top: 1.5rem;
      }

      .option {
        position: relative;
        padding: 1.5rem;
        text-align: left;
        cursor: pointer;
        border: 1px solid var(--border);
        background: #fff;
        display: flex;
        flex-direction: column;
        gap: 0.4rem;
        transition: border-color 0.15s ease, box-shadow 0.15s ease;

        &:hover {
          border-color: var(--brass-strong);
        }

        &.option-selected {
          border-color: var(--brass-strong);
          box-shadow: 0 0 0 2px rgba(169, 128, 63, 0.18);
        }
      }

      .option-check {
        position: absolute;
        top: 0.85rem;
        right: 0.85rem;
        width: 1.6rem;
        height: 1.6rem;
        border-radius: 50%;
        background: var(--brass);
        color: var(--ink);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 0.85rem;
        font-weight: 700;
        transform: rotate(-6deg);
      }

      .next-row {
        margin-top: 1.75rem;
      }

      .conversation-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-top: 1.75rem;
      }

      .chat-frame {
        margin-top: 1.5rem;
        padding: 1.5rem;
        flex: 1;
        display: flex;
        min-height: 460px;
      }

      // Reuses the same .chat-bubble primitives chat-panel uses — see logistics-step.component.ts,
      // this is the same pattern, deep_prompts just has no nudge affordance of its own.
      .email-thread {
        flex-direction: column;
        overflow-y: auto;
      }

      .thread {
        display: flex;
        flex-direction: column;
        gap: 1rem;
        margin-bottom: 1.25rem;
      }

      .completed-banner {
        display: flex;
        align-items: center;
        gap: 1rem;
        padding-top: 1rem;
        border-top: 1px solid var(--border);
      }

      .email-waiting {
        display: flex;
        flex-direction: column;
        gap: 0.6rem;
        align-items: flex-start;
        padding-top: 1rem;
        border-top: 1px solid var(--border);
      }

      .email-waiting .meta {
        max-width: 34em;
      }

      @media (max-width: 640px) {
        .choice-grid {
          grid-template-columns: 1fr;
        }
      }
    `
  ]
})
export class DeepPromptsStepComponent implements OnInit {
  // Same picker/committed pattern as LogisticsStepComponent — see its comments for the rationale
  // (a deliberate choice screen, not an always-visible toggle).
  committed = signal(false);
  selectedChannel = signal<Channel>('app');
  channel = signal<Channel>('app');
  committing = signal(false);

  thread = signal<DeepPromptsThreadView | null>(null);
  // Step 5 completes when progression.tier first reaches Sketch (flow addendum §2), not from
  // thread status — so this reads flow_progress.steps_state directly, refreshed alongside the
  // thread view rather than from the WebSocket completion event the app channel gets for free.
  stepComplete = computed(() => this.flow.progress()?.steps_state?.['deep_prompts'] === 'complete');

  nextRoute = STEP_ROUTES['profile_review'];

  constructor(private flow: FlowService, private deepPrompts: DeepPromptsService) {}

  ngOnInit(): void {
    this.flow.loadProgress().subscribe((progress) => {
      const existingChannel = progress.deep_prompts_channel;
      if (existingChannel) {
        this.channel.set(existingChannel);
        this.selectedChannel.set(existingChannel);
        this.committed.set(true);
        if (existingChannel === 'email') this.loadThread();
      }
    });
  }

  /** Commits the picker's local selection: persists it server-side, then moves into the unified
   *  conversation view. Also how a mid-conversation channel switch resolves — see openPicker(). */
  commitChannel(): void {
    if (this.committing()) return;
    this.committing.set(true);

    this.deepPrompts.chooseChannel(this.selectedChannel()).subscribe({
      next: () => {
        this.channel.set(this.selectedChannel());
        this.committing.set(false);
        this.committed.set(true);
        if (this.selectedChannel() === 'email') this.loadThread();
      },
      error: () => this.committing.set(false)
    });
  }

  /** Backs out to the picker to make a different (deliberate) channel choice — pre-selects
   *  whatever's currently active, so re-confirming the same channel is just one click away. */
  openPicker(): void {
    this.selectedChannel.set(this.channel());
    this.committed.set(false);
  }

  loadThread(): void {
    this.deepPrompts.get().subscribe((view) => this.thread.set(view));
    this.flow.loadProgress().subscribe();
  }

  onComplete(): void {
    this.flow.loadProgress().subscribe();
  }
}
