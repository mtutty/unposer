import crypto from 'crypto';
import { db } from '../db/connection';
import { AppError, ProfileData, ShareLink } from '../types';
import { runSandboxChat } from '../ai/sandbox-chat.chain';
import { config } from '../config';

export interface PublicProfileView {
  headline: string;
  expiresAt: Date;
}

export class ShareService {
  async createLink(userId: string, days: number, label?: string): Promise<ShareLink> {
    const profile = await db('candidate_profiles').where({ user_id: userId, status: 'approved' }).first();
    if (!profile) {
      throw new AppError('PROFILE_NOT_APPROVED', 'Approve your profile before generating a share link.', 400);
    }

    const boundedDays = Math.min(Math.max(days || config.flow.shareLinkDefaultDays, 1), config.flow.shareLinkMaxDays);
    const expiresAt = new Date(Date.now() + boundedDays * 24 * 60 * 60 * 1000);

    const [link] = await db('share_links')
      .insert({
        user_id: userId,
        token: crypto.randomBytes(24).toString('base64url'),
        label: label || null,
        expires_at: expiresAt
      })
      .returning('*');

    return link;
  }

  async listLinks(userId: string): Promise<ShareLink[]> {
    return db('share_links').where({ user_id: userId }).orderBy('created_at', 'desc');
  }

  private async loadValidLink(token: string): Promise<ShareLink> {
    const link = await db('share_links').where({ token }).first();
    if (!link) {
      throw new AppError('NOT_FOUND', 'This link is invalid.', 404);
    }
    if (new Date(link.expires_at) < new Date()) {
      throw new AppError('LINK_EXPIRED', 'This link has expired.', 410);
    }
    return link;
  }

  async getPublicProfileView(token: string): Promise<PublicProfileView> {
    const link = await this.loadValidLink(token);
    const profile = await db('candidate_profiles').where({ user_id: link.user_id, status: 'approved' }).first();
    if (!profile) {
      throw new AppError('NOT_FOUND', 'This profile is no longer available.', 404);
    }

    return { headline: profile.profile_data.headline, expiresAt: link.expires_at };
  }

  /**
   * Recruiter-side chat: same `runSandboxChat` call as the candidate's own Step 7 sandbox, same
   * profile context, live. No message persistence here — v1 deliberately has no link analytics,
   * so the transcript lives only in the recruiter's browser for the duration of their visit.
   */
  async publicChat(
    token: string,
    history: Array<{ role: 'user' | 'assistant'; content: string }>,
    question: string
  ): Promise<string> {
    const link = await this.loadValidLink(token);
    const profile = await db('candidate_profiles').where({ user_id: link.user_id, status: 'approved' }).first();
    if (!profile) {
      throw new AppError('NOT_FOUND', 'This profile is no longer available.', 404);
    }

    // Client-supplied history is already capped at 60 messages by zod (public.routes.ts) as a
    // request-size guard on untrusted input; trim further to the same window the candidate's own
    // sandbox uses — the recruiter chat gets no benefit from more raw context than that.
    const trimmedHistory = history.slice(-config.flow.sandboxHistoryWindow);

    return runSandboxChat({
      profile: profile.profile_data as ProfileData,
      history: trimmedHistory,
      question,
      userId: link.user_id
    });
  }
}
