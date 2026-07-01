import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog } from './entities/audit-log.entity';

export interface AuditRecord {
  actorUserId?: number;
  action: string;
  entityType?: string;
  entityId?: string;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AuditLog)
    private readonly auditRepository: Repository<AuditLog>,
  ) {}

  async record(record: AuditRecord): Promise<void> {
    try {
      const audit = this.auditRepository.create({
        actor_user_id: record.actorUserId ?? null,
        action: record.action,
        entity_type: record.entityType ?? null,
        entity_id: record.entityId ?? null,
        ip_address: record.ipAddress ?? null,
        user_agent: record.userAgent ?? null,
        metadata: record.metadata ?? null,
      });
      await this.auditRepository.save(audit);
    } catch {
      // Audit must not block auth/license flows.
    }
  }
}
