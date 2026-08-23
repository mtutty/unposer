jest.mock('../db/connection', () => ({ db: jest.fn() }));
import { db } from '../db/connection';
import { AdminService } from './admin.service';
import { FlowService } from './flow.service';
import { ResumeService } from './resume.service';
import { LogisticsService } from './logistics.service';
import { ConversationService } from './conversation.service';
import { TopicConversationService } from './topic-conversation.service';
import { SandboxService } from './sandbox.service';
import { ShareService } from './share.service';
import { ProfileService } from './profile.service';
import { EmailService } from './email.service';

function makeBuilder() {
  const builder: any = {};
  builder.where = jest.fn(() => builder);
  builder.andWhere = jest.fn(() => builder);
  builder.whereILike = jest.fn(() => builder);
  builder.orWhereILike = jest.fn(() => builder);
  builder.whereRaw = jest.fn(() => builder);
  builder.orderBy = jest.fn(() => builder);
  builder.limit = jest.fn(() => builder);
  builder.offset = jest.fn(); // terminal for the list query
  builder.count = jest.fn(() => builder);
  builder.first = jest.fn(); // terminal for the count query / getUser / email lookup
  builder.update = jest.fn(() => builder);
  builder.insert = jest.fn(() => builder);
  builder.delete = jest.fn(); // terminal for revokeInvite
  builder.returning = jest.fn(); // terminal for updateUser/inviteUser
  return builder;
}

