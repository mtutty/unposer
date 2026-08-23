import { db } from '../db/connection';
import {
  AppError,
  CandidateProfile,
  FlowProgress,
  LogisticsResponse,
  Message,
  Resume,
  SandboxMessage,
  ShareLink,
  User,
  UserRole,
  UserStatus
} from '../types';
import { FlowService } from './flow.service';
import { ResumeService } from './resume.service';
import { LogisticsService } from './logistics.service';
import { ConversationService } from './conversation.service';
import { TopicConversationService } from './topic-conversation.service';
import { SandboxService } from './sandbox.service';
import { ShareService } from './share.service';
import { ProfileService } from './profile.service';
import { EmailService } from './email.service';

// Admin/user-management foundation (see the migration's header comment for why this exists as
// part of Iteration 4 — prerequisite infrastructure for the personality engine's calibration
// console, whose own build is deferred to docs/calibration-console-spec.md).

export interface UserListFilters {
  /** Case-insensitive substring match against email or name. */
  q?: string;
  role?: UserRole;
  status?: UserStatus;
  limit?: number;
  offset?: number;
}

export interface UserListResult {
  users: User[];
  total: number;
}

const DEFAULT_LIMIT = 50;

// A candidate's full accumulated onboarding record, as far as it's got — every field is null/
// empty rather than absent when a step hasn't been reached yet, so the admin detail view can
// render "not started" instead of special-casing missing keys. Deliberately assembled by calling
// straight into each step's own service (same read methods their own routes use, see
// routes/*.routes.ts) rather than duplicating any query here.
export interface AdminUserDetail {
  user: User;
  flowProgress: FlowProgress | null;
  resume: Resume | null;
  logisticsResponse: LogisticsResponse | null;
  logisticsConversation: Message[];
  deepPromptsTranscript: Message[];
  profile: CandidateProfile | null;
  sandboxHistory: SandboxMessage[];
  shareLinks: ShareLink[];
}

export class AdminService {
  private flow = new FlowService();
  private resume = new ResumeService();
  private logistics = new LogisticsService();
  private conversation = new ConversationService();
  private topicConversation = new TopicConversationService();
  private sandbox = new SandboxService();
  private share = new ShareService();
  private profile = new ProfileService();
  private email = new EmailService();

  async listUsers(filters: UserListFilters = {}): Promise<UserListResult> {
    const limit = filters.limit ?? DEFAULT_LIMIT;
    const offset = filters.offset ?? 0;

    const scoped = () => {
      let query = db('users');
      if (filters.q) {
        const term = `%${filters.q}%`;
        query = query.where((qb) => qb.whereILike('email', term).orWhereILike('name', term));
      }
      if (filters.role) query = query.andWhere({ role: filters.role });
      if (filters.status) query = query.andWhere({ status: filters.status });
      return query;
    };

    const [users, countRow] = await Promise.all([
      scoped().orderBy('created_at', 'desc').limit(limit).offset(offset),
      scoped().count('* as n').first()
    ]);

    return { users, total: Number(countRow?.n ?? 0) };
  }

  async getUser(id: string): Promise<User | undefined> {
    return db('users').where({ id }).first();
  }

  /** Everything a candidate has accumulated so far, for the admin "browse a user" screen. An
   *  admin account (never runs the candidate flow — see authGuard on the frontend) just comes
   *  back with every field empty; that's a legitimate state here, not an error. */
  async getUserDetail(id: string): Promise<AdminUserDetail> {
    const user = await this.getUser(id);
    if (!user) {
      throw new AppError('NOT_FOUND', 'User not found', 404);
    }

    const [
      flowProgress,
      resume,
      logisticsResponse,
      logisticsConversation,
      deepPromptsTranscript,
      profile,
      sandboxHistory,
      shareLinks
    ] = await Promise.all([
      db('flow_progress').where({ user_id: id }).first(),
      this.resume.getResume(id),
      this.logistics.getResponse(id),
      this.conversation.getHistory(id, 'logistics'),
      this.topicConversation.getFullTranscript(id),
      this.profile.getProfile(id),
      this.sandbox.getHistory(id),
      this.share.listLinks(id)
    ]);

    return {
      user,
      flowProgress: flowProgress ?? null,
      resume,
      logisticsResponse,
      logisticsConversation,
      deepPromptsTranscript,
      profile,
      sandboxHistory,
      shareLinks
    };
  }

