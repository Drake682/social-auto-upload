import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

/**
 * Trend Entity — maps to the `trends` table populated by the AI Worker (Python).
 * Read-only from NestJS perspective; writes are handled by the worker.
 */
@Entity('trends')
@Index('idx_trends_platform_extracted', ['platform', 'extracted_at'])
@Index('idx_trends_tenant_platform', ['tenant_id', 'platform'])
export class Trend {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'integer', nullable: true })
  tenant_id: number;

  @Column({ type: 'varchar', length: 20 })
  platform: string;

  @Column({ type: 'varchar', length: 200 })
  keyword: string;

  @Column({ type: 'varchar', length: 20, default: 'video' })
  trend_type: string;

  @Column({ type: 'float', nullable: true })
  volume: number;

  @Column({ type: 'varchar', length: 500, nullable: true })
  source_url: string;

  @Column({ type: 'timestamp' })
  extracted_at: Date;
}
