import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { ProjectsService, ProjectWithStatus } from '../../projects.service';
import { AuthService } from '../../auth/auth.service';

@Component({
  selector: 'app-dashboard-page',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './dashboard-page.component.html',
  styleUrl: './dashboard-page.component.css'
})
export class DashboardPageComponent implements OnInit {
  projects: ProjectWithStatus[] = [];
  loading = true;
  error: string | null = null;

  constructor(
    private api: ProjectsService,
    public auth: AuthService,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    this.api.list().subscribe({
      next: (rows) => {
        this.projects = rows;
        this.loading = false;
      },
      error: () => {
        this.error = 'Failed to load project status.';
        this.loading = false;
      }
    });
  }

  get categories(): string[] {
    return [...new Set(this.projects.map((p) => p.category))];
  }

  byCategory(category: string): ProjectWithStatus[] {
    return this.projects.filter((p) => p.category === category);
  }

  metricEntries(project: ProjectWithStatus): [string, string | number][] {
    return Object.entries(project.status.metrics ?? {});
  }

  logout(): void {
    this.auth.logout();
    this.router.navigate(['/login']);
  }
}
