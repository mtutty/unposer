import { Routes } from '@angular/router';
import { LoginComponent } from './features/auth/login.component';
import { DashboardComponent } from './features/dashboard/dashboard.component';
import { OnboardingShellComponent } from './features/onboarding/onboarding-shell.component';
import { ResumeStepComponent } from './features/onboarding/resume/resume.component';
import { LogisticsStepComponent } from './features/onboarding/logistics/logistics-step.component';
import { DeepPromptsStepComponent } from './features/onboarding/deep-prompts/deep-prompts.component';
import { ProfileReviewStepComponent } from './features/onboarding/profile/profile-review.component';
import { SandboxStepComponent } from './features/onboarding/sandbox/sandbox.component';
import { ShareStepComponent } from './features/onboarding/share/share.component';
import { PublicShareComponent } from './features/public-share/public-share.component';
import { SplashComponent } from './features/splash/splash.component';
import { AdminUsersComponent } from './features/admin/admin-users.component';
import { AdminUserDetailComponent } from './features/admin/admin-user-detail.component';
import { ScheduleSettingsComponent } from './features/schedule/schedule-settings.component';
import { authGuard, guestGuard, adminGuard } from './core/auth/auth.guard';

export const routes: Routes = [
  { path: '', component: SplashComponent, canActivate: [guestGuard] },
  { path: 'login', component: LoginComponent },
  { path: 'dashboard', component: DashboardComponent, canActivate: [authGuard] },
  { path: 'admin/users', component: AdminUsersComponent, canActivate: [adminGuard] },
  { path: 'admin/users/:id', component: AdminUserDetailComponent, canActivate: [adminGuard] },
  { path: 'settings/schedule', component: ScheduleSettingsComponent, canActivate: [authGuard] },
  {
    path: 'onboarding',
    component: OnboardingShellComponent,
    canActivate: [authGuard],
    children: [
      { path: 'resume', component: ResumeStepComponent },
      { path: 'logistics', component: LogisticsStepComponent },
      { path: 'deep-prompts', component: DeepPromptsStepComponent },
      { path: 'profile', component: ProfileReviewStepComponent },
      { path: 'sandbox', component: SandboxStepComponent },
      { path: 'share', component: ShareStepComponent }
    ]
  },
  // Step 8 — unauthenticated recruiter access, token-gated, no session required.
  { path: 'shared/:token', component: PublicShareComponent },
  { path: '**', redirectTo: '/dashboard' }
];
