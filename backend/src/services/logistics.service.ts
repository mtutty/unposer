import { db } from '../db/connection';
import { LogisticsResponse } from '../types';

export class LogisticsService {
  async getResponse(userId: string): Promise<LogisticsResponse | null> {
    return (await db('logistics_responses').where({ user_id: userId }).first()) || null;
  }

  /**
   * Makes sure a logistics_responses row exists so extraction has somewhere to merge into.
   * `logistics_responses` is deliberately channel-agnostic (same row whether the candidate
   * answers via app or email — see this table's migration comment): the channel *choice* lives
   * on `flow_progress.logistics_channel` (FlowService.setChannel, called alongside this from the
   * route). There's no channel column here to set — a previous version of this method tried to
   * write one anyway, which failed on every call since the column never existed.
   */
  async ensureResponse(userId: string): Promise<LogisticsResponse> {
    const existing = await this.getResponse(userId);
    if (existing) return existing;

    const [created] = await db('logistics_responses').insert({ user_id: userId }).returning('*');
    return created;
  }
}