describe('AdminService', () => {
  let service: AdminService;
  let builder: ReturnType<typeof makeBuilder>;
  const mockDb = db as unknown as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AdminService();
    builder = makeBuilder();
    mockDb.mockReturnValue(builder);
  });

  describe('listUsers', () => {
    it('applies role/status filters and paginates with defaults', async () => {
      builder.offset.mockResolvedValueOnce([{ id: 'u1' }]);
      builder.first.mockResolvedValueOnce({ n: '1' });

      const result = await service.listUsers({ role: 'admin', status: 'active' });

      expect(builder.andWhere).toHaveBeenCalledWith({ role: 'admin' });
      expect(builder.andWhere).toHaveBeenCalledWith({ status: 'active' });
      expect(builder.orderBy).toHaveBeenCalledWith('created_at', 'desc');
      expect(builder.limit).toHaveBeenCalledWith(50);
      expect(builder.offset).toHaveBeenCalledWith(0);
      expect(result).toEqual({ users: [{ id: 'u1' }], total: 1 });
    });

    it('applies a q filter as a case-insensitive email/name search', async () => {
      builder.offset.mockResolvedValueOnce([]);
      builder.first.mockResolvedValueOnce({ n: '0' });

      await service.listUsers({ q: 'mike' });

      expect(builder.where).toHaveBeenCalledWith(expect.any(Function));
    });

    it('honors an explicit limit/offset', async () => {
      builder.offset.mockResolvedValueOnce([]);
      builder.first.mockResolvedValueOnce({ n: '0' });

      await service.listUsers({ limit: 10, offset: 20 });

      expect(builder.limit).toHaveBeenCalledWith(10);
      expect(builder.offset).toHaveBeenCalledWith(20);
    });
  });

  describe('getUser', () => {
    it('returns the matching user', async () => {
      builder.first.mockResolvedValueOnce({ id: 'u1', email: 'a@b.com' });

      const result = await service.getUser('u1');

      expect(mockDb).toHaveBeenCalledWith('users');
      expect(builder.where).toHaveBeenCalledWith({ id: 'u1' });
      expect(result).toEqual({ id: 'u1', email: 'a@b.com' });
    });

    it('returns undefined when no user matches', async () => {
      builder.first.mockResolvedValueOnce(undefined);

      expect(await service.getUser('missing')).toBeUndefined();
    });
  });

  describe('updateUser', () => {
    it('updates only the provided fields', async () => {
      builder.returning.mockResolvedValueOnce([{ id: 'u1', role: 'admin', status: 'active' }]);

      const result = await service.updateUser('u1', { role: 'admin' });

      expect(builder.update).toHaveBeenCalledWith(expect.objectContaining({ role: 'admin' }));
      expect(builder.update).toHaveBeenCalledWith(expect.not.objectContaining({ status: expect.anything() }));
      expect(result).toEqual({ id: 'u1', role: 'admin', status: 'active' });
    });

    it('throws NOT_FOUND when the user does not exist', async () => {
      builder.returning.mockResolvedValueOnce([]);

      await expect(service.updateUser('missing', { status: 'suspended' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  describe('getUserDetail', () => {
    it('throws NOT_FOUND when the user does not exist', async () => {
      builder.first.mockResolvedValueOnce(undefined);

      await expect(service.getUserDetail('missing')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('aggregates every accumulated-data source for the user', async () => {
      builder.first
        .mockResolvedValueOnce({ id: 'u1', email: 'a@b.com', role: 'user' }) // getUser
        .mockResolvedValueOnce({ id: 'fp1', current_step: 'resume' }); // flow_progress

      jest.spyOn(ResumeService.prototype, 'getResume').mockResolvedValueOnce({ id: 'r1' } as any);
      jest.spyOn(LogisticsService.prototype, 'getResponse').mockResolvedValueOnce({ id: 'l1' } as any);
      jest.spyOn(ConversationService.prototype, 'getHistory').mockResolvedValueOnce([{ id: 'm1' }] as any);
      jest.spyOn(TopicConversationService.prototype, 'getFullTranscript').mockResolvedValueOnce([{ id: 'm2' }] as any);
      jest.spyOn(ProfileService.prototype, 'getProfile').mockResolvedValueOnce({ id: 'p1' } as any);
      jest.spyOn(SandboxService.prototype, 'getHistory').mockResolvedValueOnce([{ id: 's1' }] as any);
      jest.spyOn(ShareService.prototype, 'listLinks').mockResolvedValueOnce([{ id: 'sl1' }] as any);

      const result = await service.getUserDetail('u1');

      expect(result).toEqual({
        user: { id: 'u1', email: 'a@b.com', role: 'user' },
        flowProgress: { id: 'fp1', current_step: 'resume' },
        resume: { id: 'r1' },
        logisticsResponse: { id: 'l1' },
        logisticsConversation: [{ id: 'm1' }],
        deepPromptsTranscript: [{ id: 'm2' }],
        profile: { id: 'p1' },
        sandboxHistory: [{ id: 's1' }],
        shareLinks: [{ id: 'sl1' }]
      });
    });
  });

  describe('resetUserData', () => {
    it('throws NOT_FOUND when the user does not exist', async () => {
      builder.first.mockResolvedValueOnce(undefined);

      await expect(service.resetUserData('missing', 'a@b.com')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('refuses to reset an admin account', async () => {
      builder.first.mockResolvedValueOnce({ id: 'u1', email: 'a@b.com', role: 'admin' });

      await expect(service.resetUserData('u1', 'a@b.com')).rejects.toMatchObject({ code: 'CANNOT_RESET_ADMIN' });
    });

    it('refuses when the confirmation email does not match', async () => {
      builder.first.mockResolvedValueOnce({ id: 'u1', email: 'a@b.com', role: 'user' });

      await expect(service.resetUserData('u1', 'wrong@b.com')).rejects.toMatchObject({ code: 'CONFIRMATION_MISMATCH' });
    });

    it('wipes the candidate data and returns the user on a matching confirmation', async () => {
      builder.first.mockResolvedValueOnce({ id: 'u1', email: 'a@b.com', role: 'user' });
      const resetSpy = jest.spyOn(FlowService.prototype, 'resetProgress').mockResolvedValueOnce();

      const result = await service.resetUserData('u1', 'a@b.com');

      expect(resetSpy).toHaveBeenCalledWith('u1');
      expect(result).toEqual({ id: 'u1', email: 'a@b.com', role: 'user' });
    });
  });

  describe('inviteUser', () => {
    it('refuses when the email already belongs to a non-invited account', async () => {
      builder.first.mockResolvedValueOnce({ id: 'u1', email: 'a@b.com', role: 'user' });

      await expect(service.inviteUser('a@b.com', 'admin-1')).rejects.toMatchObject({ code: 'EMAIL_IN_USE' });
    });

    it('creates a role=invited row and sends the invite email when the email is new', async () => {
      builder.first.mockResolvedValueOnce(undefined);
      builder.returning.mockResolvedValueOnce([{ id: 'u2', email: 'new@b.com', role: 'invited' }]);
      const sendSpy = jest.spyOn(EmailService.prototype, 'sendInvite').mockResolvedValueOnce();

      const result = await service.inviteUser('new@b.com', 'admin-1', 'Welcome!');

      expect(builder.insert).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'new@b.com', role: 'invited', invited_by: 'admin-1' })
      );
      expect(sendSpy).toHaveBeenCalledWith('new@b.com', 'Welcome!');
      expect(result).toEqual({ id: 'u2', email: 'new@b.com', role: 'invited' });
    });

    it('re-sends the invite (updates invited_at) instead of erroring when already pending', async () => {
      builder.first.mockResolvedValueOnce({ id: 'u2', email: 'new@b.com', role: 'invited' });
      builder.returning.mockResolvedValueOnce([{ id: 'u2', email: 'new@b.com', role: 'invited' }]);
      const sendSpy = jest.spyOn(EmailService.prototype, 'sendInvite').mockResolvedValueOnce();

      await service.inviteUser('new@b.com', 'admin-1');

      expect(builder.insert).not.toHaveBeenCalled();
      expect(builder.update).toHaveBeenCalledWith(expect.objectContaining({ invited_by: 'admin-1' }));
      expect(sendSpy).toHaveBeenCalledWith('new@b.com', undefined);
    });
  });

  describe('revokeInvite', () => {
    it('throws NOT_FOUND when the user does not exist', async () => {
      builder.first.mockResolvedValueOnce(undefined);

      await expect(service.revokeInvite('missing')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('refuses to revoke a non-invited account', async () => {
      builder.first.mockResolvedValueOnce({ id: 'u1', email: 'a@b.com', role: 'user' });

      await expect(service.revokeInvite('u1')).rejects.toMatchObject({ code: 'NOT_AN_INVITE' });
      expect(builder.delete).not.toHaveBeenCalled();
    });

    it('deletes a pending invite', async () => {
      builder.first.mockResolvedValueOnce({ id: 'u2', email: 'new@b.com', role: 'invited' });

      await service.revokeInvite('u2');

      expect(builder.where).toHaveBeenCalledWith({ id: 'u2' });
      expect(builder.delete).toHaveBeenCalled();
    });
  });
});
