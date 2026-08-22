import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../api/api.service';
import { PacePreference, PauseDuration, Progression } from '../../models/personality.model';

/** Weekly re-engagement scheduler self-service controls (spec §3.5, Iteration 9) — the
 *  destination every scheduled email's footer links back to. See backend/src/routes/schedule.routes.ts. */
@Injectable({
  providedIn: 'root'
})
export class ScheduleService {
  constructor(private api: ApiService) {}

  getState(): Observable<Progression> {
    return this.api.get<Progression>('/schedule');
  }

  setPace(pace: PacePreference): Observable<Progression> {
    return this.api.post<Progression>('/schedule/pace', { pace });
  }

  pause(duration: PauseDuration): Observable<Progression> {
    return this.api.post<Progression>('/schedule/pause', { duration });
  }

  resume(): Observable<Progression> {
    return this.api.post<Progression>('/schedule/resume', {});
  }

  unsubscribe(): Observable<Progression> {
    return this.api.post<Progression>('/schedule/unsubscribe', {});
  }
}
