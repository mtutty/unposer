jest.mock('../db/connection', () => ({ db: jest.fn() }));
import { db } from '../db/connection';
import { AdminService } from './admin.service';

function makeBuilder() {
  const builder: any = {};
  builder.where = jest.fn(() => builder);
  builder.andWhere = jest.fn(() => builder);
  builder.whereILike = jest.fn(() => builder);
  builder.orWhereILike = jest.fn(() => builder);
  builder.orderBy = jest.fn(() => builder);
  builder.limit = jest.fn(() => builder);
  builder.offset = jest.fn(); // terminal for the list query
  builder.count = jest.fn(() => builder);
  builder.first = jest.fn(); // terminal for the count query / getUser
  builder.update = jest.fn(() => builder);
  builder.returning = jest.fn(); // terminal for updateUser
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
});
