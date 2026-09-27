import { Routes } from '@angular/router';
import { LoginPageComponent } from './pages/login-page/login-page.component';
import { DashboardPageComponent } from './pages/dashboard-page/dashboard-page.component';
import { ManagePortsPageComponent } from './pages/manage-ports-page/manage-ports-page.component';
import { ServicesPageComponent } from './pages/services-page/services-page.component';
import { authGuard } from './auth/auth.guard';
import { adminGuard } from './auth/admin.guard';

export const routes: Routes = [
  { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
  { path: 'login', component: LoginPageComponent },
  { path: 'dashboard', component: DashboardPageComponent, canActivate: [authGuard] },
  { path: 'services', component: ServicesPageComponent, canActivate: [authGuard] },
  { path: 'manage-ports', component: ManagePortsPageComponent, canActivate: [authGuard, adminGuard] }
];
