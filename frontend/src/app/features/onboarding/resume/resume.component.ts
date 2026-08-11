import { Component, OnInit, OnDestroy, signal, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ResumeService } from '../../../core/resume/resume.service';
import { Resume, WorkHistoryItem } from '../../../models/resume.model';
import { STEP_ROUTES } from '../../../models/flow.model';
import { StoryTrackerComponent } from '../../../shared/components/story-tracker/story-tracker.component';

@Component({
    selector: 'app-resume-step',
    imports: [FormsModule, RouterLink, StoryTrackerComponent],
    template: `
    <span class="eyebrow">Tell Your Story · Resume</span>
    <h1>Start with your resume — or don't</h1>
    <p class="lede">
      Upload a resume and we'll pull out the basics. No resume handy, or don't want to bother?
      Skip it — the next screen lets you enter or edit your work history by hand either way, so
      nothing here is a dead end. Changing industries or roles? Flip the toggle below; we'll ask
      what you're moving toward instead of trying to reframe what you're moving from.
    </p>

    <app-story-tracker />

    @if (viewingConfirmed()) {
      <div class="card panel confirmed-view">
        <div class="confirmed-header">
          <span class="stamp stamp-brass">Confirmed</span>
          <button type="button" class="btn btn-ghost" (click)="editConfirmed()">Edit</button>
        </div>
        <h3>What we have on file</h3>

        @if (data.summary) {
          <p class="confirmed-summary">{{ data.summary }}</p>
        }

        <div class="confirmed-grid">
          @if (data.contact.email || data.contact.location) {
            <div class="confirmed-field">
              <span class="eyebrow">Contact</span>
              @if (data.contact.email) {
                <p>{{ data.contact.email }}</p>
              }
              @if (data.contact.location) {
                <p>{{ data.contact.location }}</p>
              }
            </div>
          }
          @if (data.skills.length) {
            <div class="confirmed-field">
              <span class="eyebrow">Skills</span>
              <p>{{ data.skills.join(', ') }}</p>
            </div>
          }
          @if (isCareerChanger && data.movingToward) {
            <div class="confirmed-field">
              <span class="eyebrow">Moving toward</span>
              <p>{{ data.movingToward }}</p>
            </div>
          }
        </div>

        @if (data.workHistory.length) {
          <div class="confirmed-jobs">
            <span class="eyebrow">Work history</span>
            @for (job of data.workHistory; track $index) {
              <div class="confirmed-job">
                <strong>{{ job.title || 'Untitled role' }}</strong>
                @if (job.company) {
                  <span class="meta"> · {{ job.company }}</span>
                }
                @if (job.startDate || job.endDate) {
                  <span class="meta job-dates">{{ job.startDate }} – {{ job.endDate }}</span>
                }
              </div>
            }
          </div>
        }

        <div class="next-row cta-row">
          <span class="cta-line" aria-hidden="true"></span>
          <a class="btn btn-primary" [routerLink]="nextRoute">
            Continue to Goals &amp; Logistics
            <svg class="arrow-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M2 8h11M9 4l4 4-4 4" />
            </svg>
          </a>
        </div>
      </div>
    }

    @if (!advanced() && !viewingConfirmed()) {
      <div class="card option upload-card">
        <span class="eyebrow">Upload your resume</span>
        <h3>Add your resume</h3>
        <p class="meta">PDF, DOCX, or plain text. We'll parse it — you'll confirm everything before it counts.</p>

        @if (!resume() && !parsing()) {
          <label class="btn btn-primary file-btn">
            Choose file
            <input type="file" accept=".pdf,.docx,.txt" (change)="onFileSelected($event)" hidden />
          </label>
          <p class="meta optional-note">
            No resume? That's okay — leave this and click Next. You'll get a blank form on the
            next screen to add your work history by hand instead.
          </p>
        }
        @if (parsing()) {
          <div class="parsing-status">
            <span class="spinner" aria-hidden="true"></span>
            <div class="parsing-copy">
              <p class="parsing-line" aria-live="polite">{{ parsingStatus() }}</p>
              <p class="meta parsing-estimate">Usually takes about 10–20 seconds.</p>
            </div>
          </div>
        }
        @if (resume() && !parsing()) {
          <p class="uploaded-line"><span aria-hidden="true">✓</span> Resume uploaded — you'll review it on the next screen.</p>
          <button class="btn btn-ghost" (click)="clearUpload()">Choose a different file</button>
        }
        @if (uploadError()) {
          <p class="error-line">{{ uploadError() }}</p>
        }
      </div>

      <label class="career-toggle">
        <input type="checkbox" class="toggle-input" [(ngModel)]="isCareerChanger" name="careerChanger" />
        <span class="toggle-track" aria-hidden="true"><span class="toggle-thumb"></span></span>
        <span class="toggle-copy">
          <strong>I'm starting or changing careers</strong>
          <span class="meta">We'll ask about transferable skills, your motivation for the change, and what you're moving toward.</span>
        </span>
      </label>

      <div class="next-row cta-row">
        <span class="cta-line" aria-hidden="true"></span>
        <button class="btn btn-primary" (click)="next()" [disabled]="parsing() || advancing()">
          {{ advancing() ? 'Continuing…' : 'Next' }}
          <svg class="arrow-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M2 8h11M9 4l4 4-4 4" />
          </svg>
        </button>
      </div>
    }

    @if (advanced()) {
      <form class="card panel confirm-form" (ngSubmit)="confirm()">
        <div class="confirm-header">
          <span class="eyebrow">{{ resume()?.confirmed ? 'Editing your confirmed resume' : 'Confirm before we go further' }}</span>
          @if (resume()?.confirmed) {
            <button type="button" class="btn btn-ghost" (click)="cancelEdit()">Cancel</button>
          } @else {
            <button type="button" class="btn btn-ghost" (click)="startOver()">Start over</button>
          }
        </div>
        <h3>Does this look right?</h3>

        @if (resume()!.parse_error) {
          <p class="error-line">
            We couldn't auto-parse this file ({{ resume()!.parse_error }}) — fill in what applies
            below, or start over to try a different file.
          </p>
        }

        <div class="field">
          <label for="summary">Summary</label>
          <textarea id="summary" rows="3" [(ngModel)]="data.summary" name="summary"></textarea>
        </div>

        <div class="field-row">
          <div class="field">
            <label for="email">Email</label>
            <input id="email" [(ngModel)]="data.contact.email" name="email" />
          </div>
          <div class="field">
            <label for="location">Location</label>
            <input id="location" [(ngModel)]="data.contact.location" name="location" />
          </div>
        </div>

        <div class="field">
          <label for="skills">Skills (comma separated)</label>
          <input id="skills" [ngModel]="data.skills.join(', ')" (ngModelChange)="setSkills($event)" name="skills" />
        </div>

        <div class="field">
          <label>Work history</label>
          @for (job of data.workHistory; track $index) {
            <div class="job-row">
              <input [(ngModel)]="job.title" [name]="'title' + $index" placeholder="Title" />
              <input [(ngModel)]="job.company" [name]="'company' + $index" placeholder="Company" />
              <input [(ngModel)]="job.startDate" [name]="'start' + $index" placeholder="Start" />
              <input [(ngModel)]="job.endDate" [name]="'end' + $index" placeholder="End (or Present)" />
              <button type="button" class="btn btn-ghost" (click)="removeJob($index)">Remove</button>
            </div>
          }
          <button type="button" class="btn btn-secondary add-job" (click)="addJob()">Add role</button>
        </div>

        @if (isCareerChanger) {
          <div class="field">
            <label for="movingToward">What are you moving toward?</label>
            <input id="movingToward" [(ngModel)]="data.movingToward" name="movingToward" />
          </div>
        }

        <button type="submit" class="btn btn-primary" [disabled]="confirming()">
          {{ confirming() ? 'Saving…' : (resume()?.confirmed ? 'Save changes' : 'Confirm and continue') }}
        </button>
      </form>
    }
  `,
    changeDetection: ChangeDetectionStrategy.Eager,
    styles: [
        `
      .lede {
        color: var(--ink-soft);
        max-width: 42em;
      }

      .upload-card {
        margin-top: 1.5rem;
        padding: 1.5rem;
        display: flex;
        flex-direction: column;
        gap: 0.6rem;
        align-items: flex-start;
      }

      .file-btn {
        cursor: pointer;
      }

      .uploaded-line {
        display: flex;
        align-items: center;
        gap: 0.5em;
        color: var(--sage-strong);
        font-weight: 600;
        margin: 0;
      }

      .parsing-status {
        display: flex;
        align-items: center;
        gap: 0.9rem;
      }

      .spinner {
        flex-shrink: 0;
        width: 1.6rem;
        height: 1.6rem;
        border-radius: 50%;
        border: 3px solid var(--border);
        border-top-color: var(--brass-strong);
        animation: spin 0.8s linear infinite;
      }

      @keyframes spin {
        to {
          transform: rotate(360deg);
        }
      }

      .parsing-copy {
        display: flex;
        flex-direction: column;
        gap: 0.15rem;
      }

      .parsing-line {
        margin: 0;
        font-weight: 600;
        color: var(--ink);
      }

      .parsing-estimate {
        margin: 0;
        font-size: 0.78rem;
      }

      .optional-note {
        margin: 0;
        font-size: 0.82rem;
      }

      .career-toggle {
        display: flex;
        align-items: center;
        gap: 1.1rem;
        margin-top: 1.25rem;
        padding: 1.25rem 1.5rem;
        border: 1px solid var(--border);
        border-radius: var(--radius-lg);
        background: #fff;
        cursor: pointer;
      }

      .toggle-input {
        position: absolute;
        opacity: 0;
        width: 0;
        height: 0;
      }

      .toggle-track {
        flex-shrink: 0;
        width: 3.4rem;
        height: 1.9rem;
        border-radius: 999px;
        background: var(--border);
        position: relative;
        transition: background 0.15s ease;
      }

      .toggle-thumb {
        position: absolute;
        top: 0.2rem;
        left: 0.2rem;
        width: 1.5rem;
        height: 1.5rem;
        border-radius: 50%;
        background: #fff;
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
        transition: transform 0.15s ease;
      }

      .toggle-input:checked + .toggle-track {
        background: var(--brass-strong);
      }

      .toggle-input:checked + .toggle-track .toggle-thumb {
        transform: translateX(1.5rem);
      }

      .toggle-input:focus-visible + .toggle-track {
        outline: 2px solid var(--brass-strong);
        outline-offset: 2px;
      }

      .toggle-copy {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;

        strong {
          font-family: var(--font-display);
          font-size: 1.02rem;
        }
      }

      // Flex/gap and the line itself come from the global .cta-row/.cta-line primitives — this
      // just adds the page-specific spacing above it.
      .next-row {
        margin-top: 1.75rem;
      }

      .panel {
        margin-top: 1.5rem;
        padding: 1.75rem;
      }

      .confirmed-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 0.5rem;
      }

      .confirmed-summary {
        color: var(--ink-soft);
        max-width: 42em;
      }

      .confirmed-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 1.25rem;
        margin-top: 1rem;
      }

      .confirmed-field {
        p {
          margin: 0.2em 0 0;
        }
      }

      .confirmed-jobs {
        margin-top: 1.5rem;
        display: flex;
        flex-direction: column;
        gap: 0.6rem;
      }

      .confirmed-job {
        padding-top: 0.6rem;
        border-top: 1px solid var(--border);

        &:first-of-type {
          border-top: none;
          padding-top: 0.3rem;
        }
      }

      .job-dates {
        display: block;
      }

      .confirm-form {
        display: flex;
        flex-direction: column;
        gap: 1.1rem;
      }

      .confirm-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
      }

      .field-row {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 1rem;
      }

      .job-row {
        display: grid;
        grid-template-columns: 1.2fr 1.2fr 0.7fr 0.7fr auto;
        gap: 0.5rem;
        margin-bottom: 0.5rem;
      }

      .add-job {
        margin-top: 0.25rem;
        align-self: flex-start;
      }

      .error-line {
        color: var(--brick-strong);
        font-size: 0.88rem;
      }

      @media (max-width: 640px) {
        .field-row,
        .job-row {
          grid-template-columns: 1fr;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .spinner {
          animation: none;
        }
      }
    `
    ]
})
export class ResumeStepComponent implements OnInit, OnDestroy {
  resume = signal<Resume | null>(null);
  parsing = signal(false);
  parsingStatus = signal('');
  confirming = signal(false);
  advanced = signal(false);
  // Read-only "here's what we have on file" view for an already-confirmed resume — what the rail
  // now lands on instead of bouncing straight past to Goals & Logistics.
  viewingConfirmed = signal(false);
  advancing = signal(false);
  uploadError = signal('');
  isCareerChanger = false;
  nextRoute = STEP_ROUTES['logistics'];

