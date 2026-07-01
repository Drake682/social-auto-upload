import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AccountsService } from './accounts.service';

const HEALTH_BATCH_SIZE = 10;
const HEALTH_BATCH_DELAY_MS = 500;

@Injectable()
export class AccountsHealthScheduler {
  private readonly logger = new Logger(AccountsHealthScheduler.name);

  constructor(private readonly accountsService: AccountsService) {}

  @Cron(CronExpression.EVERY_6_HOURS)
  async runSixHourlyHealthCheck() {
    let checked = 0;
    let alive = 0;
    let dead = 0;
    let unknown = 0;
    const processedIds: number[] = [];

    while (true) {
      const accounts = await this.accountsService.findHealthCheckBatch(HEALTH_BATCH_SIZE, processedIds);
      if (accounts.length === 0) {
        break;
      }

      for (const account of accounts) {
        processedIds.push(account.id);
        const result = await this.accountsService.checkAccountHealth(account);
        checked += 1;
        if (result.alive === true) alive += 1;
        else if (result.alive === false) dead += 1;
        else unknown += 1;
      }

      if (accounts.length < HEALTH_BATCH_SIZE) {
        break;
      }

      await this.delay(HEALTH_BATCH_DELAY_MS);
    }

    this.logger.log(`Account health check complete: checked=${checked}, alive=${alive}, dead=${dead}, unknown=${unknown}`);
  }

  private delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
