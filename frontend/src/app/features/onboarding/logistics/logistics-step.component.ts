import { Component, OnInit, computed, signal, ChangeDetectionStrategy } from '@angular/core';
import { RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { ChatPanelComponent } from '../../../shared/components/chat-panel/chat-panel.component';
import { AreaTrackerComponent } from './area-tracker/area-tracker.component';
import { AreaListComponent } from './area-tracker/area-list.component';
import { LogisticsService } from '../../../core/logistics/logistics.service';
import { InboxService } from '../../../core/inbox/inbox.service';
import { FlowService } from '../../../core/flow/flow.service';
import { ResumeService } from '../../../core/resume/resume.service';
import { InboxView } from '../../../models/conversation.model';
import { Resume } from '../../../models/resume.model';
import { Channel, STEP_ROUTES } from '../../../models/flow.model';

@Component({
    selector: 'app-logistics-step',
    imports: [ChatPanelComponent, AreaTrackerComponent, AreaListComponent, RouterLink],
    template: `
    <span class="eyebrow">Tell Your Story · Goals &amp; Logistics</span>
    <h1>Goals &amp; logistics</h1>
    <p class="lede">
      Your target roles, location, timeline, and what matters most when you weigh an offer.
      Purely practical — no need to think hard about how to phrase it.
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
      @if (infoAreas().length) {
        <div class="desktop-tracker">
          <span class="eyebrow tracker-label">What we're gathering</span>
          <app-area-tracker [areas]="infoAreas()" [data]="trackerData()" />
        </div>

        <!-- Mobile only (see .mobile-tabs media query) — the glyph row above costs too much
             vertical space to keep on-screen alongside the chat on a small viewport, so it's
             replaced by a tab switcher: the same info lives one tap away instead of always-on. -->
        <div class="mobile-tabs">
          <button type="button" class="tab-btn" [class.tab-btn-active]="activeTab() === 'chat'" (click)="activeTab.set('chat')">
            Chat
          </button>
          <button type="button" class="tab-btn" [class.tab-btn-active]="activeTab() === 'goals'" (click)="activeTab.set('goals')">
            Goals
          </button>
        </div>
      }

      <div class="chat-section" [class.mobile-hide]="infoAreas().length > 0 && activeTab() === 'goals'">
        <div class="conversation-header">
          <span class="stamp" [class.stamp-brass]="channel() === 'app'" [class.stamp-muted]="channel() === 'email'">
            {{ channel() === 'app' ? 'Live chat' : 'By email' }}
          </span>
          <button type="button" class="btn btn-ghost" (click)="openPicker()">Switch channel</button>
        </div>

        @if (channel() === 'app') {
          <div class="chat-frame">
            <app-chat-panel
              step="logistics"
              [infoAreas]="infoAreas()"
              (completeChange)="onAppComplete()"
              (assistantReplied)="refreshKnownData()"
            >
              <a doneAction class="btn btn-secondary" [routerLink]="nextRoute">Continue to your stories</a>
            </app-chat-panel>
          </div>
        }

        @if (channel() === 'email') {
          <div class="chat-frame email-thread">
            <div class="thread">
              @for (message of inbox()?.messages ?? []; track message.id) {
                <div class="chat-bubble" [class.from-user]="message.role === 'user'" [class.from-assistant]="message.role === 'assistant'">
                  {{ message.content }}
                </div>
              }
              @if (!inbox()?.messages?.length) {
                <p class="meta">Sending your first question by email…</p>
              }
            </div>

            @if (inbox()?.thread?.status === 'complete') {
              <div class="completed-banner">
                <span class="stamp stamp-brass">Step complete</span>
                <a class="btn btn-secondary" [routerLink]="nextRoute">Continue to your stories</a>
              </div>
            } @else {
              <div class="email-waiting">
                <span class="stamp stamp-muted">Waiting on your reply</span>
                @if (inbox()?.needsNudge) {
                  <button type="button" class="btn btn-ghost" (click)="requestNudge()">Send a reminder</button>
                }
                <p class="meta">
                  Check your inbox and reply whenever works — we'll pick this back up automatically
                  the next time you're here.
                </p>
              </div>
            }
          </div>
        }
      </div>

      @if (infoAreas().length) {
        <div class="mobile-goals" [class.mobile-goals-active]="activeTab() === 'goals'">
          <app-area-list [areas]="infoAreas()" [data]="trackerData()" />
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

      // Flex/gap and the line come from the global .cta-row/.cta-line primitives — this just adds
      // the page-specific spacing above it.
      .next-row {
        margin-top: 1.75rem;
      }

      .tracker-label {
        display: block;
        margin-top: 1.75rem;
      }

      // Wraps the channel header + whichever chat surface is active so the pair can share one
      // flex:1 budget within .page-col — see onboarding-shell's .page-col for the height chain
      // this depends on. Also the unit that gets hidden behind the "Chat" mobile tab.
      .chat-section {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-height: 0;
      }

      .mobile-tabs,
      .mobile-goals {
        display: none;
      }

      .tab-btn {
        flex: 1;
        padding: 0.55em 1em;
        border-radius: var(--radius-md);
        border: 1px solid var(--border);
        background: #fff;
        color: var(--ink-soft);
        font-family: var(--font-display);
        font-size: 0.88rem;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
      }

      .tab-btn-active {
        background: var(--brass);
        border-color: var(--brass-strong);
        color: var(--ink);
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
        min-height: 420px;
      }

      // The email-active view reuses the same .chat-bubble primitives chat-panel uses, so the
      // conversation reads identically regardless of which channel is currently active — that's
      // the point of unifying this into one "conversation" screen instead of two differently
      // styled views (chat bubbles vs. postal "letters").
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

        // Below the breakpoint the always-on glyph row costs too much of the limited vertical
        // space, so it's swapped for a Chat/Goals tab switcher — see the template comment above
        // .mobile-tabs. Above the breakpoint, .mobile-tabs/.mobile-goals stay display:none and
        // .desktop-tracker/.chat-section are the whole story, same as before this feature.
        .desktop-tracker {
          display: none;
        }

        .mobile-tabs {
          display: flex;
          gap: 0.6rem;
          margin-top: 1.5rem;
        }

        .chat-section.mobile-hide {
          display: none;
        }

        .mobile-goals.mobile-goals-active {
          display: block;
          flex: 1;
          min-height: 0;
          overflow-y: auto;
          margin-top: 1.5rem;
          padding-right: 0.25rem;
        }
      }
    `
    ]
})
export class LogisticsStepComponent implements OnInit {
  // Whether a channel choice has been committed server-side — gates the picker vs. the unified
  // conversation view. A deliberate choice screen rather than an always-visible toggle, per
  // product direction: switching channels should be a purposeful action (via openPicker below),
  // not something that happens on every click of a persistently-shown pair of cards.
  committed = signal(false);
  // Local, pre-commit picker selection — live chat by default. Nothing server-side happens until
  // commitChannel() runs.
  selectedChannel = signal<Channel>('app');
  // The actually-committed, active channel — only meaningful once committed() is true.
  channel = signal<Channel>('app');
  committing = signal(false);