  data: any = this.blankData();
  // Snapshot taken when entering an edit of an already-confirmed resume, so Cancel can restore it
  // — `data` is the same object reference as the resume record's structured_data, mutated in place
  // by the form's ngModel bindings, so there's nothing to revert to without one.
  private confirmedSnapshot: any = null;

  // Upload+parse happens server-side in one request with no progress events of its own, so this
  // cycles through plausible stages on a timer purely to keep the wait legible — not a readout of
  // real backend phase transitions. The AI parse call dominates the wall-clock time, so the timing
  // here is a rough estimate, not measured telemetry.
  private readonly parsingStages: Array<{ afterMs: number; text: string }> = [
    { afterMs: 0, text: 'Uploading your resume…' },
    { afterMs: 900, text: 'Reading the file…' },
    { afterMs: 2500, text: 'Pulling out your work history…' },
    { afterMs: 6000, text: 'Double-checking the details…' },
    { afterMs: 12000, text: 'Still working — this one is taking a bit longer than usual…' }
  ];
  private parsingTimers: ReturnType<typeof setTimeout>[] = [];

  constructor(private resumeService: ResumeService, private router: Router) {}

  ngOnDestroy(): void {
    this.clearParsingStatus();
  }

  ngOnInit(): void {
    this.resumeService.get().subscribe((resume) => {
      if (resume) {
        this.resume.set(resume);
        this.isCareerChanger = resume.is_career_changer;
        this.data = resume.structured_data || this.blankData();
        if (resume.confirmed) {
          // Previously bounced straight past to Goals & Logistics — but the rail can now land
          // here on purpose (revisiting a completed step), so show what was confirmed instead of
          // routing around it.
          this.viewingConfirmed.set(true);
        } else {
          // Already has a draft in progress from a prior visit — skip straight to the
          // confirm/edit screen instead of re-showing the upload/toggle selection step.
          this.advanced.set(true);
        }
      }
    });
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    this.parsing.set(true);
    this.uploadError.set('');
    this.startParsingStatus();

    this.resumeService.upload(file, this.isCareerChanger).subscribe({
      next: (resume) => {
        this.resume.set(resume);
        this.data = resume.structured_data || this.blankData();
        this.parsing.set(false);
        this.clearParsingStatus();
      },
      error: (err) => {
        this.uploadError.set(err.error?.error?.message || 'Upload failed');
        this.parsing.set(false);
        this.clearParsingStatus();
      }
    });
  }

