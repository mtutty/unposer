import { Component, ElementRef, EventEmitter, Input, OnDestroy, OnInit, Output, signal, ViewChild, ChangeDetectionStrategy } from '@angular/core';

import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { WebSocketService } from '../../../core/websocket/websocket.service';
import { FlowService } from '../../../core/flow/flow.service';
import { Message } from '../../../models/conversation.model';
import { InfoArea } from '../../../models/flow.model';
import { AreaGlyphComponent } from '../area-glyph/area-glyph.component';
import { truncateWords } from '../../utils/text';

interface DisplayMessage {
  kind: 'message';
  id: string;
  role: 'user' | 'assistant';
  content: string;
  pending?: boolean;
}

/** One area's takeaway from a single turn, resolved against the step's known infoAreas. */
interface ExtractionEntry {
  area: InfoArea;
  summary: string;
}

/**
 * A secondary, "thought process"-style log line rendered right before the assistant reply that
 * produced it — surfaces what got extracted that turn without it living inside the main
 * conversation bubble. Only emitted for steps with a known infoAreas list (currently logistics —
 * see ChatPanelComponent.infoAreas) and only for keys that match one of those areas, so freeform
 * extraction on steps without glyphs (deep_prompts) stays silent rather than noisy.
 */
interface ExtractionLogItem {
  kind: 'extraction';
  id: string;
  entries: ExtractionEntry[];
}

type ThreadItem = DisplayMessage | ExtractionLogItem;

