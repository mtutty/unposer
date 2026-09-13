import { Component, OnInit, signal, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TopbarComponent } from '../../shared/components/topbar/topbar.component';
import { CandidateSearchResult, CandidateSearchService, RemotePreference } from '../../core/employer/candidate-search.service';

const PAGE_SIZE = 25;

/**
 * Employer onboarding Phase 3 (docs/employer-onboarding-spec.md §5) — "basic search on common
 * commodity filters," nothing more: role/location substring filters plus a remote-preference
 * dropdown, a paginated result list. No candidate detail view or contact mechanism here on
 * purpose — that's Phase 4's job ("an authenticated, persisted version of today's anonymous
 * public share-link chat"), not this one. Deliberately plain/utilitarian, same reasoning as
 * employer-requisitions.component.ts: not part of the candidate-facing "notebook" design system.
 */
@Component({
  selector: 'app-candidate-search',
  imports: [TopbarComponent, FormsModule],
  template: `
    <app-topbar />

    <div class="container page">
      <h1>Search candidates</h1>
      <p class="lede">
        Only candidates who've opted in to being discoverable show up here — see a role,
        location, and remote preference, nothing more, until Phase 4's interview step.
      </p>

      <form class="card filters" (ngSubmit)="search()">
        <div class="field">
          <label for="role">Target role</label>
          <input id="role" type="text" [(ngModel)]="role" name="role" placeholder="e.g. backend engineer" />
        </div>
        <div class="field">
          <label for="location">Location</label>
          <input id="location" type="text" [(ngModel)]="location" name="location" placeholder="e.g. Austin" />
        </div>
        <div class="field">
          <label for="remote">Remote preference</label>
          <select id="remote" [(ngModel)]="remote" name="remote">
            <option [ngValue]="undefined">Any</option>
            <option value="remote">Remote</option>
            <option value="hybrid">Hybrid</option>
            <option value="onsite">Onsite</option>
          </select>
        </div>
        <button type="submit" class="btn btn-primary" [disabled]="loading()">
          {{ loading() ? 'Searching…' : 'Search' }}
        </button>
      </form>

      @if (loadError()) {
        <p class="error">{{ loadError() }}</p>
      }

      <div class="table-scroll">
        <table class="result-table">
          <thead>
            <tr>
              <th>Headline</th>
              <th>Target role</th>
              <th>Location</th>
              <th>Remote</th>
            </tr>
          </thead>
          <tbody>
            @for (result of results(); track result.userId) {
              <tr>
                <td>{{ result.headline || '—' }}</td>
                <td>{{ result.role || '—' }}</td>
                <td>{{ result.location || '—' }}</td>
                <td>{{ result.remote || '—' }}</td>
              </tr>
            } @empty {
              <tr>
                <td colspan="4">{{ loading() ? 'Searching…' : 'No discoverable candidates match these filters.' }}</td>
              </tr>
            }
          </tbody>
        </table>
      </div>

      @if (total() > 0) {
        <div class="pager">
          <p class="meta">{{ pagerLabel() }}</p>
          <div class="pager-buttons">
            <button type="button" class="btn btn-secondary" [disabled]="offset === 0 || loading()" (click)="prevPage()">Previous</button>
            <button type="button" class="btn btn-secondary" [disabled]="!hasMore() || loading()" (click)="nextPage()">Next</button>
          </div>
        </div>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [
    `
      .lede {
        color: var(--ink-soft, #4a443c);
        max-width: 48em;
      }

      .filters {
        display: flex;
        gap: 1rem;
        flex-wrap: wrap;
        align-items: flex-end;
        padding: 1rem;
        margin: 1rem 0;
      }

      .filters .field {
        min-width: 12rem;
      }

      .error {
        color: var(--brick-strong, #a33);
      }

      // Same reasoning as admin-users.component.ts's .table-scroll — a 4-column table is more
      // than a phone screen holds; this is the table's own scroll region rather than forcing the
      // whole page wider.
      .table-scroll {
        overflow-x: auto;
      }

      .result-table {
        width: 100%;
        min-width: 480px;
        border-collapse: collapse;
        font-family: var(--font-mono);
        font-size: 0.9rem;
      }

      .result-table th,
      .result-table td {
        text-align: left;
        padding: 0.5rem 0.75rem;
        border-bottom: 1px solid var(--border);
      }

      .pager {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 0.75rem;
        margin-top: 1rem;
      }

      .pager-buttons {
        display: flex;
        gap: 0.6rem;
      }
    `
  ]
})
export class CandidateSearchComponent implements OnInit {
  role = '';
  location = '';
  remote: RemotePreference | undefined;

  results = signal<CandidateSearchResult[]>([]);
  total = signal(0);
  loading = signal(false);
  loadError = signal<string | null>(null);
  offset = 0;

  constructor(private candidateSearch: CandidateSearchService) {}

  ngOnInit(): void {
    this.search();
  }

  search(): void {
    this.offset = 0;
    this.runSearch();
  }

  nextPage(): void {
    this.offset += PAGE_SIZE;
    this.runSearch();
  }

  prevPage(): void {
    this.offset = Math.max(0, this.offset - PAGE_SIZE);
    this.runSearch();
  }

  hasMore(): boolean {
    return this.offset + PAGE_SIZE < this.total();
  }

  pagerLabel(): string {
    const shown = this.results().length;
    const start = shown === 0 ? 0 : this.offset + 1;
    const end = this.offset + shown;
    return `${start}–${end} of ${this.total()}`;
  }

  private runSearch(): void {
    this.loading.set(true);
    this.loadError.set(null);

    this.candidateSearch
      .search({
        role: this.role.trim() || undefined,
        location: this.location.trim() || undefined,
        remote: this.remote,
        limit: PAGE_SIZE,
        offset: this.offset
      })
      .subscribe({
        next: ({ results, total }) => {
          this.results.set(results);
          this.total.set(total);
          this.loading.set(false);
        },
        error: (err) => {
          this.loadError.set(err.error?.error?.message || 'Could not load search results');
          this.loading.set(false);
        }
      });
  }
}
