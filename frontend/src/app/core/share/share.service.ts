import { Injectable } from '@angular/core';
import { ApiService } from '../api/api.service';
import { ShareLink } from '../../models/sandbox.model';

@Injectable({
  providedIn: 'root'
})
export class ShareService {
  constructor(private api: ApiService) {}

  list() {
    return this.api.get<ShareLink[]>('/share');
  }

  create(days?: number, label?: string) {
    return this.api.post<{ link: ShareLink; url: string; progress: any }>('/share', { days, label });
  }
}
