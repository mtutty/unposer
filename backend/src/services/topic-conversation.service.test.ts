jest.mock('../db/connection', () => ({ db: jest.fn() }));
import { db } from '../db/connection';

jest.mock('./topic-selection.service');
import { TopicSelectionService } from './topic-selection.service';

jest.mock('./dimension-scoring.service');
import { DimensionScoringService } from './dimension-scoring.service';

jest.mock('./evidence.service');
import { EvidenceService } from './evidence.service';

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
  const mockIndexDeepPrompt = EvidenceService.prototype.indexDeepPromptSubstrate as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new TopicConversationService();
    builder = makeBuilder();
    mockDb.mockReturnValue(builder);
    mockExtractAndPersist.mockResolvedValue([]);
    mockIndexDeepPrompt.mockResolvedValue(undefined);
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
      builder.first.mockResolvedValueOnce({ n: '4' }); // isFlowStepComplete

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
      expect(mockIndexDeepPrompt).toHaveBeenCalled();
      expect(builder.update).not.toHaveBeenCalled(); // topic stays open
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
      builder.first.mockResolvedValueOnce({ n: '0' });

      await service.postUserMessage('user-1', 'app', "that's all I've got");

      expect(builder.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'closed', closed_by: 'user' }));
    });

    it('reports the step incomplete until all four core questions are closed', async () => {
      builder.first.mockResolvedValueOnce(threadFixture({ question_id: 'Q1' }));
      builder.returning.mockResolvedValueOnce([exchangeFixture({ id: 'ex-user', role: 'user' })]);
      builder.select.mockResolvedValueOnce([exchangeFixture({ id: 'ex-user', role: 'user' })]);
      mockRunTopicTurn.mockResolvedValueOnce({ reply: 'Ok.', closeTopic: false, closedBy: 'model' });
      builder.returning.mockResolvedValueOnce([exchangeFixture({ id: 'ex-assistant', role: 'assistant' })]);
      builder.first.mockResolvedValueOnce({ n: '2' }); // only 2 of the 4 core questions closed so far

      const outcome = await service.postUserMessage('user-1', 'app', 'partial');

      expect(outcome.complete).toBe(false);
    });
  });
});
