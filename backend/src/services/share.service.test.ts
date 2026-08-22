jest.mock('../db/connection', () => ({ db: jest.fn() }));
import { db } from '../db/connection';

jest.mock('./progression.service');
import { ProgressionService } from './progression.service';

import { ShareService } from './share.service';

function makeBuilder() {
  const builder: any = {};
  builder.where = jest.fn(() => builder);
  builder.insert = jest.fn(() => builder);
  builder.returning = jest.fn();
  builder.first = jest.fn();
  return builder;
}

describe('ShareService.createLink — flow addendum §7 tier gate', () => {
  let service: ShareService;
  let builder: ReturnType<typeof makeBuilder>;
  const mockDb = db as unknown as jest.Mock;
  const mockGetTier = ProgressionService.prototype.getTier as jest.Mock;
  const mockGetTemporalDepthSummary = ProgressionService.prototype.getTemporalDepthSummary as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ShareService();
    builder = makeBuilder();
    mockDb.mockReturnValue(builder);
    builder.first.mockResolvedValue({ status: 'approved' }); // candidate_profiles lookup
  });

  it('rejects with TIER_TOO_LOW for a Sketch-tier profile, naming the still-thin dimensions', async () => {
    mockGetTier.mockResolvedValueOnce('sketch');
    mockGetTemporalDepthSummary.mockResolvedValueOnce({ dimensionsAtConfidence: ['openness'], singleSessionDimensions: [] });

    await expect(service.createLink('user-1', 14)).rejects.toMatchObject({
      code: 'TIER_TOO_LOW',
      details: expect.objectContaining({ tier: 'sketch', thinDimensions: expect.arrayContaining(['work_style']) })
    });
    expect(builder.insert).not.toHaveBeenCalled();
  });

  it.each(['core_persona', 'in_depth', 'ongoing'])('allows link creation at tier "%s"', async (tier) => {
    mockGetTier.mockResolvedValueOnce(tier);
    builder.returning.mockResolvedValueOnce([{ id: 'link-1', token: 'tok' }]);

    const link = await service.createLink('user-1', 14);

    expect(link).toEqual({ id: 'link-1', token: 'tok' });
  });

  it('never reaches the tier check when the profile is not approved', async () => {
    builder.first.mockResolvedValueOnce(undefined);

    await expect(service.createLink('user-1', 14)).rejects.toMatchObject({ code: 'PROFILE_NOT_APPROVED' });
    expect(mockGetTier).not.toHaveBeenCalled();
  });
});
