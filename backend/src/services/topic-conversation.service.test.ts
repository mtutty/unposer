jest.mock('../db/connection', () => ({ db: jest.fn() }));
import { db } from '../db/connection';

jest.mock('./topic-selection.service');
import { TopicSelectionService } from './topic-selection.service';

jest.mock('./dimension-scoring.service');
import { DimensionScoringService } from './dimension-scoring.service';

jest.mock('./scoring-aggregation.service');
import { ScoringAggregationService } from './scoring-aggregation.service';

jest.mock('./progression.service');
import { ProgressionService } from './progression.service';

jest.mock('./evidence.service');
import { EvidenceService } from './evidence.service';

jest.mock('./email.service');
import { EmailService } from './email.service';

jest.mock('../ai/topic-elicitation.chain', () => ({ runTopicTurn: jest.fn() }));
import { runTopicTurn } from '../ai/topic-elicitation.chain';

import { TopicConversationService } from './topic-conversation.service';
import { getQuestion } from '../models/question-library';
import { Exchange, TopicThread } from '../types';

function makeBuilder() {
  const builder: any = {};
  builder.where = jest.fn(() => builder);
  builder.orderBy = jest.fn(() => builder);
  builder.whereIn = jest.fn(() => builder);
  builder.countDistinct = jest.fn(() => builder);
  builder.insert = jest.fn(() => builder);
  builder.update = jest.fn();
  builder.select = jest.fn();
  builder.returning = jest.fn();
  builder.first = jest.fn();
  return builder;
}

function threadFixture(overrides: Partial<TopicThread> = {}): TopicThread {
  return {
    id: 'thread-1',
    user_id: 'user-1',
    question_id: 'Q1',
    opened_at: new Date('2026-01-01'),
    closed_at: null,
    closed_by: null,
    status: 'open',
    ad_hoc_dimensions: null,
    inbound_token: 'tok-thread-1',
    last_inbound_message_id: null,
    last_outbound_message_id: null,
    created_at: new Date('2026-01-01'),
    updated_at: new Date('2026-01-01'),
    ...overrides
  };
}

function exchangeFixture(overrides: Partial<Exchange> = {}): Exchange {
  return {
    id: 'ex-1',
    thread_id: 'thread-1',
    role: 'assistant',
    text: 'hello',
    sent_at: new Date('2026-01-01'),
    channel: 'app',
    occasion_id: '2026-01-01',
    ...overrides
  };
}

