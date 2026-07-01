import { Controller, Get, UseGuards, HttpCode, HttpStatus, Query } from '@nestjs/common';
import { TrendsService } from './trends.service';
import { LatestTrendsQueryDto } from './dto/latest-trends-query.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('trends')
@UseGuards(JwtAuthGuard)
export class TrendsController {
  constructor(private readonly trendsService: TrendsService) {}

  /**
   * GET /trends/latest?platform=tiktok&limit=10&region=vn
   * Returns a flat filtered list for the Trend Engine dashboard.
   */
  @Get('latest')
  @HttpCode(HttpStatus.OK)
  async getLatest(@CurrentUser() user: any, @Query() query: LatestTrendsQueryDto) {
    const data = await this.trendsService.getLatest(user.tenantId, query);
    return {
      code: 200,
      data,
      msg: 'ok',
    };
  }
}
