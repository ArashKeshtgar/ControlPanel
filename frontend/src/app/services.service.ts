import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_BASE } from './auth/auth.service';

export interface ManagedService {
  name: string;
  displayName: string;
  state: string;
  health: 'healthy' | 'unhealthy' | 'starting' | 'none';
  status: string;
  image: string;
}

export interface AuditEntry {
  id: number;
  at: string;
  username: string;
  action: string;
  target: string;
  outcome: 'ok' | 'failed';
  detail: string | null;
}

export type ServiceAction = 'start' | 'stop' | 'restart';

@Injectable({ providedIn: 'root' })
export class ServicesService {
  constructor(private http: HttpClient) {}

  list(): Observable<ManagedService[]> {
    return this.http.get<ManagedService[]>(`${API_BASE}/services`);
  }

  // Stop and restart need the name repeated; the API checks it too.
  act(name: string, action: ServiceAction): Observable<unknown> {
    const body = action === 'start' ? {} : { confirm: name };
    return this.http.post(`${API_BASE}/services/${encodeURIComponent(name)}/${action}`, body);
  }

  logs(name: string, tail = 200): Observable<{ name: string; lines: string }> {
    return this.http.get<{ name: string; lines: string }>(
      `${API_BASE}/services/${encodeURIComponent(name)}/logs`, { params: { tail } });
  }

  audit(): Observable<AuditEntry[]> {
    return this.http.get<AuditEntry[]>(`${API_BASE}/services/audit`);
  }
}