  inbox = signal<InboxView | null>(null);
  // Reactive rather than fetched-once: flow.steps() may still be loading when this component
  // mounts (the shell kicks it off but doesn't wait on it), so deriving from the signal means the
  // tracker appears as soon as the step definitions arrive, whenever that happens to be.
  infoAreas = computed(() => this.flow.steps().find((s) => s.id === 'logistics')?.infoAreas ?? []);
  knownData = signal<Record<string, any>>({});
  // The "Background" area is sourced from the resume record, not chat extraction (see
  // logistics-areas.ts's `source` field) — merged in here rather than living in knownData, since
  // refreshKnownData() re-fetches and replaces knownData wholesale after every turn and resume
  // data doesn't change mid-conversation.
  resumeFilled = signal(false);
  trackerData = computed(() => (this.resumeFilled() ? { ...this.knownData(), resumeBackground: true } : this.knownData()));
  nextRoute = STEP_ROUTES['deep_prompts'];
  // Mobile-only Chat/Goals switcher — see .mobile-tabs. Irrelevant (and its markup CSS-hidden)
  // above the mobile breakpoint, where .desktop-tracker + .chat-section show both at once.
  activeTab = signal<'chat' | 'goals'>('chat');

  constructor(
    private logisticsService: LogisticsService,
    private inboxService: InboxService,
    private flow: FlowService,
    private resumeService: ResumeService
  ) {}

  ngOnInit(): void {
    // logistics_responses has no channel of its own (deliberately — see LogisticsService); the
    // persisted choice lives on flow_progress.logistics_channel, hence loading both here rather
    // than relying on whatever the shell happened to load already (timing isn't guaranteed).
    forkJoin([this.logisticsService.get(), this.flow.loadProgress(), this.resumeService.get()]).subscribe(
      ([logistics, progress, resume]) => {
        if (logistics?.data) this.knownData.set(logistics.data);
        this.resumeFilled.set(this.hasResumeContent(resume));

        const existingChannel = progress.logistics_channel;
        if (existingChannel) {
          // Already chosen on a prior visit — skip straight to the conversation.
          this.channel.set(existingChannel);
          this.selectedChannel.set(existingChannel);
          this.committed.set(true);
          if (existingChannel === 'email') this.loadInbox();
        }
        // Otherwise the picker just sits there with 'app' pre-selected — no auto-start. Making
        // even the default a deliberate click keeps the choice from reading as instant/reversible.
      }
    );
  }

  /** A confirmed-but-blank resume (career-changer/no-resume path) shouldn't count as "filled" —
   *  only real content should light up the glyph. */
  private hasResumeContent(resume: Resume | null): boolean {
    const data = resume?.structured_data;
    if (!data) return false;
    return !!(data.summary?.trim() || data.workHistory?.length);
  }

  /** Re-fetches the merged extraction data so the area tracker reflects the latest turn — called
   *  after every assistant reply on the app channel. */
  refreshKnownData(): void {
    this.logisticsService.get().subscribe((logistics) => {
      if (logistics?.data) this.knownData.set(logistics.data);
    });
  }

  /** Commits the picker's local selection: persists it server-side, then moves into the unified
   *  conversation view. Also how a mid-conversation channel switch resolves — see openPicker(). */
  commitChannel(): void {
    if (this.committing()) return;
    this.committing.set(true);

    this.logisticsService.chooseChannel(this.selectedChannel()).subscribe({
      next: () => {
        // Only now does flow_progress.logistics_channel actually equal the selection server-side
        // — safe to mount the chat panel (which immediately opens a WebSocket the server will
        // reject if that field hasn't caught up yet) or load the inbox.
        this.channel.set(this.selectedChannel());
        this.committing.set(false);
        this.committed.set(true);
        if (this.selectedChannel() === 'email') this.loadInbox();
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

  loadInbox(): void {
    this.inboxService.get().subscribe((view) => this.inbox.set(view));
  }

  requestNudge(): void {
    this.inboxService.requestNudge().subscribe(() => this.loadInbox());
  }

  onAppComplete(): void {
    this.flow.loadProgress().subscribe();
  }
}
