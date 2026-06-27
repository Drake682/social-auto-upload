import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

/**
 * AffiliateProduct Entity — maps to affiliate_products populated by the AI Worker.
 * Read-only from NestJS perspective; writes are handled by the worker.
 */
@Entity('affiliate_products')
@Index('idx_affiliate_products_tenant_platform', ['tenant_id', 'platform'])
@Index('idx_affiliate_products_extracted_at', ['extracted_at'])
export class AffiliateProduct {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'integer' })
  tenant_id: number;

  @Column({ type: 'varchar', length: 20 })
  platform: string;

  @Column({ type: 'varchar', length: 1000 })
  product_url: string;

  @Column({ type: 'varchar', length: 500 })
  product_name: string;

  @Column({ type: 'float', nullable: true })
  price: number;

  @Column({ type: 'float', nullable: true })
  commission_rate: number;

  @Column({ type: 'timestamp' })
  extracted_at: Date;
}