describe('TopicConversationService', () => {
  let service: TopicConversationService;
  let builder: ReturnType<typeof makeBuilder>;
  const mockDb = db as unknown as jest.Mock;
  const mockRunTopicTurn = runTopicTurn as jest.Mock;
  const mockSelectNext = TopicSelectionService.prototype.selectNextQuestion as jest.Mock;
  const mockExtractAndPersist = DimensionScoringService.prototype.extractAndPersist as jest.Mock;
  const mockRecomputeDimensions = ScoringAggregationService.prototype.recomputeDimensions as jest.Mock;
  const mockRecomputeTier = ProgressionService.prototype.recomputeTier as jest.Mock;
  const mockClearDormancy = ProgressionService.prototype.clearDormancy as jest.Mock;
  const mockIndexDeepPrompt = EvidenceService.prototype.indexDeepPromptSubstrate as jest.Mock;
  const mockIndexDimensionEvidenceSpans = EvidenceService.prototype.indexDimensionEvidenceSpans as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new TopicConversationService();
    builder = makeBuilder();
    mockDb.mockReturnValue(builder);
    mockExtractAndPersist.mockResolvedValue([]);
    mockRecomputeDimensions.mockResolvedValue([]);
    mockRecomputeTier.mockResolvedValue({ tier: 'sketch' });
    mockClearDormancy.mockResolvedValue(undefined);
    mockIndexDeepPrompt.mockResolvedValue(undefined);
    mockIndexDimensionEvidenceSpans.mockResolvedValue(undefined);
  });

  describe('ensureOpeningExchanges', () => {
    it('opens a freshly-selected topic and inserts its prompt verbatim when nothing is open', async () => {
      const question = getQuestion('Q1')!;
      mockSelectNext.mockResolvedValue(question);

      builder.first.mockResolvedValueOnce(undefined); // getActiveThread: nothing open
      builder.returning.mockResolvedValueOnce([threadFixture({ question_id: 'Q1' })]); // openThread
      builder.returning.mockResolvedValueOnce([exchangeFixture({ text: question.prompt })]); // opener

      const result = await service.ensureOpeningExchanges('user-1', 'app');

      expect(mockSelectNext).toHaveBeenCalledWith('user-1');
      expect(builder.insert).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'user-1', question_id: 'Q1' }));
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ role: 'assistant', content: question.prompt, step: 'deep_prompts' });
    });

    it('returns the full history of an already-open topic instead of opening a new one', async () => {
      builder.first.mockResolvedValueOnce(threadFixture());
      builder.select.mockResolvedValueOnce([
        exchangeFixture({ id: 'ex-1', role: 'assistant' }),
        exchangeFixture({ id: 'ex-2', role: 'user', text: 'reply' })
      ]);

      const result = await service.ensureOpeningExchanges('user-1', 'app');

      expect(mockSelectNext).not.toHaveBeenCalled();
      expect(result.map((m) => m.id)).toEqual(['ex-1', 'ex-2']);
    });
  });

  describe('switchActiveTopicToEmail', () => {
    const mockDeliverForTopic = EmailService.prototype.deliverForTopic as jest.Mock;

    it('throws NO_ACTIVE_TOPIC when nothing is open', async () => {
      builder.first.mockResolvedValueOnce(undefined);

      await expect(service.switchActiveTopicToEmail('user-1')).rejects.toMatchObject({ code: 'NO_ACTIVE_TOPIC' });
    });

    it('emails the most recent assistant exchange without opening a new thread or touching existing exchanges', async () => {
      const thread = threadFixture();
      builder.first.mockResolvedValueOnce(thread);
      builder.select.mockResolvedValueOnce([
        exchangeFixture({ id: 'ex-opener', role: 'assistant', text: 'Opening question.' }),
        exchangeFixture({ id: 'ex-reply', role: 'user', text: 'my reply' }),
        exchangeFixture({ id: 'ex-followup', role: 'assistant', text: 'A follow-up question.' })
      ]);
      mockDeliverForTopic.mockResolvedValueOnce(undefined);

      const result = await service.switchActiveTopicToEmail('user-1');

      expect(mockDeliverForTopic).toHaveBeenCalledWith(thread, 'A follow-up question.');
      expect(builder.insert).not.toHaveBeenCalled();
      expect(result).toMatchObject({ id: 'ex-followup', content: 'A follow-up question.' });
    });

    it('throws NO_PENDING_QUESTION when the open thread has no assistant exchange yet', async () => {
      builder.first.mockResolvedValueOnce(threadFixture());
      builder.select.mockResolvedValueOnce([]);

      await expect(service.switchActiveTopicToEmail('user-1')).rejects.toMatchObject({ code: 'NO_PENDING_QUESTION' });
    });
  });

  describe('postUserMessage', () => {
    it('throws NO_ACTIVE_TOPIC when there is nothing open to reply to', async () => {
      builder.first.mockResolvedValueOnce(undefined);

      await expect(service.postUserMessage('user-1', 'app', 'hi')).rejects.toMatchObject({ code: 'NO_ACTIVE_TOPIC' });
    });

    it('throws UNKNOWN_QUESTION when the open thread references a question no longer in the library', async () => {
      builder.first.mockResolvedValueOnce(threadFixture({ question_id: 'QZZZ' }));

      await expect(service.postUserMessage('user-1', 'app', 'hi')).rejects.toMatchObject({ code: 'UNKNOWN_QUESTION' });
    });

    it('persists the exchange, runs the topic turn, and extracts evidence for every dimension the question loads on', async () => {
      const question = getQuestion('Q1')!; // openness P; emotional_stability/change_orientation/motivation s
      builder.first.mockResolvedValueOnce(threadFixture({ question_id: 'Q1' })); // getActiveThread
      builder.returning.mockResolvedValueOnce([exchangeFixture({ id: 'ex-user', role: 'user', text: 'my answer' })]); // insert user exchange
      builder.select.mockResolvedValueOnce([
        exchangeFixture({ id: 'ex-opener', role: 'assistant' }),
        exchangeFixture({ id: 'ex-user', role: 'user', text: 'my answer' })
      ]); // getExchanges (history)
      mockRunTopicTurn.mockResolvedValueOnce({ reply: 'Tell me more.', closeTopic: false, closedBy: 'model' });
      builder.returning.mockResolvedValueOnce([exchangeFixture({ id: 'ex-assistant', role: 'assistant', text: 'Tell me more.' })]);
      builder.first.mockResolvedValueOnce({ tier: 'sketch' }); // isFlowStepComplete: progression row lookup

      const outcome = await service.postUserMessage('user-1', 'app', 'my answer');

      expect(mockRunTopicTurn).toHaveBeenCalledWith({
        question,
        channel: 'app',
        history: [
          { role: 'assistant', content: 'hello' },
          { role: 'user', content: 'my answer' }
        ]
      });
      expect(mockExtractAndPersist).toHaveBeenCalledWith('ex-user', question.prompt, 'my answer', Object.keys(question.dimensionLoads));
      // §8 recruiter-visibility tagging (Iteration 8) — every indexed chunk carries which
      // question it came from and whether that question is on the never-verbatim-to-recruiters
      // list, so evidence.service.ts's search() can filter without knowing the question library.
      expect(mockIndexDeepPrompt).toHaveBeenCalledWith(
        'user-1',
        expect.anything(),
        expect.anything(),
        { questionId: question.id, heavy: question.heavy }
      );
      expect(builder.update).not.toHaveBeenCalled(); // topic stays open
      expect(mockRecomputeDimensions).not.toHaveBeenCalled(); // re-score only triggers on topic close (spec §9.2)
      expect(outcome).toEqual({
        assistantMessage: expect.objectContaining({ id: 'ex-assistant', content: 'Tell me more.' }),
        complete: true
      });
    });

    it('closes the topic thread when the elicitation turn says to, honoring which side closed it', async () => {
      builder.first.mockResolvedValueOnce(threadFixture({ question_id: 'Q1' }));
      builder.returning.mockResolvedValueOnce([exchangeFixture({ id: 'ex-user', role: 'user' })]);
      builder.select.mockResolvedValueOnce([exchangeFixture({ id: 'ex-user', role: 'user' })]);
      mockRunTopicTurn.mockResolvedValueOnce({ reply: 'Got it, thanks.', closeTopic: true, closedBy: 'user' });
      builder.returning.mockResolvedValueOnce([exchangeFixture({ id: 'ex-assistant', role: 'assistant', text: 'Got it, thanks.' })]);
      builder.first.mockResolvedValueOnce({ tier: 'sketch' });
      const extractedRows = [{ id: 'de-1', dimension: 'openness' }];
      mockExtractAndPersist.mockResolvedValueOnce(extractedRows);

      await service.postUserMessage('user-1', 'app', "that's all I've got");

      expect(builder.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'closed', closed_by: 'user' }));
      // Full re-score (spec §9.2) fires for every dimension Q1 loads on, not just its primary.
      expect(mockRecomputeDimensions).toHaveBeenCalledWith('user-1', Object.keys(getQuestion('Q1')!.dimensionLoads));
      // Progression tier is recomputed right after, since it's derived from exactly these scores.
      expect(mockRecomputeTier).toHaveBeenCalledWith('user-1');
      // §8: the just-extracted spans get indexed for RAG, tagged with the same question/heavy
      // source as the whole-turn chunk — awaiting `extraction` (to gate aggregation) is what
      // guarantees this has actually fired by the time postUserMessage returns.
      expect(mockIndexDimensionEvidenceSpans).toHaveBeenCalledWith('user-1', extractedRows, { questionId: 'Q1', heavy: false });
    });

    it('does not let a failed aggregation recompute break the turn', async () => {
      builder.first.mockResolvedValueOnce(threadFixture({ question_id: 'Q1' }));
      builder.returning.mockResolvedValueOnce([exchangeFixture({ id: 'ex-user', role: 'user' })]);
      builder.select.mockResolvedValueOnce([exchangeFixture({ id: 'ex-user', role: 'user' })]);
      mockRunTopicTurn.mockResolvedValueOnce({ reply: 'Got it, thanks.', closeTopic: true, closedBy: 'model' });
      builder.returning.mockResolvedValueOnce([exchangeFixture({ id: 'ex-assistant', role: 'assistant', text: 'Got it, thanks.' })]);
      builder.first.mockResolvedValueOnce({ tier: 'sketch' });
      mockRecomputeDimensions.mockRejectedValueOnce(new Error('boom'));

      const outcome = await service.postUserMessage('user-1', 'app', "that's all I've got");

      expect(outcome.assistantMessage.content).toBe('Got it, thanks.');
    });

    it('reports the step incomplete while progression.tier is still "none" (flow addendum §2)', async () => {
      builder.first.mockResolvedValueOnce(threadFixture({ question_id: 'Q1' }));
      builder.returning.mockResolvedValueOnce([exchangeFixture({ id: 'ex-user', role: 'user' })]);
      builder.select.mockResolvedValueOnce([exchangeFixture({ id: 'ex-user', role: 'user' })]);
      mockRunTopicTurn.mockResolvedValueOnce({ reply: 'Ok.', closeTopic: false, closedBy: 'model' });
      builder.returning.mockResolvedValueOnce([exchangeFixture({ id: 'ex-assistant', role: 'assistant' })]);
      builder.first.mockResolvedValueOnce({ tier: 'none' });

      const outcome = await service.postUserMessage('user-1', 'app', 'partial');

      expect(outcome.complete).toBe(false);
    });

    it('handles an ad hoc (non-library) thread by building a synthetic question from its opener + stored dimensions', async () => {
      const adHocThread = threadFixture({ question_id: 'reask-abc', ad_hoc_dimensions: ['dominance'] });
      builder.first.mockResolvedValueOnce(adHocThread); // getActiveThread
      // resolveQuestion's own getExchanges call, to read the opener text:
      builder.select.mockResolvedValueOnce([exchangeFixture({ id: 'ex-opener', role: 'assistant', text: 'Say more about that call you made.' })]);
      builder.returning.mockResolvedValueOnce([exchangeFixture({ id: 'ex-user', role: 'user', text: 'my answer' })]); // insert user exchange
      builder.select.mockResolvedValueOnce([
        exchangeFixture({ id: 'ex-opener', role: 'assistant', text: 'Say more about that call you made.' }),
        exchangeFixture({ id: 'ex-user', role: 'user', text: 'my answer' })
      ]); // getExchanges (history)
      mockRunTopicTurn.mockResolvedValueOnce({ reply: 'Got it.', closeTopic: true, closedBy: 'model' });
      builder.returning.mockResolvedValueOnce([exchangeFixture({ id: 'ex-assistant', role: 'assistant', text: 'Got it.' })]);
      builder.first.mockResolvedValueOnce({ tier: 'sketch' });

      await service.postUserMessage('user-1', 'app', 'my answer');

      expect(mockRunTopicTurn).toHaveBeenCalledWith(
        expect.objectContaining({ question: expect.objectContaining({ prompt: 'Say more about that call you made.', dimensionLoads: { dominance: 'P' } }) })
      );
      expect(mockExtractAndPersist).toHaveBeenCalledWith('ex-user', 'Say more about that call you made.', 'my answer', ['dominance']);
    });
  });

  describe('getFullTranscript', () => {
    it('returns every exchange across every thread, oldest first, with the right question_id metadata', async () => {
      builder.select
        .mockResolvedValueOnce([threadFixture({ id: 't1', question_id: 'Q0' }), threadFixture({ id: 't2', question_id: 'Q23' })]) // topic_thread
        .mockResolvedValueOnce([
          exchangeFixture({ id: 'ex-1', thread_id: 't1', role: 'assistant' }),
          exchangeFixture({ id: 'ex-2', thread_id: 't2', role: 'assistant' })
        ]); // exchange

      const result = await service.getFullTranscript('user-1');

      expect(result.map((m) => m.id)).toEqual(['ex-1', 'ex-2']);
      expect(result[0].metadata['question_id']).toBe('Q0');
      expect(result[1].metadata['question_id']).toBe('Q23');
    });

    it('returns an empty array without querying exchanges when the user has no threads at all', async () => {
      builder.select.mockResolvedValueOnce([]);

      const result = await service.getFullTranscript('user-1');

      expect(result).toEqual([]);
      expect(mockDb).toHaveBeenCalledTimes(1);
    });
  });

  describe('openAdHocTopic', () => {
    it('opens a thread carrying the given question_id and dimensions, and inserts the prompt verbatim', async () => {
      builder.first.mockResolvedValueOnce(undefined); // getActiveThread: nothing currently open
      builder.returning
        .mockResolvedValueOnce([threadFixture({ question_id: 'reask-xyz', ad_hoc_dimensions: ['emotional_stability'] })]) // openThread-equivalent insert
        .mockResolvedValueOnce([exchangeFixture({ text: 'A targeted follow-up question.' })]); // opener

      const result = await service.openAdHocTopic('user-1', 'reask-xyz', 'A targeted follow-up question.', ['emotional_stability'], 'app');

      expect(builder.insert).toHaveBeenCalledWith(
        expect.objectContaining({ user_id: 'user-1', question_id: 'reask-xyz', ad_hoc_dimensions: JSON.stringify(['emotional_stability']) })
      );
      expect(result).toMatchObject({ role: 'assistant', content: 'A targeted follow-up question.', step: 'deep_prompts' });
    });

    it('interrupts (closes) any already-open thread first, so it is never orphaned', async () => {
      builder.first.mockResolvedValueOnce(threadFixture({ id: 'stale-thread', status: 'open' })); // getActiveThread
      builder.returning
        .mockResolvedValueOnce([threadFixture({ question_id: 'reask-xyz', ad_hoc_dimensions: [] })])
        .mockResolvedValueOnce([exchangeFixture()]);

      await service.openAdHocTopic('user-1', 'reask-xyz', 'prompt', [], 'app');

      expect(builder.where).toHaveBeenCalledWith({ id: 'stale-thread' });
      expect(builder.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'closed', closed_by: 'model' }));
    });
  });
});
