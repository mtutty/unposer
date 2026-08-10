import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { ApiService } from '../api/api.service';
import { Resume, ResumeStructuredData } from '../../models/resume.model';

@Injectable({
  providedIn: 'root'
})
export class ResumeService {
  constructor(private api: ApiService, private http: HttpClient) {}

  get() {
    return this.api.get<Resume | null>('/resume');
  }

  upload(file: File, isCareerChanger: boolean) {
    const formData = new FormData();
    formData.append('resume', file);
    formData.append('isCareerChanger', String(isCareerChanger));
    return this.http.post<Resume>(`${environment.apiUrl}/resume/upload`, formData, { withCredentials: true });
  }

  startManualEntry(isCareerChanger: boolean) {
    return this.api.post<Resume>('/resume/manual', { isCareerChanger });
  }

  confirm(structuredData: ResumeStructuredData) {
    return this.api.put<{ resume: Resume; progress: any }>('/resume/confirm', { structuredData });
  }
}
