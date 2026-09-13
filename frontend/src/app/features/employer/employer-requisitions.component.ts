import { Component, OnInit, signal, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TopbarComponent } from '../../shared/components/topbar/topbar.component';
import { RequisitionService } from '../../core/employer/requisition.service';
import { JobRequisition } from '../../models/requisition.model';

/**
 * Employer-side onboarding Phase 1 (docs/employer-onboarding-spec.md §3) — a requisition list
 * plus "new requisition" form, more like admin-users.component.ts's list-plus-detail pattern than
 * the candidate's linear step rail (this isn't a flow step — flowStages/flow-steps.ts are
 * candidate-only, see CLAUDE.md). Deliberately plain/utilitarian, same reasoning as the admin
 * screens: not part of the candidate-facing "notebook" design system.
 */
@Component({
  selector: 'app-employer-requisitions',
  imports: [TopbarComponent, FormsModule, DatePipe, RouterLink],
  template: `
    <app-topbar />

    <div class="container page">
      <h1>Your requisitions</h1>
      <p class="lede">Post a role, then answer a few questions about it before it goes live.</p>

      <form class="new-form card" (ngSubmit)="create()">
        <span class="eyebrow">New requisition</span>
        <div class="field">
          <label for="title">Title</label>
          <input id="title" type="text" [(ngModel)]="title" name="title" required />
        </div>
        <div class="field">
          <label for="description">Description</label>
          <textarea id="description" [(ngModel)]="description" name="description" rows="3" required></textarea>
        </div>
        <div class="field">
          <label for="requirements">Requirements (optional)</label>
          <textarea id="requirements" [(ngModel)]="requirements" name="requirements" rows="2"></textarea>
        </div>
        <button type="submit" class="btn btn-primary" [disabled]="creating() || !title || !description">
          {{ creating() ? 'Creating…' : 'Create draft' }}
        </button>
        @if (createError()) {
          <p class="error">{{ createError() }}</p>
        }
      </form>

      @if (loadError()) {
        <p class="error">{{ loadError() }}</p>
      }

      <table class="req-table">
        <thead>
          <tr>
            <th>Title</th>
            <th>Status</th>
            <th>Created</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          @for (req of requisitions(); track req.id) {
            <tr>
              <td>{{ req.title }}</td>
              <td><span class="stamp" [class.stamp-brick]="req.status === 'draft'" [class.stamp-brass]="req.status !== 'draft'">{{ req.status }}</span></td>
              <td>{{ req.created_at | date: 'medium' }}</td>
              <td><a class="btn btn-secondary" [routerLink]="['/employer/requisitions', req.id]">View</a></td>
            </tr>
          } @empty {
            <tr>
              <td colspan="4">{{ loading() ? 'Loading…' : 'No requisitions yet.' }}</td>
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [
    `
      .new-form {
        padding: 1rem;
        margin: 1rem 0;
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        max-width: 40rem;
      }

      .req-table {
        width: 100%;
        border-collapse: collapse;
        font-family: var(--font-mono);
        font-size: 0.9rem;
      }

      .req-table th,
      .req-table td {
        text-align: left;
        padding: 0.5rem 0.75rem;
        border-bottom: 1px solid var(--border);
      }

      .error {
        color: var(--brick-strong, #a33);
      }
    `
  ]
})
export class EmployerRequisitionsComponent implements OnInit {
  requisitions = signal<JobRequisition[]>([]);
  loading = signal(false);
  loadError = signal<string | null>(null);

  title = '';
  description = '';
  requirements = '';
  creating = signal(false);
  createError = signal<string | null>(null);

  constructor(private requisitionService: RequisitionService) {}

  ngOnInit(): void {
    this.reload();
  }

  reload(): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.requisitionService.list().subscribe({
      next: ({ requisitions }) => {
        this.requisitions.set(requisitions);
        this.loading.set(false);
      },
      error: () => {
        this.loadError.set('Failed to load requisitions.');
        this.loading.set(false);
      }
    });
  }

  create(): void {
    if (!this.title || !this.description) return;
    this.creating.set(true);
    this.createError.set(null);
    this.requisitionService.create({ title: this.title, description: this.description, requirements: this.requirements || undefined }).subscribe({
      next: () => {
        this.title = '';
        this.description = '';
        this.requirements = '';
        this.creating.set(false);
        this.reload();
      },
      error: (err) => {
        this.creating.set(false);
        this.createError.set(err?.error?.error?.message || 'Failed to create requisition.');
      }
    });
  }
}