/** Live-chat UI shared by the Step 3 (app channel) and Step 5 deep-prompt conversations. */
@Component({
    selector: 'app-chat-panel',
    imports: [FormsModule, AreaGlyphComponent],
    template: `
    <div class="chat">
      <div class="thread" #threadEl>
        @if (connecting()) {
          <p class="meta status-line">Connecting…</p>
        }
        @for (item of items(); track item.id) {
          @if (item.kind === 'extraction') {
            <div class="extraction-log">
              @for (entry of item.entries; track entry.area.id) {
                <div class="extraction-row">
                  <app-area-glyph [areaId]="entry.area.id" [size]="16" class="extraction-glyph" />
                  <span class="extraction-text">{{ entry.area.label }}: {{ entry.summary }}</span>
                </div>
              }
            </div>
          } @else {
            @let old = isOld(item);
            @let expanded = expandedIds().has(item.id);
            <div class="chat-bubble" [class.from-user]="item.role === 'user'" [class.from-assistant]="item.role === 'assistant'">
              <div class="bubble-text" [class.clamped]="old && !expanded">{{ item.content }}</div>
              @if (old) {
                <button type="button" class="expand-toggle" (click)="toggleExpand(item.id)">
                  {{ expanded ? 'Show less' : 'Show more' }}
                </button>
              }
            </div>
          }
        }
        @if (thinking()) {
          <div class="chat-bubble from-assistant thinking">
            <span></span><span></span><span></span>
          </div>
        }
      </div>

      @if (errorMessage()) {
        <p class="error-line">{{ errorMessage() }}</p>
      }

      @if (completed()) {
        <div class="completed-banner">
          <span class="stamp stamp-brass">Step complete</span>
          <ng-content select="[doneAction]"></ng-content>
        </div>
      } @else {
        <form class="composer" (ngSubmit)="send()">
          <textarea
            [(ngModel)]="draft"
            name="draft"
            rows="1"
            placeholder="Write your answer…"
            (keydown.enter)="onEnter($event)"
          ></textarea>
          <button type="submit" class="btn btn-primary" [disabled]="!draft.trim() || thinking()">Send</button>
        </form>
      }
    </div>
  `,
    changeDetection: ChangeDetectionStrategy.Eager,
    styles: [
        `
      // Makes the host itself a shrinkable flex child of whatever frame embeds it (the logistics/
      // deep-prompts .chat-frame), rather than an unsized custom element — without this, .chat's
      // height:100% below has nothing definite to resolve against and the thread can't scroll
      // internally; the page just grows instead. See onboarding-shell's .page-col for the other
      // half of this chain.
      :host {
        display: flex;
        flex: 1;
        min-height: 0;
        // Without this, a flex item's automatic min-width falls back to its content's min-content
        // size — and a nowrap span (or any other unbreakable token) inside .thread would then force
        // this whole host wider instead of wrapping/eliding, blowing the layout out past the page's
        // right edge. See the extraction-log rules below for the case that actually triggered it.
        min-width: 0;
      }

      .chat {
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
        width: 100%;
      }

      .thread {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 0.85rem;
        padding: 0.25rem 0.25rem 1rem;
      }

      .status-line {
        text-align: center;
      }

      // Overrides the .chat-bubble.from-assistant border/background — the pending indicator reads
      // better as three bare dots than as an empty bordered bubble.
      .thinking {
        display: flex;
        gap: 4px;
        align-items: center;
        padding: 0.6em 0.2em;
        border: none;
        background: transparent;

        span {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--pencil);
          animation: pulse 1.1s infinite ease-in-out;
        }

        span:nth-child(2) {
          animation-delay: 0.15s;
        }

        span:nth-child(3) {
          animation-delay: 0.3s;
        }
      }

      @keyframes pulse {
        0%,
        80%,
        100% {
          opacity: 0.25;
        }
        40% {
          opacity: 1;
        }
      }

      // The "thought process" log — deliberately smaller and unbordered so it reads as a trace of
      // what the AI noticed, not another conversation bubble. One row per area it touched this
      // turn, rather than one nowrap/ellipsis line for all of them, so a longer summary wraps in
      // place instead of getting clipped or pushing the layout wider.
      //
      // It's a takeaway from the *candidate's* message, not the assistant's reply that happens to
      // follow it in the DOM, so it's pinned to the right — same side as .chat-bubble.from-user —
      // rather than defaulting to the left where it'd visually read as part of the assistant's
      // side. align-self overrides .thread's default stretch so it shrinks to content width
      // instead of spanning full width with nothing to right-align within.
      .extraction-log {
        display: flex;
        flex-direction: column;
        gap: 0.3em;
        align-self: flex-end;
        max-width: 72%;
        margin: -0.35rem 0.25rem 0;
        padding: 0.1em 0;
        font-family: var(--font-mono);
        font-size: 0.72rem;
        color: var(--pencil);
      }

      .extraction-row {
        display: flex;
        align-items: flex-start;
        gap: 0.4em;
      }

      .extraction-glyph {
        flex-shrink: 0;
        margin-top: 0.1em;
        color: var(--brass-strong);
      }

      .extraction-text {
        min-width: 0;
        overflow-wrap: break-word;
      }

      // Clamps every message except each role's latest to 3 lines, so a long thread stays scannable
      // — the full text is one click away rather than gone.
      .bubble-text.clamped {
        display: -webkit-box;
        -webkit-line-clamp: 3;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }

      .expand-toggle {
        display: block;
        margin-top: 0.35em;
        padding: 0;
        border: none;
        background: none;
        font-family: var(--font-mono);
        font-size: 0.72rem;
        color: inherit;
        opacity: 0.7;
        text-decoration: underline;
        text-underline-offset: 2px;
        cursor: pointer;

        &:hover {
          opacity: 1;
        }
      }

      .error-line {
        color: var(--brick-strong);
        font-size: 0.85rem;
        margin: 0 0 0.5rem;
      }

      .completed-banner {
        display: flex;
        align-items: center;
        gap: 1rem;
        padding-top: 0.75rem;
        border-top: 1px solid var(--border);
      }

      .composer {
        display: flex;
        gap: 0.6rem;
        padding-top: 0.75rem;
        border-top: 1px solid var(--border);
      }

      textarea {
        flex: 1;
        resize: none;
        font-family: var(--font-body);
        font-size: 1rem;
        padding: 0.7em 0.9em;
        border: 1px solid var(--border);
        border-radius: var(--radius-md);
        max-height: 8em;

        &:focus {
          border-color: var(--brass-strong);
        }
      }
    `
    ]
})
export class ChatPanelComponent implements OnInit, OnDestroy {
  @Input({ required: true }) step!: 'logistics' | 'deep_prompts';
  /** Named info areas this step tracks (logistics only — see LogisticsStepComponent). Drives
   *  which extracted keys get a glyph + surfaced as an extraction-log line; steps without a list
   *  (deep_prompts) simply never show one, since freeform extraction there has no fixed vocabulary
   *  to render a glyph for. */
  @Input() infoAreas: InfoArea[] = [];
  @Output() completeChange = new EventEmitter<boolean>();
  /** Fires whenever a new assistant message arrives — lets a parent (e.g. the logistics step's
   *  area tracker) know it's a good time to re-fetch whatever got extracted this turn. */
  @Output() assistantReplied = new EventEmitter<void>();
  @ViewChild('threadEl') threadEl?: ElementRef<HTMLDivElement>;