  /** Kicks off the staged status-message cycle for the duration of the upload+parse request. */
  private startParsingStatus(): void {
    this.clearParsingStatus();
    this.parsingStatus.set(this.parsingStages[0].text);
    this.parsingTimers = this.parsingStages
      .slice(1)
      .map((stage) => setTimeout(() => this.parsingStatus.set(stage.text), stage.afterMs));
  }

  private clearParsingStatus(): void {
    this.parsingTimers.forEach((timer) => clearTimeout(timer));
    this.parsingTimers = [];
  }

  /** Lets the candidate swap files before advancing — the upload card only ever holds one. */
  clearUpload(): void {
    this.resume.set(null);
    this.data = this.blankData();
    this.uploadError.set('');
  }

  /** Backs out of the confirm screen to the upload/toggle selection — most useful when a parse
   *  failed and the candidate wants to try a different file rather than fill everything in by
   *  hand. Purely local state: the next upload or manual-entry call overwrites this user's
   *  resume row in place (see backend ResumeService, onConflict('user_id').merge), so there's
   *  nothing to delete here. */
  startOver(): void {
    this.advanced.set(false);
    this.resume.set(null);
    this.uploadError.set('');
    this.data = this.blankData();
  }

  /** Opens the (already-built) confirm/edit form on top of an already-confirmed resume, so the
   *  rail's read-only "what we have on file" view has a way to make corrections. */
  editConfirmed(): void {
    this.confirmedSnapshot = JSON.parse(JSON.stringify(this.data));
    this.viewingConfirmed.set(false);
    this.advanced.set(true);
  }

