jest.mock('../db/connection', () => ({ db: jest.fn() }));
jest.mock('../ai/elicitation.chain', () => ({ runElicitationTurn: jest.fn() }));
jest.mock('./requisition-culture-signal.service');

import { db } from '../db/connection';
import { runElicitationTurn } from '../ai/elicitation.chain';
import { RequisitionCultureSignalService } from './requisition-culture-signal.service';
import { RequisitionConversationService } from './requisition-conversation.service';
import { RequisitionMessage } from '../types';

const mockDb = db as unknown as jest.Mock;
const mockRunTurn = runElicitationTurn as jest.Mock;

function messageFixture(overrides: Partial<RequisitionMessage> = {}): RequisitionMessage {
  return {
    id: 'msg-1',
    thread_id: 'thread-1',
    requisition_id: 'req-1',
    role: 'user',
    content: 'hello',
    metadata: {},
    created_at: new Date(),
    ...overrides
  };
}

// Per-table builder stubs — each table this service touches gets its own minimal chainable mock
// rather than one shared builder, since the tables' shapes/terminal methods differ.
function makeThreadsBuilder() {
  const b: any = {};
  b.where = jest.fn(() => b);
  b.first = jest.fn();
  b.insert = jest.fn(() => b);
  b.update = jest.fn(() => b);
  b.returning = jest.fn();
  return b;
}
function makeMessagesBuilder() {
  const b: any = {};
  b.where = jest.fn(() => b);
  b.orderBy = jest.fn();
  b.insert = jest.fn(() => Promise.resolve());
  return b;
}
function makeRequisitionsBuilder() {
  const b: any = {};
  b.where = jest.fn(() => b);
  b.update = jest.fn(() => Promise.resolve());
  return b;
}

