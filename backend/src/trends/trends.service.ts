import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Trend } from './entities/trend.entity';
import { LatestTrendsQueryDto } from './dto/latest-trends-query.dto';

export interface LatestTrendResponse {
  id: number;
  title: string;
  views: number;
  platform: string;
  region: string;
  crawled_at: Date;
}

@Injectable()
export class TrendsService {
  constructor(
    @InjectRepository(Trend)
    private readonly trendRepository: Repository<Trend>,
  ) {}

  async getLatest(tenantId: number, query: LatestTrendsQueryDto = new LatestTrendsQueryDto()): Promise<LatestTrendResponse[]> {
    const platform = query.platform || 'tiktok';
    const region = query.region || 'vn';
    const limit = query.limit ?? 10;

    const rows = await this.trendRepository
      .createQueryBuilder('trend')
      .where('(trend.tenant_id = :tenantId OR trend.tenant_id IS NULL)', { tenantId })
      .andWhere('trend.platform = :platform', { platform })
      .andWhere('(trend.region = :region OR (trend.region IS NULL AND :region = :globalRegion))', {
        region,
        globalRegion: 'global',
      })
      .orderBy('COALESCE(trend.crawled_at, trend.extracted_at)', 'DESC')
      .addOrderBy('COALESCE(trend.views, trend.volume)', 'DESC')
      .limit(limit)
      .getMany();

    return rows.map((trend) => this.toLatestTrend(trend));
  }

  private toLatestTrend(trend: Trend): LatestTrendResponse {
    return {
      id: trend.id,
      title: trend.title || trend.keyword,
      views: trend.views ?? trend.volume ?? 0,
      platform: trend.platform,
      region: trend.region || 'global',
      crawled_at: trend.crawled_at || trend.extracted_at,
    };
  }
}