  /** Backs out of an edit-of-a-confirmed-resume without saving — restores the snapshot taken in
   *  editConfirmed() since the form's ngModel bindings mutate `data` in place. */
  cancelEdit(): void {
    if (this.confirmedSnapshot) this.data = this.confirmedSnapshot;
    this.advanced.set(false);
    this.viewingConfirmed.set(true);
  }

  /** Commits whichever inputs are set (uploaded resume, and/or the career-changer toggle) and
   *  moves to the confirm/edit screen. No upload yet → falls back to blank manual entry. */
  next(): void {
    if (this.resume()) {
      this.advanced.set(true);
      return;
    }

    this.advancing.set(true);
    this.resumeService.startManualEntry(this.isCareerChanger).subscribe({
      next: (resume) => {
        this.resume.set(resume);
        this.data = resume.structured_data || this.blankData();
        this.advancing.set(false);
        this.advanced.set(true);
      },
      error: (err) => {
        this.uploadError.set(err.error?.error?.message || 'Could not continue — try again.');
        this.advancing.set(false);
      }
    });
  }

  setSkills(value: string): void {
    this.data.skills = value
      .split(',')
      .map((s: string) => s.trim())
      .filter(Boolean);
  }

  addJob(): void {
    const blank: WorkHistoryItem = { company: '', title: '', startDate: '', endDate: '', description: '', highlights: [] };
    this.data.workHistory = [...this.data.workHistory, blank];
  }

  removeJob(index: number): void {
    this.data.workHistory = this.data.workHistory.filter((_: any, i: number) => i !== index);
  }

  confirm(): void {
    this.confirming.set(true);
    // Captured before the request resolves — distinguishes a first-time confirm (advance to the
    // next step, the original behavior) from re-saving an edit to an already-confirmed resume
    // (stay put and return to the read-only view, since the candidate got here on purpose from the
    // rail and pushing them onward would just be the "flips away from what I clicked" bug again).
    const wasAlreadyConfirmed = !!this.resume()?.confirmed;
    this.resumeService.confirm(this.data).subscribe({
      next: (result) => {
        this.resume.set(result.resume);
        this.confirming.set(false);
        if (wasAlreadyConfirmed) {
          this.advanced.set(false);
          this.viewingConfirmed.set(true);
        } else {
          this.router.navigate([STEP_ROUTES['logistics']]);
        }
      },
      error: () => this.confirming.set(false)
    });
  }

  private blankData() {
    return {
      contact: { email: '', phone: '', location: '', linkedin: '' },
      workHistory: [],
      education: [],
      skills: [],
      certifications: [],
      summary: ''
    };
  }
}
