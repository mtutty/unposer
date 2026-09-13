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
import { AdminUsersComponent } from './features/admin/admin-users.component';
import { AdminUserDetailComponent } from './features/admin/admin-user-detail.component';
import { EmployerRequisitionsComponent } from './features/employer/employer-requisitions.component';
import { EmployerRequisitionDetailComponent } from './features/employer/employer-requisition-detail.component';
import { CandidateSearchComponent } from './features/employer/candidate-search.component';
import { ScheduleSettingsComponent } from './features/schedule/schedule-settings.component';
import { HowItWorksComponent } from './features/how-it-works/how-it-works.component';
import { DataTransparencyComponent } from './features/data-transparency/data-transparency.component';
import { PendingApprovalComponent } from './features/pending/pending-approval.component';
import { authGuard, guestGuard, adminGuard, employerGuard, pendingGuard } from './core/auth/auth.guard';

export const routes: Routes = [
  // The login page doubles as the marketing splash now (see login.component.ts) — `/` just
  // redirects there rather than rendering a separate page.
  { path: '', redirectTo: '/login', pathMatch: 'full' },
  { path: 'login', component: LoginComponent, canActivate: [guestGuard] },
  { path: 'how-it-works', component: HowItWorksComponent },
  { path: 'how-your-profile-works', component: DataTransparencyComponent },
  { path: 'pending', component: PendingApprovalComponent, canActivate: [pendingGuard] },
  { path: 'dashboard', component: DashboardComponent, canActivate: [authGuard] },
  { path: 'admin/users', component: AdminUsersComponent, canActivate: [adminGuard] },
  { path: 'admin/users/:id', component: AdminUserDetailComponent, canActivate: [adminGuard] },
  { path: 'employer/requisitions', component: EmployerRequisitionsComponent, canActivate: [employerGuard] },
  { path: 'employer/requisitions/:id', component: EmployerRequisitionDetailComponent, canActivate: [employerGuard] },
  { path: 'employer/search', component: CandidateSearchComponent, canActivate: [employerGuard] },
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
