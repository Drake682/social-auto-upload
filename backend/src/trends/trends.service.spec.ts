import { Trend } from './entities/trend.entity';
import { TrendsService } from './trends.service';

describe('TrendsService', () => {
  let service: TrendsService;
  let rows: Trend[];
  let queryBuilder: any;

  const makeTrend = (overrides: Partial<Trend>): Trend =>
    ({
      id: 1,
      tenant_id: null,
      platform: 'tiktok',
      keyword: 'trend',
      title: 'Trend',
      trend_type: 'video',
      volume: 100,
      views: 100,
      region: 'vn',
      run_id: '00000000-0000-0000-0000-000000000001',
      source_url: null,
      extracted_at: new Date('2026-07-01T00:00:00.000Z'),
      crawled_at: new Date('2026-07-01T00:00:00.000Z'),
      ...overrides,
    }) as Trend;

  const createQueryBuilder = (seedRows: Trend[]) => {
    const state: {
      params: Record<string, any>;
      limit?: number;
    } = { params: {} };

    const qb: any = {
      where: jest.fn((_condition: string, params?: Record<string, any>) => {
        Object.assign(state.params, params);
        return qb;
      }),
      andWhere: jest.fn((_condition: string, params?: Record<string, any>) => {
        Object.assign(state.params, params);
        return qb;
      }),
      orderBy: jest.fn(() => qb),
      addOrderBy: jest.fn(() => qb),
      limit: jest.fn((limit: number) => {
        state.limit = limit;
        return qb;
      }),
      getMany: jest.fn(async () => {
        const tenantId = state.params.tenantId;
        const platform = state.params.platform;
        const region = state.params.region;
        const limit = state.limit ?? seedRows.length;

        return seedRows
          .filter((trend) => trend.tenant_id === tenantId || trend.tenant_id === null)
          .filter((trend) => trend.platform === platform)
          .filter((trend) => trend.region === region || (trend.region === null && region === 'global'))
          .sort((left, right) => {
            const leftDate = (left.crawled_at || left.extracted_at).getTime();
            const rightDate = (right.crawled_at || right.extracted_at).getTime();
            if (rightDate !== leftDate) return rightDate - leftDate;
            return (right.views ?? right.volume ?? 0) - (left.views ?? left.volume ?? 0);
          })
          .slice(0, limit);
      }),
    };

    return qb;
  };

  beforeEach(() => {
    rows = [];
    queryBuilder = createQueryBuilder(rows);
    service = new TrendsService({ createQueryBuilder: jest.fn(() => queryBuilder) } as any);
  });

  it('filters by platform and returns only matching rows', async () => {
    rows.push(
      makeTrend({ id: 1, platform: 'tiktok', title: 'TikTok Trend' }),
      makeTrend({ id: 2, platform: 'facebook', title: 'Facebook Trend' }),
    );

    const result = await service.getLatest(7, { platform: 'facebook', region: 'vn', limit: 10 });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: 2, platform: 'facebook', title: 'Facebook Trend' });
    expect(queryBuilder.andWhere).toHaveBeenCalledWith('trend.platform = :platform', { platform: 'facebook' });
  });

  it('filters by region and returns only matching rows', async () => {
    rows.push(
      makeTrend({ id: 1, region: 'vn', title: 'VN Trend' }),
      makeTrend({ id: 2, region: 'us', title: 'US Trend' }),
    );

    const result = await service.getLatest(7, { platform: 'tiktok', region: 'us', limit: 10 });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: 2, region: 'us', title: 'US Trend' });
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      '(trend.region = :region OR (trend.region IS NULL AND :region = :globalRegion))',
      { region: 'us', globalRegion: 'global' },
    );
  });

  it('caps latest trends to the requested limit', async () => {
    for (let index = 1; index <= 12; index += 1) {
      rows.push(
        makeTrend({
          id: index,
          keyword: `trend-${index}`,
          title: `Trend ${index}`,
          views: index,
          volume: index,
          crawled_at: new Date(`2026-07-${String(index).padStart(2, '0')}T00:00:00.000Z`),
        }),
      );
    }

    const result = await service.getLatest(7, { platform: 'tiktok', region: 'vn', limit: 10 });

    expect(result).toHaveLength(10);
    expect(queryBuilder.limit).toHaveBeenCalledWith(10);
    expect(result[0].id).toBe(12);
    expect(result[9].id).toBe(3);
  });

  it('keeps query tenant-scoped while including global rows', async () => {
    rows.push(
      makeTrend({ id: 1, tenant_id: 7, title: 'Tenant Trend' }),
      makeTrend({ id: 2, tenant_id: null, title: 'Global Trend' }),
      makeTrend({ id: 3, tenant_id: 8, title: 'Other Tenant Trend' }),
    );

    const result = await service.getLatest(7, { platform: 'tiktok', region: 'vn', limit: 10 });

    expect(result.map((trend) => trend.title).sort()).toEqual(['Global Trend', 'Tenant Trend']);
    expect(queryBuilder.where).toHaveBeenCalledWith('(trend.tenant_id = :tenantId OR trend.tenant_id IS NULL)', {
      tenantId: 7,
    });
  });

  it('falls back to legacy keyword and volume fields when title and views are null', async () => {
    const extractedAt = new Date('2026-07-01T12:00:00.000Z');
    rows.push(
      makeTrend({
        id: 1,
        keyword: 'legacy keyword',
        title: null,
        volume: 123,
        views: null,
        region: null,
        extracted_at: extractedAt,
        crawled_at: null,
      }),
    );

    const result = await service.getLatest(7, { platform: 'tiktok', region: 'global', limit: 10 });

    expect(result).toEqual([
      {
        id: 1,
        title: 'legacy keyword',
        views: 123,
        platform: 'tiktok',
        region: 'global',
        crawled_at: extractedAt,
      },
    ]);
  });
});
