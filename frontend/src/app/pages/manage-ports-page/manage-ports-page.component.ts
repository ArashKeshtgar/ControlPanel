import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  ProjectsService,
  ProjectRegistryEntry,
  CreateProjectRequest
} from '../../projects.service';

@Component({
  selector: 'app-manage-ports-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './manage-ports-page.component.html',
  styleUrl: './manage-ports-page.component.css'
})
export class ManagePortsPageComponent implements OnInit {
  projects: ProjectRegistryEntry[] = [];
  loading = true;
  error: string | null = null;

  editingId: number | null = null;
  editUrl = '';

  adding = false;
  newProject: CreateProjectRequest = { key: '', displayName: '', category: '', adapterBaseUrl: '' };

  constructor(private api: ProjectsService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    this.api.registry().subscribe({
      next: (rows) => {
        this.projects = rows;
        this.loading = false;
      },
      error: () => {
        this.error = 'Failed to load the project registry.';
        this.loading = false;
      }
    });
  }

  startEdit(p: ProjectRegistryEntry): void {
    this.editingId = p.id;
    this.editUrl = p.adapterBaseUrl;
  }

  cancelEdit(): void {
    this.editingId = null;
  }

  saveUrl(p: ProjectRegistryEntry): void {
    this.api.update(p.id, { adapterBaseUrl: this.editUrl }).subscribe({
      next: () => {
        this.editingId = null;
        this.load();
      },
      error: () => (this.error = 'Update failed — check the API is reachable and you have Admin rights.')
    });
  }

  toggleActive(p: ProjectRegistryEntry): void {
    this.api.update(p.id, { isActive: !p.isActive }).subscribe({
      next: () => this.load(),
      error: () => (this.error = 'Update failed.')
    });
  }

  startAdd(): void {
    this.adding = true;
    this.newProject = { key: '', displayName: '', category: '', adapterBaseUrl: '' };
  }

  cancelAdd(): void {
    this.adding = false;
  }

  saveNew(): void {
    this.api.create(this.newProject).subscribe({
      next: () => {
        this.adding = false;
        this.load();
      },
      error: () => (this.error = 'Could not add project — key might already exist.')
    });
  }

  remove(p: ProjectRegistryEntry): void {
    if (!confirm(`Remove "${p.displayName}" from the registry?`)) return;
    this.api.remove(p.id).subscribe({
      next: () => this.load(),
      error: () => (this.error = 'Delete failed.')
    });
  }
}
