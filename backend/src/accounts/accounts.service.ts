import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Account } from './entities/account.entity';
import { AccountStatus } from './enums/account-status.enum';
import { CreateAccountDto } from './dto/create-account.dto';
import { CryptoService } from '../common/crypto/crypto.service';

@Injectable()
export class AccountsService {
  constructor(
    @InjectRepository(Account)
    private readonly accountRepository: Repository<Account>,
    private readonly cryptoService: CryptoService,
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
  async findAll(userId: number, tenantId: number) {
    const accounts = await this.accountRepository.find({
      where: { user_id: userId, tenant_id: tenantId },
      order: { created_at: 'DESC' },
    });

    return accounts.map((acc) => this.toResponse(acc, false));
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
  async update(userId: number, tenantId: number, accountId: number, updateDto: Partial<CreateAccountDto>) {
    const account = await this.findScopedAccount(userId, tenantId, accountId);

    await this.accountRepository.update(
      { id: accountId, user_id: userId, tenant_id: tenantId },
      {
        account_name: updateDto.account_name ?? account.account_name,
        platform: updateDto.platform ?? account.platform,
        proxy_url: updateDto.proxy_url ?? account.proxy_url,
      },
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
    await this.accountRepository.delete({ id: accountId, user_id: userId, tenant_id: tenantId });
    return { code: 200, data: { id: accountId }, msg: 'Account deleted' };
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
