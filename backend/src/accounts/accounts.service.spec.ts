import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { of, throwError } from 'rxjs';
import { Repository } from 'typeorm';
import { AccountsService } from './accounts.service';
import { Account } from './entities/account.entity';
import { Platform } from './enums/platform.enum';
import { AccountStatus } from './enums/account-status.enum';
import { CryptoService } from '../common/crypto/crypto.service';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';

describe('AccountsService', () => {
  let service: AccountsService;
  let accountRepository: jest.Mocked<Repository<Account>>;
  let cryptoService: jest.Mocked<CryptoService>;
  let httpService: jest.Mocked<HttpService>;
  let configService: jest.Mocked<ConfigService>;

  const mockAccount: Account = {
    id: 1,
    user_id: 7,
    tenant_id: 7,
    platform: Platform.FACEBOOK,
    account_name: 'FB Page',
    session_data: 'encrypted_blob',
    proxy_url: null,
    status: AccountStatus.CHECKING,
    last_health_check: null,
    created_at: new Date('2026-07-01T00:00:00.000Z'),
    updated_at: new Date('2026-07-01T00:00:00.000Z'),
    deleted_at: null,
  } as Account;

  const createRepository = () => ({
    create: jest.fn(),
    save: jest.fn(),
    find: jest.fn(),
    findAndCount: jest.fn(),
    findOneBy: jest.fn(),
    update: jest.fn(),
    softDelete: jest.fn(),
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AccountsService,
        { provide: getRepositoryToken(Account), useValue: createRepository() },
        {
          provide: CryptoService,
          useValue: {
            encrypt: jest.fn((plaintext: string) => `encrypted:${Buffer.from(plaintext).toString('base64')}`),
            decrypt: jest.fn(() => JSON.stringify({ cookies: [{ name: 'sid', value: 'secret-cookie' }] })),
          },
        },
        {
          provide: HttpService,
          useValue: { post: jest.fn() },
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(AccountsService);
    accountRepository = module.get(getRepositoryToken(Account));
    cryptoService = module.get(CryptoService);
    httpService = module.get(HttpService);
    configService = module.get(ConfigService);
  });

  afterEach(() => jest.clearAllMocks());

  it('encrypts session_data before storage and never returns it', async () => {
    const session = { cookies: [{ name: 'sid', value: 'plain-secret' }] };
    accountRepository.create.mockImplementation((value) => value as Account);
    accountRepository.save.mockImplementation(async (value) => ({ ...mockAccount, ...value } as Account));

    const result = await service.create(7, 7, {
      platform: Platform.FACEBOOK,
      account_name: 'FB Page',
      session_data: session,
    });

    expect(cryptoService.encrypt).toHaveBeenCalledWith(JSON.stringify(session));
    expect(accountRepository.create.mock.calls[0][0].session_data).not.toContain('plain-secret');
    expect(result).not.toHaveProperty('session_data');
  });

  it('lists accounts with platform filter and pagination', async () => {
    accountRepository.findAndCount.mockResolvedValue([[mockAccount], 1]);

    const result = await service.findAll(7, 7, { platform: Platform.FACEBOOK, page: 2, limit: 10 });

    expect(accountRepository.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { user_id: 7, tenant_id: 7, platform: Platform.FACEBOOK },
        skip: 10,
        take: 10,
      }),
    );
    expect(result.meta).toEqual({ page: 2, limit: 10, total: 1, totalPages: 1 });
    expect(result.items[0]).not.toHaveProperty('session_data');
  });

  it('soft deletes scoped accounts instead of hard deleting', async () => {
    accountRepository.findOneBy.mockResolvedValue(mockAccount);
    accountRepository.softDelete.mockResolvedValue({ affected: 1 } as any);

    await service.remove(7, 7, 1);

    expect(accountRepository.softDelete).toHaveBeenCalledWith({ id: 1, user_id: 7, tenant_id: 7 });
    expect((accountRepository as any).delete).toBeUndefined();
  });

  it('imports JSON with partial failure report', async () => {
    accountRepository.create.mockImplementation((value) => value as Account);
    accountRepository.save.mockImplementation(async (value) => ({ ...mockAccount, ...value } as Account));

    const result = await service.importBulk(7, 7, {
      format: 'json',
      accounts: [
        { platform: Platform.FACEBOOK, account_name: 'ok', session_data: { cookies: [] } },
        { platform: 'bad' as Platform, account_name: 'bad', session_data: { cookies: [] } },
      ],
    });

    expect(result).toEqual({
      total: 2,
      success: 1,
      failed: 1,
      errors: [{ row: 2, reason: 'Invalid platform' }],
    });
  });

  it('imports CSV rows', async () => {
    accountRepository.create.mockImplementation((value) => value as Account);
    accountRepository.save.mockImplementation(async (value) => ({ ...mockAccount, ...value } as Account));

    const result = await service.importBulk(7, 7, {
      format: 'csv',
      csv: 'platform,account_name,session_data\nfacebook,fb,"{""cookies"":[]}"',
    });

    expect(result.success).toBe(1);
    expect(result.failed).toBe(0);
  });

  it('returns alive health ping and updates status', async () => {
    accountRepository.findOneBy.mockResolvedValue(mockAccount);
    accountRepository.update.mockResolvedValue({ affected: 1 } as any);
    configService.get.mockReturnValue('http://uploader');
    httpService.post.mockReturnValue(of({ data: { alive: true, note: 'ok' } }) as any);

    const result = await service.checkHealth(7, 7, 1);

    expect(httpService.post).toHaveBeenCalledWith('http://uploader/health/ping', {
      platform: Platform.FACEBOOK,
      session_data: { cookies: [{ name: 'sid', value: 'secret-cookie' }] },
    });
    expect(accountRepository.update).toHaveBeenCalledWith(
      { id: 1, user_id: 7, tenant_id: 7 },
      expect.objectContaining({ status: AccountStatus.ACTIVE }),
    );
    expect(result).toEqual(expect.objectContaining({ alive: true, note: 'ok' }));
  });

  it('returns dead health ping and updates status', async () => {
    accountRepository.findOneBy.mockResolvedValue(mockAccount);
    accountRepository.update.mockResolvedValue({ affected: 1 } as any);
    configService.get.mockReturnValue('http://uploader');
    httpService.post.mockReturnValue(of({ data: { alive: false } }) as any);

    const result = await service.checkHealth(7, 7, 1);

    expect(accountRepository.update).toHaveBeenCalledWith(
      { id: 1, user_id: 7, tenant_id: 7 },
      expect.objectContaining({ status: AccountStatus.DEAD }),
    );
    expect(result.alive).toBe(false);
  });

  it('returns unknown health when uploader is unconfigured', async () => {
    accountRepository.findOneBy.mockResolvedValue(mockAccount);
    accountRepository.update.mockResolvedValue({ affected: 1 } as any);
    configService.get.mockReturnValue(undefined);

    const result = await service.checkHealth(7, 7, 1);

    expect(httpService.post).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({ alive: null, note: 'UPLOADER_SERVICE_URL not configured' }));
  });

  it('returns unknown health when uploader request fails', async () => {
    accountRepository.findOneBy.mockResolvedValue(mockAccount);
    accountRepository.update.mockResolvedValue({ affected: 1 } as any);
    configService.get.mockReturnValue('http://uploader');
    httpService.post.mockReturnValue(throwError(() => new Error('timeout')) as any);

    const result = await service.checkHealth(7, 7, 1);

    expect(result).toEqual(expect.objectContaining({ alive: null, note: 'Health check unavailable' }));
  });
});
