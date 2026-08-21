import { db } from '../db/connection';
import { AppError, Channel, ConversationThread, Message, ThreadStep } from '../types';
import { getStep, FlowStep } from '../models/flow-steps';
import { runElicitationTurn } from '../ai/elicitation.chain';
import { config } from '../config';
import { EvidenceService } from './evidence.service';

/** Areas the elicitation prompt should actually try to extract — excludes 'resume'-sourced areas
 *  (e.g. logistics's "Background" glyph), which are filled from the resume record, not the chat. */
function chatExtractionAreas(stepDef: FlowStep) {
  return stepDef.infoAreas?.filter((area) => (area.source ?? 'chat') === 'chat');
}

export interface TurnOutcome {
  assistantMessage: Message;
  complete: boolean;
  thread: ConversationThread;
}

/**
 * Shared elicitation engine behind both the Step 3 logistics conversation (app or email) and the
 * Step 5 deep-prompt chat (app only). One code path, one message table, one thread record — the
 * app and email channels resolve to the same underlying state, per spec Step 4.
 */
export class ConversationService {
  private evidence = new EvidenceService();

  async getOrCreateThread(userId: string, step: ThreadStep, channel: Channel): Promise<ConversationThread> {
    const stepDef = getStep(step);
    if (!stepDef.channels.includes(channel)) {
      throw new AppError('INVALID_CHANNEL', `Step "${step}" does not support channel "${channel}"`, 400);
    }

    let thread = await db('conversation_threads').where({ user_id: userId, step }).first();

    if (!thread) {
      [thread] = await db('conversation_threads')
        .insert({
          user_id: userId,
          step,
          channel,
          thread_cap: channel === 'email' ? config.flow.emailThreadCap : 200
        })
        .returning('*');
    } else if (thread.channel !== channel && thread.status !== 'complete') {
      [thread] = await db('conversation_threads')
        .where({ id: thread.id })
        .update({ channel, updated_at: new Date() })
        .returning('*');
    }

    return thread;
  }

  async getHistory(userId: string, step: ThreadStep): Promise<Message[]> {
    return db('messages').where({ user_id: userId, step }).orderBy('created_at', 'asc');
  }

  /** Same as getHistory, but capped to the most recent `limit` messages — what actually gets
   *  sent to the LLM each turn (see postUserMessage below). knownData (for logistics) and the
   *  profile digest + evidence-search tool (for sandbox, see sandbox.service.ts) carry durable
   *  memory beyond this window; raw history's job here is just recent conversational flow. */
  async getRecentHistory(userId: string, step: ThreadStep, limit: number): Promise<Message[]> {
    const rows = await db('messages').where({ user_id: userId, step }).orderBy('created_at', 'desc').limit(limit);
    return rows.reverse();
  }

  /** Generates and persists the opening question if this thread has no messages yet. */
  async ensureOpeningMessage(userId: string, step: ThreadStep, channel: Channel): Promise<Message[]> {
    const thread = await this.getOrCreateThread(userId, step, channel);
    const history = await this.getHistory(userId, step);
    if (history.length > 0) {
      return history;
    }

    const stepDef = getStep(step);
    const knownData = await this.loadKnownData(userId, step);
    const turn = await runElicitationTurn({
      stepName: stepDef.name,
      completionCriteria: stepDef.completionCriteria,
      conversationStarters: stepDef.conversationStarters,
      channel,
      history: [],
      knownData,
      extractionAreas: chatExtractionAreas(stepDef)
    });

    const [opener] = await db('messages')
      .insert({
        thread_id: thread.id,
        user_id: userId,
        role: 'assistant',
        content: turn.reply,
        channel,
        step
      })
      .returning('*');

    await db('conversation_threads')
      .where({ id: thread.id })
      .update({ message_count: 1, last_message_at: new Date(), updated_at: new Date() });

    return [opener];
  }

  async postUserMessage(userId: string, step: ThreadStep, channel: Channel, content: string): Promise<TurnOutcome> {
    const thread = await this.getOrCreateThread(userId, step, channel);

    if (thread.status === 'complete') {
      throw new AppError('THREAD_COMPLETE', 'This conversation is already complete.', 400);
    }
    if (thread.message_count >= thread.thread_cap) {
      throw new AppError('THREAD_CAP_REACHED', 'This conversation has reached its length limit.', 400);
    }

    const [userMessage] = await db('messages')
      .insert({
        thread_id: thread.id,
        user_id: userId,
        role: 'user',
        content,
        channel,
        step
      })
      .returning('*');

    const stepDef = getStep(step);
    const priorHistory = await this.getRecentHistory(userId, step, config.flow.elicitationHistoryWindow);
    const knownData = await this.loadKnownData(userId, step);

    const turn = await runElicitationTurn({
      stepName: stepDef.name,
      completionCriteria: stepDef.completionCriteria,
      conversationStarters: stepDef.conversationStarters,
      channel,
      history: priorHistory.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      knownData,
      extractionAreas: chatExtractionAreas(stepDef)
    });

    if (step === 'logistics' && Object.keys(turn.extracted).length > 0) {
      await this.mergeLogisticsData(userId, turn.extracted);
    }

    const [assistantMessage] = await db('messages')
      .insert({
        thread_id: thread.id,
        user_id: userId,
        role: 'assistant',
        content: turn.reply,
        channel,
        step,
        metadata: turn.extracted
      })
      .returning('*');

    const [updatedThread] = await db('conversation_threads')
      .where({ id: thread.id })
      .update({
        message_count: thread.message_count + 2,
        status: turn.complete ? 'complete' : channel === 'email' ? 'awaiting_reply' : 'active',
        last_message_at: new Date(),
        updated_at: new Date()
      })
      .returning('*');

    if (step === 'logistics' && turn.complete) {
      const [logisticsRow] = await db('logistics_responses')
        .where({ user_id: userId })
        .update({ status: 'complete', updated_at: new Date() })
        .returning('*');

      // Indexes evidence for semantic retrieval in sandbox/share chat (see evidence.service.ts).
      // Never gates thread completion on this.
      this.evidence.indexLogisticsSubstrate(userId, logisticsRow.data).catch((error) => {
        console.warn(`[conversation.service] evidence indexing failed for user ${userId}:`, error.message || error);
      });
    }

    if (step === 'deep_prompts') {
      this.evidence.indexDeepPromptSubstrate(userId, userMessage, assistantMessage).catch((error) => {
        console.warn(`[conversation.service] evidence indexing failed for user ${userId}:`, error.message || error);
      });
    }

    return { assistantMessage, complete: turn.complete, thread: updatedThread };
  }

  private async loadKnownData(userId: string, step: ThreadStep): Promise<Record<string, any>> {
    if (step === 'logistics') {
      const row = await db('logistics_responses').where({ user_id: userId }).first();
      return row?.data || {};
    }
    return {};
  }

  private async mergeLogisticsData(userId: string, extracted: Record<string, any>): Promise<void> {
    const existing = await db('logistics_responses').where({ user_id: userId }).first();
    const merged = { ...(existing?.data || {}), ...extracted };

    if (existing) {
      await db('logistics_responses').where({ user_id: userId }).update({ data: merged, updated_at: new Date() });
    } else {
      // logistics_responses has no channel column by design — see LogisticsService.ensureResponse.
      await db('logistics_responses').insert({ user_id: userId, data: merged });
    }
  }
}
