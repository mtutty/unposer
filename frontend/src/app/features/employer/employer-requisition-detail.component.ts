import { Component, OnInit, signal, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TopbarComponent } from '../../shared/components/topbar/topbar.component';
import { RequisitionService } from '../../core/employer/requisition.service';
import { JobRequisition } from '../../models/requisition.model';

/** Edit one requisition while it's still 'draft' — the server 400s (NOT_DRAFT) once Phase 2's
 *  Q&A (not built yet) flips it 'active', at which point this becomes read-only. See
 *  RequisitionService.update on the backend. */
@Component({
  selector: 'app-employer-requisition-detail',
  imports: [TopbarComponent, FormsModule, DatePipe, RouterLink],
  template: `
    <app-topbar />

    <div class="container page">
      <a routerLink="/employer/requisitions" class="back-link">← All requisitions</a>

      @if (loadError()) {
        <p class="error">{{ loadError() }}</p>
      }

      @if (requisition(); as req) {
        <span class="stamp" [class.stamp-brick]="req.status === 'draft'" [class.stamp-brass]="req.status !== 'draft'">{{ req.status }}</span>
        <p class="meta">Created {{ req.created_at | date: 'medium' }}</p>

        <form class="card edit-form" (ngSubmit)="save()">
          <div class="field">
            <label for="title">Title</label>
            <input id="title" type="text" [(ngModel)]="title" name="title" [disabled]="req.status !== 'draft'" required />
          </div>
          <div class="field">
            <label for="description">Description</label>
            <textarea id="description" [(ngModel)]="description" name="description" rows="4" [disabled]="req.status !== 'draft'" required></textarea>
          </div>
          <div class="field">
            <label for="requirements">Requirements</label>
            <textarea id="requirements" [(ngModel)]="requirements" name="requirements" rows="3" [disabled]="req.status !== 'draft'"></textarea>
          </div>
          @if (req.status === 'draft') {
            <button type="submit" class="btn btn-primary" [disabled]="saving() || !title || !description">
              {{ saving() ? 'Saving…' : 'Save' }}
            </button>
          } @else {
            <p class="meta">This requisition is no longer a draft and can't be edited here.</p>
          }
          @if (saveError()) {
            <p class="error">{{ saveError() }}</p>
          }
        </form>
      } @else if (!loadError()) {
        <p class="meta">Loading…</p>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [
    `
      .back-link {
        display: inline-block;
        margin-bottom: 1rem;
      }

      .edit-form {
        padding: 1rem;
        margin: 1rem 0;
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        max-width: 40rem;
      }

      .error {
        color: var(--brick-strong, #a33);
      }
    `
  ]
})
export class EmployerRequisitionDetailComponent implements OnInit {
  requisition = signal<JobRequisition | null>(null);
  loadError = signal<string | null>(null);
  saving = signal(false);
  saveError = signal<string | null>(null);

  title = '';
  description = '';
  requirements = '';

  constructor(
    private route: ActivatedRoute,
    private requisitionService: RequisitionService
  ) {}

  ngOnInit(): void {
    const id = String(this.route.snapshot.paramMap.get('id'));
    this.requisitionService.get(id).subscribe({
      next: ({ requisition }) => {
        this.requisition.set(requisition);
        this.title = requisition.title;
        this.description = requisition.description;
        this.requirements = requisition.requirements || '';
      },
      error: () => this.loadError.set('Failed to load requisition.')
    });
  }

  save(): void {
    const req = this.requisition();
    if (!req || !this.title || !this.description) return;
    this.saving.set(true);
    this.saveError.set(null);
    this.requisitionService.update(req.id, { title: this.title, description: this.description, requirements: this.requirements }).subscribe({
      next: ({ requisition }) => {
        this.requisition.set(requisition);
        this.saving.set(false);
      },
      error: (err) => {
        this.saving.set(false);
        this.saveError.set(err?.error?.error?.message || 'Save failed.');
      }
    });
  }
}
