import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_BASE } from './auth/auth.service';

export interface AdapterStatus {
  healthy: boolean;
  summary?: string;
  metrics?: Record<string, string | number>;
  error?: string;
}

export interface ProjectWithStatus extends ProjectRegistryEntry {
  status: AdapterStatus;
}

export interface ProjectRegistryEntry {
  id: number;
  key: string;
  displayName: string;
  category: string;
  adapterBaseUrl: string;
  isActive: boolean;
}

export interface CreateProjectRequest {
  key: string;
  displayName: string;
  category: string;
  adapterBaseUrl: string;
}

export interface UpdateProjectRequest {
  displayName?: string;
  category?: string;
  adapterBaseUrl?: string;
  isActive?: boolean;
}

@Injectable({ providedIn: 'root' })
export class ProjectsService {
  constructor(private http: HttpClient) {}

  list(): Observable<ProjectWithStatus[]> {
    return this.http.get<ProjectWithStatus[]>(`${API_BASE}/projects`);
  }

  registry(): Observable<ProjectRegistryEntry[]> {
    return this.http.get<ProjectRegistryEntry[]>(`${API_BASE}/projects/registry`);
  }

  create(req: CreateProjectRequest): Observable<ProjectRegistryEntry> {
    return this.http.post<ProjectRegistryEntry>(`${API_BASE}/projects`, req);
  }

  update(id: number, req: UpdateProjectRequest): Observable<ProjectRegistryEntry> {
    return this.http.put<ProjectRegistryEntry>(`${API_BASE}/projects/${id}`, req);
  }

  remove(id: number): Observable<void> {
    return this.http.delete<void>(`${API_BASE}/projects/${id}`);
  }
}
