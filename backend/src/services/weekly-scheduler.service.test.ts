jest.mock('../db/connection', () => ({ db: jest.fn() }));
import { db } from '../db/connection';

jest.mock('./topic-selection.service');
import { TopicSelectionService } from './topic-selection.service';

jest.mock('./topic-conversation.service');
import { TopicConversationService } from './topic-conversation.service';

import { WeeklySchedulerService } from './weekly-scheduler.service';
import { Progression } from '../types';
import { getQuestion } from '../models/question-library';

function makeBuilder() {
  const builder: any = {};
  builder.where = jest.fn(() => builder);
  builder.whereNull = jest.fn(() => builder);
  builder.orWhere = jest.fn(() => builder);
  builder.whereIn = jest.fn(() => builder);
  builder.orderBy = jest.fn(() => builder);
  builder.update = jest.fn();
  builder.select = jest.fn();
  builder.first = jest.fn();
  return builder;
}

function progressionRow(overrides: Partial<Progression> = {}): Progression {
  return {
    id: 'prog-1',
    user_id: 'user-1',
    tier: 'sketch',
    dimensions_at_confidence: [],
    pace_preference: 'whenever',
    next_question_id: null,
    last_contact_at: null,
    paused_until: null,
    paused_indefinitely: false,
    unsubscribed_at: null,
    unanswered_count: 0,
    dormant_at: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides
  };
}

