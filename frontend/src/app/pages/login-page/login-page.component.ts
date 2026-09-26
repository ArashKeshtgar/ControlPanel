import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../auth/auth.service';

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
      error: () => {
        this.loading = false;
        this.error = 'Invalid username or password.';
      }
    });
  }
}
