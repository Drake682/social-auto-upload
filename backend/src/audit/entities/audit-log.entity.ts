import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('audit_logs')
@Index('idx_audit_logs_actor_user_id', ['actor_user_id'])
@Index('idx_audit_logs_action', ['action'])
export class AuditLog {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'integer', nullable: true })
  actor_user_id: number;

  @Column({ type: 'varchar', length: 100 })
  action: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  entity_type: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  entity_id: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  ip_address: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  user_agent: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown>;

  @CreateDateColumn()
  created_at: Date;
}