describe('WeeklySchedulerService', () => {
  let service: WeeklySchedulerService;
  let builder: ReturnType<typeof makeBuilder>;
  const mockDb = db as unknown as jest.Mock;
  const mockSelectNext = TopicSelectionService.prototype.selectNextQuestion as jest.Mock;
  const mockSendScheduledPrompt = TopicConversationService.prototype.sendScheduledPrompt as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new WeeklySchedulerService();
    builder = makeBuilder();
    mockDb.mockReturnValue(builder);
    mockSendScheduledPrompt.mockResolvedValue({});
  });

  describe('runWeeklyCheck', () => {
    it('is a no-op when nothing is eligible', async () => {
      builder.select.mockResolvedValueOnce([]); // loadEligibleCandidates

      const result = await service.runWeeklyCheck();

      expect(result).toEqual({ processed: 0, sent: 0, wentDormant: 0 });
      expect(mockSendScheduledPrompt).not.toHaveBeenCalled();
    });

    it('a never-contacted candidate is sent a freshly-selected question with no thread to continue', async () => {
      const question = getQuestion('Q1')!;
      builder.select.mockResolvedValueOnce([progressionRow({ last_contact_at: null })]); // loadEligibleCandidates
      builder.update.mockResolvedValueOnce(undefined); // unanswered_count reset to 0
      builder.first.mockResolvedValueOnce(undefined); // sendPayload: no open thread
      mockSelectNext.mockResolvedValueOnce(question);
      builder.update.mockResolvedValueOnce(undefined); // last_contact_at stamp

      const result = await service.runWeeklyCheck();

      expect(result).toEqual({ processed: 1, sent: 1, wentDormant: 0 });
      const [uid, threadArg, content, qid] = mockSendScheduledPrompt.mock.calls[0];
      expect(uid).toBe('user-1');
      expect(threadArg).toBeNull();
      expect(content).toContain(question.prompt);
      expect(content).toContain('/settings/schedule');
      expect(qid).toBe(question.id);
    });

    it('increments unanswered_count and still sends when a reply has not arrived but the dormancy threshold is not yet reached', async () => {
      builder.select.mockResolvedValueOnce([
        progressionRow({ last_contact_at: new Date('2026-08-01'), unanswered_count: 2 })
      ]);
      builder.select.mockResolvedValueOnce([{ id: 'thread-1' }]); // hasRepliedSince: threads for user
      builder.first.mockResolvedValueOnce(undefined); // hasRepliedSince: no reply row found
      builder.update.mockResolvedValueOnce(undefined); // unanswered_count -> 3
      builder.first.mockResolvedValueOnce(undefined); // sendPayload: no open thread
      const question = getQuestion('Q1')!;
      mockSelectNext.mockResolvedValueOnce(question);
      builder.update.mockResolvedValueOnce(undefined); // last_contact_at stamp

      const result = await service.runWeeklyCheck();

      expect(result).toEqual({ processed: 1, sent: 1, wentDormant: 0 });
      expect(builder.update).toHaveBeenCalledWith({ unanswered_count: 3 });
    });

    it('marks a candidate dormant on the 4th consecutive unanswered week and sends nothing', async () => {
      builder.select.mockResolvedValueOnce([
        progressionRow({ last_contact_at: new Date('2026-08-01'), unanswered_count: 3 })
      ]);
      builder.select.mockResolvedValueOnce([{ id: 'thread-1' }]); // hasRepliedSince: threads for user
      builder.first.mockResolvedValueOnce(undefined); // hasRepliedSince: no reply row found
      builder.update.mockResolvedValueOnce(undefined); // dormant update

      const result = await service.runWeeklyCheck();

      expect(result).toEqual({ processed: 1, sent: 0, wentDormant: 1 });
      expect(builder.update).toHaveBeenCalledWith(expect.objectContaining({ unanswered_count: 4, dormant_at: expect.any(Date) }));
      expect(mockSendScheduledPrompt).not.toHaveBeenCalled();
    });

    it('resets unanswered_count to 0 and continues an open thread when a reply has arrived since last contact', async () => {
      builder.select.mockResolvedValueOnce([
        progressionRow({ last_contact_at: new Date('2026-08-01'), unanswered_count: 2 })
      ]);
      builder.select.mockResolvedValueOnce([{ id: 'thread-1' }]); // hasRepliedSince: threads
      builder.first.mockResolvedValueOnce({ id: 'reply-1' }); // hasRepliedSince: a reply exists
      builder.update.mockResolvedValueOnce(undefined); // unanswered_count -> 0
      builder.first.mockResolvedValueOnce({ id: 'thread-1', question_id: 'Q1', opened_at: new Date() }); // sendPayload: open thread
      builder.first.mockResolvedValueOnce({ sent_at: new Date() }); // sendPayload: last exchange, recent
      builder.first.mockResolvedValueOnce({ text: 'my last answer' }); // sendPayload: last user exchange
      builder.update.mockResolvedValueOnce(undefined); // last_contact_at stamp

      const result = await service.runWeeklyCheck();

      expect(result).toEqual({ processed: 1, sent: 1, wentDormant: 0 });
      expect(builder.update).toHaveBeenCalledWith({ unanswered_count: 0 });
      const [, , continueContent] = mockSendScheduledPrompt.mock.calls[0];
      expect(continueContent).toContain('my last answer');
      expect(continueContent).toContain('/settings/schedule');
    });

    it('offers to close a thread idle for more than 21 days, quoting the next selected question instead of continuing', async () => {
      builder.select.mockResolvedValueOnce([progressionRow({ last_contact_at: null })]);
      builder.update.mockResolvedValueOnce(undefined); // unanswered_count -> 0
      builder.first.mockResolvedValueOnce({ id: 'thread-1', question_id: 'Q1', opened_at: new Date() }); // open thread
      const staleDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      builder.first.mockResolvedValueOnce({ sent_at: staleDate }); // last exchange, stale
      const nextQuestion = getQuestion('Q2')!;
      mockSelectNext.mockResolvedValueOnce(nextQuestion);
      builder.update.mockResolvedValueOnce(undefined); // last_contact_at stamp

      await service.runWeeklyCheck();

      const [, , content] = mockSendScheduledPrompt.mock.calls[0];
      expect(content).toContain(getQuestion('Q1')!.shortName);
      expect(content).toContain(nextQuestion.prompt);
    });

    it('sends a no-quote nudge when the open thread has no assistant exchange yet at all', async () => {
      builder.select.mockResolvedValueOnce([progressionRow({ last_contact_at: null })]);
      builder.update.mockResolvedValueOnce(undefined); // unanswered_count -> 0
      builder.first.mockResolvedValueOnce({ id: 'thread-1', question_id: 'Q1', opened_at: new Date() }); // open thread
      builder.first.mockResolvedValueOnce(undefined); // no exchange at all -> daysIdle Infinity -> offer-to-close path
      const nextQuestion = getQuestion('Q2')!;
      mockSelectNext.mockResolvedValueOnce(nextQuestion);
      builder.update.mockResolvedValueOnce(undefined);

      await service.runWeeklyCheck();

      const [, , offerContent] = mockSendScheduledPrompt.mock.calls[0];
      expect(offerContent).toContain('done for now');
      expect(offerContent).toContain('/settings/schedule');
    });
  });
});