  items = signal<ThreadItem[]>([]);
  connecting = signal(true);
  thinking = signal(false);
  completed = signal(false);
  errorMessage = signal('');
  draft = '';
  // Messages the candidate has manually expanded past their 3-line clamp — see isOld().
  expandedIds = signal<Set<string>>(new Set());

  private subs: Subscription[] = [];

  constructor(private ws: WebSocketService, private flow: FlowService) {}

  ngOnInit(): void {
    this.ws.connect(this.step);

    this.subs.push(
      this.ws.connected().subscribe((connected) => {
        if (connected) this.connecting.set(false);
      }),

      this.ws.on('chat:message').subscribe((payload: Message) => {
        this.thinking.set(false);

        const entries = payload.role === 'assistant' ? this.resolveExtractionEntries(payload.metadata) : [];
        this.items.update((list) => {
          const next = entries.length ? [...list, { kind: 'extraction' as const, id: `extract-${payload.id}`, entries }] : list;
          return [...next, { kind: 'message' as const, id: payload.id, role: payload.role as 'user' | 'assistant', content: payload.content }];
        });

        this.scrollToBottom();
        if (payload.role === 'assistant') this.assistantReplied.emit();
      }),

      this.ws.on('progress:update').subscribe((progress) => this.flow.setProgress(progress)),

      this.ws.on('step:complete').subscribe(() => {
        this.completed.set(true);
        this.completeChange.emit(true);
      }),

      this.ws.on('error').subscribe((err) => {
        this.thinking.set(false);
        this.errorMessage.set(err.message);
      })
    );
  }

  ngOnDestroy(): void {
    this.subs.forEach((s) => s.unsubscribe());
    this.ws.disconnect();
  }

  /** True for any message other than the single most recent one in the thread — everything else
   *  starts clamped to 3 lines, regardless of which side sent it, so only the last exchange reads
   *  fully open by default. Extraction-log items are skipped when finding "the latest" — they
   *  don't have a role and aren't rendered as a bubble. */
  isOld(message: DisplayMessage): boolean {
    const list = this.items();
    for (let i = list.length - 1; i >= 0; i--) {
      const item = list[i];
      if (item.kind === 'message') return item.id !== message.id;
    }
    return false;
  }

  toggleExpand(id: string): void {
    this.expandedIds.update((set) => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** Resolves a turn's raw `extracted`/metadata object down to the entries worth logging — only
   *  keys that match a known infoArea id get a glyph and a line; anything else (freeform keys on
   *  steps without a fixed area list, or areas with an empty value) is silently dropped. */
  private resolveExtractionEntries(metadata: Record<string, any> | undefined): ExtractionEntry[] {
    if (!metadata || !this.infoAreas.length) return [];

    // 'resume'-sourced areas (e.g. logistics's "Background" glyph) are never chat-extracted — see
    // ConversationService.chatExtractionAreas — so they're excluded here for the same reason.
    return this.infoAreas
      .filter((area) => (area.source ?? 'chat') === 'chat')
      .reduce<ExtractionEntry[]>((entries, area) => {
        const summary = truncateWords(metadata[area.id]);
        if (summary) entries.push({ area, summary });
        return entries;
      }, []);
  }

  onEnter(event: Event): void {
    const keyboardEvent = event as KeyboardEvent;
    if (!keyboardEvent.shiftKey) {
      keyboardEvent.preventDefault();
      this.send();
    }
  }

  send(): void {
    const content = this.draft.trim();
    if (!content) return;

    this.items.update((list) => [...list, { kind: 'message', id: `local-${Date.now()}`, role: 'user', content }]);
    this.draft = '';
    this.errorMessage.set('');
    this.thinking.set(true);
    this.ws.send('chat:message', { content });
    this.scrollToBottom();
  }

  private scrollToBottom(): void {
    queueMicrotask(() => {
      const el = this.threadEl?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }
}
