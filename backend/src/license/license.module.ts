import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LicenseService } from './license.service';
import { LicenseController } from './license.controller';
import { License } from './entities/license.entity';
import { LicenseActivation } from './entities/license-activation.entity';
import { LicenseCryptoService } from './license-crypto.service';
import { User } from '../auth/entities/user.entity';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([License, LicenseActivation, User]),
    AuditModule,
  ],
  providers: [LicenseService, LicenseCryptoService],
  controllers: [LicenseController],
  exports: [LicenseService],
})
export class LicenseModule {}
