import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { AuthService } from '../../auth/auth.service';

// Only a 401 means the credentials were wrong. A server that isn't running
// (status 0) used to show "Invalid username or password" too, which sent
// people hunting for a password that was actually correct.
export function loginErrorMessage(err: HttpErrorResponse): string {
  if (err.status === 401) return 'Invalid username or password.';
  if (err.status === 0) return "Can't reach the server — is core-api running on port 4000?";
  if (err.status === 400) return 'Enter a username and a password (6+ characters).';
  return `Login failed (server error ${err.status}). Check the core-api log.`;
}

@Component({
  selector: 'app-login-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './login-page.component.html',
  styleUrl: './login-page.component.css'
})
export class LoginPageComponent {
  username = '';
  password = '';
  error: string | null = null;
  loading = false;

  constructor(private auth: AuthService, private router: Router) {}

  submit(): void {
    this.loading = true;
    this.error = null;
    this.auth.login(this.username, this.password).subscribe({
      next: () => {
        this.loading = false;
        this.router.navigate(['/dashboard']);
      },
      error: (err: HttpErrorResponse) => {
        this.loading = false;
        this.error = loginErrorMessage(err);
      }
    });
  }
}