  /**
   * Wipes everything a candidate has accumulated (delegates to FlowService.resetProgress — the
   * same wipe a candidate can already trigger on their own account via POST /api/flow/reset), but
   * gated on two things a self-serve reset doesn't need: the target must actually be a candidate
   * (an admin account has no onboarding data to wipe, and "reset" reads as a no-op-but-scary
   * action on one otherwise), and the caller must echo the target's email back — the same
   * type-to-confirm shape as most irreversible admin actions elsewhere, enforced server-side so a
   * client-only confirm() dialog isn't the only thing standing between an admin and an accidental
   * click.
   */
  async resetUserData(id: string, confirmEmail: string): Promise<User> {
    const user = await this.getUser(id);
    if (!user) {
      throw new AppError('NOT_FOUND', 'User not found', 404);
    }
    if (user.role === 'admin') {
      throw new AppError('CANNOT_RESET_ADMIN', 'Admin accounts have no candidate data to reset', 400);
    }
    if (confirmEmail !== user.email) {
      throw new AppError('CONFIRMATION_MISMATCH', "Typed email doesn't match this user's email", 400);
    }

    await this.flow.resetProgress(id);
    return user;
  }

  async updateUser(id: string, changes: { role?: UserRole; status?: UserStatus }): Promise<User> {
    const updates: Record<string, unknown> = { updated_at: new Date() };
    if (changes.role !== undefined) updates.role = changes.role;
    if (changes.status !== undefined) updates.status = changes.status;

    const [user] = await db('users').where({ id }).update(updates).returning('*');
    if (!user) {
      throw new AppError('NOT_FOUND', 'User not found', 404);
    }
    return user;
  }

  /**
   * Invitation-only mode's admin-side half (see config.inviteOnly and the "invited" role's
   * doc-comment in types/index.ts). Creates a placeholder users row with no oidc_provider/
   * oidc_subject yet — those get filled in, and role flips to 'user', on the invited person's
   * first real OIDC login (see upsertOidcUser in auth.service.ts). Works regardless of whether
   * invite-only mode is currently on; that flag only gates *self*-registration.
   *
   * Re-inviting an email that's already pending (role 'invited') just re-sends the email rather
   * than erroring — a reasonable "resend invite" affordance without a separate endpoint. Any
   * other existing account for that email is a hard conflict.
   */
  async inviteUser(email: string, invitedByUserId: string, customMessage?: string): Promise<User> {
    const existing = await db('users').whereRaw('lower(email) = lower(?)', [email]).first();
    if (existing && existing.role !== 'invited') {
      throw new AppError('EMAIL_IN_USE', 'An account with this email already exists', 409);
    }

    let user: User;
    if (existing) {
      [user] = await db('users')
        .where({ id: existing.id })
        .update({ invited_by: invitedByUserId, invited_at: new Date(), updated_at: new Date() })
        .returning('*');
    } else {
      [user] = await db('users')
        .insert({
          email,
          name: email,
          role: 'invited',
          invited_by: invitedByUserId,
          invited_at: new Date()
        })
        .returning('*');
    }

    await this.email.sendInvite(email, customMessage);
    return user;
  }

  /** Deletes a pending invite outright — never a real account (see the role guard below), so
   *  there's no data of theirs to lose. Lets an admin clean up a typo'd invite without waiting
   *  for it to just sit there forever. */
  async revokeInvite(id: string): Promise<void> {
    const user = await this.getUser(id);
    if (!user) {
      throw new AppError('NOT_FOUND', 'User not found', 404);
    }
    if (user.role !== 'invited') {
      throw new AppError('NOT_AN_INVITE', 'Only a pending invite can be revoked', 400);
    }
    await db('users').where({ id }).delete();
  }
}
