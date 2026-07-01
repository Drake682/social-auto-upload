import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { AccountsService } from './accounts.service';
import { AccountsHealthScheduler } from './health.scheduler';
import { AccountsController } from './accounts.controller';
import { Account } from './entities/account.entity';
import { CryptoService } from '../common/crypto/crypto.service';

@Module({
  imports: [TypeOrmModule.forFeature([Account]), HttpModule],
  providers: [AccountsService, AccountsHealthScheduler, CryptoService],
  controllers: [AccountsController],
  exports: [AccountsService],
})
export class AccountsModule {}
