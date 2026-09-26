import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_BASE } from './auth/auth.service';

export interface AssistantAnswer {
  answer: string;
  toolsUsed: string[];
  usage: { inputTokens: number; outputTokens: number };
}

@Injectable({ providedIn: 'root' })
export class AssistantService {
  constructor(private http: HttpClient) {}

  ask(question: string): Observable<AssistantAnswer> {
    return this.http.post<AssistantAnswer>(`${API_BASE}/assistant/ask`, { question });
  }
}
