import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, IsNull, Not, In, Repository } from 'typeorm';
import { firstValueFrom } from 'rxjs';
import { timeout } from 'rxjs/operators';
import { Account } from './entities/account.entity';
import { AccountStatus } from './enums/account-status.enum';
import { Platform } from './enums/platform.enum';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
import { ListAccountsQueryDto } from './dto/list-accounts-query.dto';
import { ImportBulkDto } from './dto/import-bulk.dto';
import { CryptoService } from '../common/crypto/crypto.service';

@Injectable()
export class AccountsService {
  constructor(
    @InjectRepository(Account)
    private readonly accountRepository: Repository<Account>,
    private readonly cryptoService: CryptoService,
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Create a new social media account for the current user.
   * session_data is encrypted with AES-256-GCM before storage.
   */
  async create(userId: number, tenantId: number, createDto: CreateAccountDto) {
    const plaintext = JSON.stringify(createDto.session_data);
    const encryptedSession = this.cryptoService.encrypt(plaintext);

    const account = this.accountRepository.create({
      user_id: userId,
      tenant_id: tenantId,
      platform: createDto.platform,
      account_name: createDto.account_name,
      session_data: encryptedSession,
      proxy_url: createDto.proxy_url,
      status: AccountStatus.CHECKING,
    });

    const saved = await this.accountRepository.save(account);
    return this.toResponse(saved, false);
  }

  /**
   * Get all accounts for the current user.
   * session_data is NEVER included in response.
   */
  async findAll(userId: number, tenantId: number, query: ListAccountsQueryDto = new ListAccountsQueryDto()) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: FindOptionsWhere<Account> = {
      user_id: userId,
      tenant_id: tenantId,
    };

    if (query.platform) {
      where.platform = query.platform;
    }

    const [accounts, total] = await this.accountRepository.findAndCount({
      where,
      order: { created_at: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      items: accounts.map((acc) => this.toResponse(acc, false)),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get a single account. Tenant-scoped to prevent IDOR.
   * session_data is NEVER included.
   */
  async findOne(userId: number, tenantId: number, accountId: number) {
    const account = await this.findScopedAccount(userId, tenantId, accountId);
    return this.toResponse(account, false);
  }

  /**
   * Update account name or platform.
   * session_data is NEVER returned.
   */
  async update(userId: number, tenantId: number, accountId: number, updateDto: UpdateAccountDto) {
    const account = await this.findScopedAccount(userId, tenantId, accountId);
    const changes: Partial<Account> = {
      account_name: updateDto.account_name ?? account.account_name,
      platform: updateDto.platform ?? account.platform,
      proxy_url: updateDto.proxy_url ?? account.proxy_url,
    };

    if (updateDto.session_data) {
      changes.session_data = this.cryptoService.encrypt(JSON.stringify(updateDto.session_data));
    }

    await this.accountRepository.update(
      { id: accountId, user_id: userId, tenant_id: tenantId },
      changes,
    );

    const updated = await this.findScopedAccount(userId, tenantId, accountId);
    return this.toResponse(updated, false);
  }

  /**
   * Update account status. Tenant-scoped; callers can only touch their own account.
   */
  async updateStatus(userId: number, tenantId: number, accountId: number, status: AccountStatus, includeDecrypted = false) {
    await this.findScopedAccount(userId, tenantId, accountId);

    await this.accountRepository.update(
      { id: accountId, user_id: userId, tenant_id: tenantId },
      {
        status,
        last_health_check: new Date(),
      },
    );

    const updated = await this.findScopedAccount(userId, tenantId, accountId);
    return this.toResponse(updated, includeDecrypted);
  }

  /**
   * Delete an account.
   */
  async remove(userId: number, tenantId: number, accountId: number) {
    await this.findScopedAccount(userId, tenantId, accountId);
    await this.accountRepository.softDelete({ id: accountId, user_id: userId, tenant_id: tenantId });
    return { id: accountId };
  }

  async importBulk(userId: number, tenantId: number, importDto: ImportBulkDto) {
    const rows = this.parseImportRows(importDto);
    const report = {
      total: rows.length,
      success: 0,
      failed: 0,
      errors: [] as Array<{ row: number; reason: string }>,
    };

    for (const row of rows) {
      try {
        this.validateImportRow(row.data);
        await this.create(userId, tenantId, row.data as CreateAccountDto);
        report.success += 1;
      } catch (error: any) {
        report.failed += 1;
        report.errors.push({ row: row.row, reason: error?.message || 'Invalid row' });
      }
    }

    return report;
  }

  async checkHealth(userId: number, tenantId: number, accountId: number) {
    const account = await this.findScopedAccount(userId, tenantId, accountId);
    return this.checkAccountHealth(account);
  }

  async checkAccountHealth(account: Account) {
    const checkedAt = new Date();
    const uploaderUrl = this.configService.get<string>('UPLOADER_SERVICE_URL');

    if (!uploaderUrl) {
      await this.updateHealthStatus(account, AccountStatus.CHECKING, checkedAt);
      return { alive: null, checked_at: checkedAt.toISOString(), note: 'UPLOADER_SERVICE_URL not configured' };
    }

    try {
      const response = await firstValueFrom(
        this.httpService.post(`${uploaderUrl}/health/ping`, {
          platform: account.platform,
          session_data: JSON.parse(this.cryptoService.decrypt(account.session_data)),
        }).pipe(timeout(10000)),
      );
      const alive = typeof response.data?.alive === 'boolean' ? response.data.alive : null;
      const status = alive === true ? AccountStatus.ACTIVE : alive === false ? AccountStatus.DEAD : AccountStatus.CHECKING;
      await this.updateHealthStatus(account, status, checkedAt);

      return {
        alive,
        checked_at: checkedAt.toISOString(),
        ...(response.data?.note ? { note: String(response.data.note) } : {}),
      };
    } catch {
      await this.updateHealthStatus(account, AccountStatus.CHECKING, checkedAt);
      return { alive: null, checked_at: checkedAt.toISOString(), note: 'Health check unavailable' };
    }
  }

  async findHealthCheckBatch(limit = 10, excludeIds: number[] = []) {
    return this.accountRepository.find({
      where: {
        deleted_at: IsNull(),
        ...(excludeIds.length ? { id: Not(In(excludeIds)) } : {}),
      },
      order: { last_health_check: 'ASC', created_at: 'ASC' },
      take: limit,
    });
  }

  private async updateHealthStatus(account: Account, status: AccountStatus, checkedAt: Date) {
    await this.accountRepository.update(
      { id: account.id, user_id: account.user_id, tenant_id: account.tenant_id },
      { status, last_health_check: checkedAt },
    );
  }

  /**
   * Internal: Get decrypted session for a health check worker.
   * Pass tenantId when called from request context.
   */
  async getDecryptedSession(accountId: number, tenantId?: number): Promise<Record<string, any>> {
    const where = tenantId ? { id: accountId, tenant_id: tenantId } : { id: accountId };
    const account = await this.accountRepository.findOneBy(where);
    if (!account) {
      throw new NotFoundException('Account not found');
    }
    const plaintext = this.cryptoService.decrypt(account.session_data);
    return JSON.parse(plaintext);
  }

  private async findScopedAccount(userId: number, tenantId: number, accountId: number): Promise<Account> {
    const account = await this.accountRepository.findOneBy({
      id: accountId,
      user_id: userId,
      tenant_id: tenantId,
    });
    if (!account) {
      throw new NotFoundException('Account not found');
    }
    return account;
  }

  private parseImportRows(importDto: ImportBulkDto): Array<{ row: number; data: Partial<CreateAccountDto> }> {
    if (importDto.format === 'json') {
      return (importDto.accounts || []).map((data, index) => ({ row: index + 1, data }));
    }

    return this.parseCsv(importDto.csv || '');
  }

  private parseCsv(csv: string): Array<{ row: number; data: Partial<CreateAccountDto> }> {
    const lines = csv.split(/\r?\n/).filter((line) => line.trim().length > 0);
    if (lines.length === 0) {
      return [];
    }

    const headers = this.parseCsvLine(lines[0]).map((header) => header.trim());
    return lines.slice(1).map((line, index) => {
      const values = this.parseCsvLine(line);
      const raw = headers.reduce<Record<string, string>>((acc, header, valueIndex) => {
        acc[header] = values[valueIndex] || '';
        return acc;
      }, {});

      let sessionData: Record<string, any> | undefined;
      try {
        sessionData = raw.session_data ? JSON.parse(raw.session_data) : undefined;
      } catch {
        sessionData = undefined;
      }

      return {
        row: index + 2,
        data: {
          platform: raw.platform as Platform,
          account_name: raw.account_name,
          session_data: sessionData,
          proxy_url: raw.proxy_url || undefined,
        },
      };
    });
  }

  private parseCsvLine(line: string): string[] {
    const values: string[] = [];
    let current = '';
    let quoted = false;

    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      const next = line[index + 1];

      if (char === '"' && quoted && next === '"') {
        current += '"';
        index += 1;
      } else if (char === '"') {
        quoted = !quoted;
      } else if (char === ',' && !quoted) {
        values.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current);
    return values;
  }

  private validateImportRow(row: Partial<CreateAccountDto>) {
    if (!row.platform || !Object.values(Platform).includes(row.platform)) {
      throw new Error('Invalid platform');
    }
    if (!row.account_name) {
      throw new Error('account_name is required');
    }
    if (!row.session_data || typeof row.session_data !== 'object') {
      throw new Error('session_data is required');
    }
  }

  /**
   * Strip sensitive fields for API responses.
   * @param includeDecrypted — only true for internal health check workers
   */
  private toResponse(account: Account, includeDecrypted: boolean) {
    const response: any = {
      id: account.id,
      platform: account.platform,
      account_name: account.account_name,
      status: account.status,
      last_health_check: account.last_health_check,
      created_at: account.created_at,
      updated_at: account.updated_at,
      user_id: account.user_id,
      tenant_id: account.tenant_id,
    };

    // utils.check: NEVER include session_data in normal API responses
    if (includeDecrypted) {
      response.session_data = JSON.parse(this.cryptoService.decrypt(account.session_data));
    }

    return response;
  }
}
