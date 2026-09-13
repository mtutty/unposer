jest.mock('../db/connection', () => ({ db: jest.fn() }));
import { db } from '../db/connection';
import { RequisitionService } from './requisition.service';

function makeBuilder() {
  const builder: any = {};
  builder.where = jest.fn(() => builder);
  builder.orderBy = jest.fn(); // terminal for list()
  builder.first = jest.fn(); // terminal for get()'s lookup
  builder.insert = jest.fn(() => builder);
  builder.update = jest.fn(() => builder);
  builder.returning = jest.fn(); // terminal for create/update
  return builder;
}

describe('RequisitionService', () => {
  let service: RequisitionService;
  let builder: ReturnType<typeof makeBuilder>;

  beforeEach(() => {
    service = new RequisitionService();
    builder = makeBuilder();
    (db as unknown as jest.Mock).mockReturnValue(builder);
  });

  describe('list', () => {
    it("scopes to the caller's own requisitions, newest first", async () => {
      builder.orderBy.mockResolvedValueOnce([{ id: 'r1' }]);

      const result = await service.list('u1');

      expect(db).toHaveBeenCalledWith('job_requisitions');
      expect(builder.where).toHaveBeenCalledWith({ user_id: 'u1' });
      expect(builder.orderBy).toHaveBeenCalledWith('created_at', 'desc');
      expect(result).toEqual([{ id: 'r1' }]);
    });
  });

  describe('create', () => {
    it('inserts a draft requisition owned by the caller', async () => {
      builder.returning.mockResolvedValueOnce([{ id: 'r1', status: 'draft' }]);

      const result = await service.create('u1', { title: 'Engineer', description: 'Build things' });

      expect(builder.insert).toHaveBeenCalledWith(
        expect.objectContaining({ user_id: 'u1', title: 'Engineer', description: 'Build things', requirements: null })
      );
      expect(result).toEqual({ id: 'r1', status: 'draft' });
    });
  });

  describe('get', () => {
    it('throws NOT_FOUND when no requisition matches this owner', async () => {
      builder.first.mockResolvedValueOnce(undefined);

      await expect(service.get('u1', 'r1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(builder.where).toHaveBeenCalledWith({ id: 'r1', user_id: 'u1' });
    });

    it('returns the requisition when owned by the caller', async () => {
      builder.first.mockResolvedValueOnce({ id: 'r1', user_id: 'u1' });

      const result = await service.get('u1', 'r1');

      expect(result).toEqual({ id: 'r1', user_id: 'u1' });
    });
  });

  describe('update', () => {
    it('refuses to edit a requisition that is no longer draft', async () => {
      builder.first.mockResolvedValueOnce({ id: 'r1', user_id: 'u1', status: 'active' });

      await expect(service.update('u1', 'r1', { title: 'New title' })).rejects.toMatchObject({ code: 'NOT_DRAFT' });
      expect(builder.update).not.toHaveBeenCalled();
    });

    it('updates only the provided fields on a draft requisition', async () => {
      builder.first.mockResolvedValueOnce({ id: 'r1', user_id: 'u1', status: 'draft' });
      builder.returning.mockResolvedValueOnce([{ id: 'r1', title: 'New title' }]);

      const result = await service.update('u1', 'r1', { title: 'New title' });

      expect(builder.update).toHaveBeenCalledWith(expect.objectContaining({ title: 'New title' }));
      expect(builder.update).not.toHaveBeenCalledWith(expect.objectContaining({ description: expect.anything() }));
      expect(result).toEqual({ id: 'r1', title: 'New title' });
    });
  });
});