describe('RequisitionConversationService', () => {
  let service: RequisitionConversationService;
  let threads: ReturnType<typeof makeThreadsBuilder>;
  let messages: ReturnType<typeof makeMessagesBuilder>;
  let requisitions: ReturnType<typeof makeRequisitionsBuilder>;
  let mockCultureSignal: jest.Mocked<RequisitionCultureSignalService>;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new RequisitionConversationService();
    mockCultureSignal = (RequisitionCultureSignalService as jest.MockedClass<typeof RequisitionCultureSignalService>).mock
      .instances[0] as jest.Mocked<RequisitionCultureSignalService>;

    threads = makeThreadsBuilder();
    messages = makeMessagesBuilder();
    requisitions = makeRequisitionsBuilder();
    mockDb.mockImplementation((table: string) => {
      if (table === 'requisition_threads') return threads;
      if (table === 'requisition_messages') return messages;
      if (table === 'job_requisitions') return requisitions;
      throw new Error(`unexpected table in test: ${table}`);
    });
  });

  describe('getOrCreateThread', () => {
    it('returns the existing thread without inserting when one already exists', async () => {
      threads.first.mockResolvedValueOnce({ id: 'thread-1', requisition_id: 'req-1', status: 'active', message_count: 0 });

      const thread = await service.getOrCreateThread('req-1');

      expect(threads.insert).not.toHaveBeenCalled();
      expect(thread).toEqual(expect.objectContaining({ id: 'thread-1' }));
    });

    it('creates a thread when none exists yet', async () => {
      threads.first.mockResolvedValueOnce(undefined);
      threads.returning.mockResolvedValueOnce([{ id: 'thread-1', requisition_id: 'req-1', status: 'active', message_count: 0 }]);

      const thread = await service.getOrCreateThread('req-1');

      expect(threads.insert).toHaveBeenCalledWith({ requisition_id: 'req-1' });
      expect(thread.id).toBe('thread-1');
    });
  });

  describe('ensureOpeningMessage', () => {
    it('returns existing history without calling the LLM when the thread already has messages', async () => {
      threads.first.mockResolvedValueOnce({ id: 'thread-1', requisition_id: 'req-1', status: 'active', message_count: 1 });
      messages.orderBy.mockResolvedValueOnce([messageFixture({ role: 'assistant', content: 'hi' })]);

      const result = await service.ensureOpeningMessage('req-1');

      expect(mockRunTurn).not.toHaveBeenCalled();
      expect(result).toHaveLength(1);
    });

    it('generates and persists an opener, setting message_count to 1, when the thread is empty', async () => {
      threads.first.mockResolvedValueOnce({ id: 'thread-1', requisition_id: 'req-1', status: 'active', message_count: 0 });
      messages.orderBy.mockResolvedValueOnce([]);
      mockRunTurn.mockResolvedValueOnce({ reply: 'Tell me about the team.', extracted: {}, complete: false });
      messages.returning = jest.fn().mockResolvedValueOnce([messageFixture({ role: 'assistant', content: 'Tell me about the team.' })]);
      messages.insert = jest.fn(() => messages);

      const result = await service.ensureOpeningMessage('req-1');

      expect(mockRunTurn).toHaveBeenCalledWith(expect.objectContaining({ history: [], knownData: {}, channel: 'app' }));
      expect(messages.insert).toHaveBeenCalledWith(
        expect.objectContaining({ thread_id: 'thread-1', requisition_id: 'req-1', role: 'assistant', content: 'Tell me about the team.' })
      );
      expect(threads.update).toHaveBeenCalledWith(expect.objectContaining({ message_count: 1 }));
      expect(result[0].content).toBe('Tell me about the team.');
    });
  });

  describe('postUserMessage', () => {
    it('throws THREAD_COMPLETE without inserting anything when the thread is already complete', async () => {
      threads.first.mockResolvedValueOnce({ id: 'thread-1', requisition_id: 'req-1', status: 'complete', message_count: 4 });

      await expect(service.postUserMessage('req-1', 'hi')).rejects.toMatchObject({ code: 'THREAD_COMPLETE' });
      expect(messages.insert).not.toHaveBeenCalled();
    });

    it('folds prior assistant metadata into knownData and passes recent history to the LLM', async () => {
      threads.first.mockResolvedValueOnce({ id: 'thread-1', requisition_id: 'req-1', status: 'active', message_count: 2 });
      messages.orderBy.mockResolvedValueOnce([
        messageFixture({ id: '1', role: 'user', content: 'Team of 5.' }),
        messageFixture({ id: '2', role: 'assistant', content: 'Got it.', metadata: { organizational: 'Team of 5' } }),
        messageFixture({ id: '3', role: 'user', content: 'We just shipped v2.' })
      ]);
      mockRunTurn.mockResolvedValueOnce({ reply: 'What does success look like?', extracted: { situational: 'Shipped v2' }, complete: false });
      threads.returning.mockResolvedValueOnce([{ id: 'thread-1', requisition_id: 'req-1', status: 'active', message_count: 4 }]);
      const assistantInsertBuilder: any = { returning: jest.fn().mockResolvedValueOnce([messageFixture({ role: 'assistant' })]) };
      messages.insert = jest.fn(() => assistantInsertBuilder);

      await service.postUserMessage('req-1', 'We just shipped v2.');

      expect(mockRunTurn).toHaveBeenCalledWith(
        expect.objectContaining({
          knownData: { organizational: 'Team of 5' },
          history: [
            { role: 'user', content: 'Team of 5.' },
            { role: 'assistant', content: 'Got it.' },
            { role: 'user', content: 'We just shipped v2.' }
          ]
        })
      );
      expect(requisitions.update).not.toHaveBeenCalled();
      expect(mockCultureSignal.regenerate).not.toHaveBeenCalled();
    });

    it('activates the requisition and kicks off culture-signal regeneration when the turn completes', async () => {
      threads.first.mockResolvedValueOnce({ id: 'thread-1', requisition_id: 'req-1', status: 'active', message_count: 6 });
      messages.orderBy.mockResolvedValueOnce([messageFixture()]);
      mockRunTurn.mockResolvedValueOnce({ reply: 'All set!', extracted: {}, complete: true });
      threads.returning.mockResolvedValueOnce([{ id: 'thread-1', requisition_id: 'req-1', status: 'complete', message_count: 8 }]);
      const assistantInsertBuilder: any = { returning: jest.fn().mockResolvedValueOnce([messageFixture({ role: 'assistant', content: 'All set!' })]) };
      messages.insert = jest.fn(() => assistantInsertBuilder);
      mockCultureSignal.regenerate.mockResolvedValueOnce([]);

      const outcome = await service.postUserMessage('req-1', 'that covers it');

      expect(requisitions.where).toHaveBeenCalledWith({ id: 'req-1' });
      expect(requisitions.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'active' }));
      expect(mockCultureSignal.regenerate).toHaveBeenCalledWith('req-1');
      expect(outcome.complete).toBe(true);
      expect(outcome.thread.status).toBe('complete');
    });

    it('never rejects the turn when culture-signal regeneration itself fails', async () => {
      threads.first.mockResolvedValueOnce({ id: 'thread-1', requisition_id: 'req-1', status: 'active', message_count: 6 });
      messages.orderBy.mockResolvedValueOnce([messageFixture()]);
      mockRunTurn.mockResolvedValueOnce({ reply: 'All set!', extracted: {}, complete: true });
      threads.returning.mockResolvedValueOnce([{ id: 'thread-1', requisition_id: 'req-1', status: 'complete', message_count: 8 }]);
      const assistantInsertBuilder: any = { returning: jest.fn().mockResolvedValueOnce([messageFixture({ role: 'assistant' })]) };
      messages.insert = jest.fn(() => assistantInsertBuilder);
      mockCultureSignal.regenerate.mockRejectedValueOnce(new Error('LLM blip'));

      await expect(service.postUserMessage('req-1', 'that covers it')).resolves.toEqual(
        expect.objectContaining({ complete: true })
      );
    });
  });
});
