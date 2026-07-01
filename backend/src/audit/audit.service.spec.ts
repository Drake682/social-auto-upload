import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditService } from './audit.service';
import { AuditLog } from './entities/audit-log.entity';

describe('AuditService', () => {
  let service: AuditService;
  let auditRepository: jest.Mocked<Repository<AuditLog>>;

  const createMockRepository = () => ({
    create: jest.fn(),
    save: jest.fn(),
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditService,
        {
          provide: getRepositoryToken(AuditLog),
          useValue: createMockRepository(),
        },
      ],
    }).compile();

    service = module.get<AuditService>(AuditService);
    auditRepository = module.get(getRepositoryToken(AuditLog));
  });

  it('records audit events without secrets', async () => {
    auditRepository.create.mockReturnValue({ id: 1 } as AuditLog);
    auditRepository.save.mockResolvedValue({ id: 1 } as AuditLog);

    await service.record({
      actorUserId: 7,
      action: 'auth.login',
      entityType: 'user',
      entityId: '7',
      ipAddress: '127.0.0.1',
      userAgent: 'jest',
      metadata: { outcome: 'success' },
    });

    expect(auditRepository.create).toHaveBeenCalledWith({
      actor_user_id: 7,
      action: 'auth.login',
      entity_type: 'user',
      entity_id: '7',
      ip_address: '127.0.0.1',
      user_agent: 'jest',
      metadata: { outcome: 'success' },
    });
    expect(JSON.stringify(auditRepository.create.mock.calls[0][0])).not.toContain('password');
    expect(auditRepository.save).toHaveBeenCalled();
  });

  it('does not throw when audit persistence fails', async () => {
    auditRepository.create.mockReturnValue({ id: 1 } as AuditLog);
    auditRepository.save.mockRejectedValue(new Error('db down'));

    await expect(service.record({ action: 'auth.logout' })).resolves.toBeUndefined();
  });
});
