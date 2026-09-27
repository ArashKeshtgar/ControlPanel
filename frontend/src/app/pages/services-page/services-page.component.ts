import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { AuthService } from '../../auth/auth.service';
import { AuditEntry, ManagedService, ServiceAction, ServicesService } from '../../services.service';

// The API's own explanation when it has one (503 "service control is off",
// 409 "already running", 404 "no managed service"), a generic line otherwise.
export function serviceErrorMessage(err: HttpErrorResponse): string {
  if (err.status === 0) return "Can't reach core-api.";
  if (err.status === 403) return 'Only an Admin can do that.';
  const message = err.error?.message;
  if (typeof message === 'string') return message;
  if (Array.isArray(message)) return message.join(' ');
  return `Request failed (HTTP ${err.status}).`;
}

@Component({
  selector: 'app-services-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './services-page.component.html',
  styleUrl: './services-page.component.css'
})
export class ServicesPageComponent implements OnInit, OnDestroy {
  services: ManagedService[] = [];
  audit: AuditEntry[] = [];
  loading = true;
  error: string | null = null;
  notice: string | null = null;

  // A stop/restart waiting for the name to be typed back.
  pending: { name: string; action: ServiceAction } | null = null;
  confirmText = '';
  busy: string | null = null;

  logsFor: string | null = null;
  logText = '';
  logsLoading = false;

  private timer?: ReturnType<typeof setInterval>;

  constructor(public auth: AuthService, private api: ServicesService) {}

  get isAdmin(): boolean {
    return this.auth.currentUser?.role === 'Admin';
  }

  ngOnInit(): void {
    this.load();
    this.timer = setInterval(() => this.load(true), 5000);
  }

  ngOnDestroy(): void {
    clearInterval(this.timer);
  }

  load(quiet = false): void {
    if (!quiet) this.loading = true;
    this.api.list().subscribe({
      next: (rows) => {
        this.services = rows;
        this.loading = false;
        if (!quiet) this.error = null;
      },
      error: (err: HttpErrorResponse) => {
        this.error = serviceErrorMessage(err);
        this.loading = false;
      }
    });
    if (this.isAdmin) {
      this.api.audit().subscribe({ next: (rows) => (this.audit = rows), error: () => undefined });
    }
  }

  start(s: ManagedService): void {
    this.run(s.name, 'start');
  }

  ask(s: ManagedService, action: ServiceAction): void {
    this.pending = { name: s.name, action };
    this.confirmText = '';
  }

  cancel(): void {
    this.pending = null;
  }

  confirm(): void {
    if (!this.pending || this.confirmText !== this.pending.name) return;
    const { name, action } = this.pending;
    this.pending = null;
    this.run(name, action);
  }

  showLogs(s: ManagedService): void {
    this.logsFor = s.name;
    this.refreshLogs();
  }

  refreshLogs(): void {
    if (!this.logsFor) return;
    this.logsLoading = true;
    this.api.logs(this.logsFor).subscribe({
      next: (r) => {
        this.logText = r.lines || '(no output)';
        this.logsLoading = false;
      },
      error: (err: HttpErrorResponse) => {
        this.logText = serviceErrorMessage(err);
        this.logsLoading = false;
      }
    });
  }

  closeLogs(): void {
    this.logsFor = null;
    this.logText = '';
  }

  private run(name: string, action: ServiceAction): void {
    this.busy = name;
    this.error = null;
    this.notice = null;
    this.api.act(name, action).subscribe({
      next: () => {
        this.busy = null;
        this.notice = `${action} ${name}: done.`;
        this.load(true);
      },
      error: (err: HttpErrorResponse) => {
        this.busy = null;
        this.error = serviceErrorMessage(err);
        this.load(true);
      }
    });
  }
}
