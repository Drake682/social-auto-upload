import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from '../../auth/entities/user.entity';
import { VideoStatus } from '../enums/video-status.enum';

@Entity('video_jobs')
@Index('idx_video_jobs_user_id', ['user_id'])
@Index('idx_video_jobs_tenant_user', ['tenant_id', 'user_id'])
@Index('idx_video_jobs_tenant_id_id', ['tenant_id', 'id'])
@Index('idx_video_jobs_status', ['status'])
export class VideoJob {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'integer' })
  user_id: number;

  @Column({ type: 'integer' })
  tenant_id: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'varchar', length: 500 })
  topic: string;

  @Column({ type: 'varchar', length: 20, default: VideoStatus.QUEUED })
  status: VideoStatus;

  @Column({ type: 'text', nullable: true })
  script: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  source_s3_uri: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  audio_url: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  video_url: string;

  @Column({ type: 'timestamp', nullable: true })
  scheduled_at: Date;

  @Column({ type: 'varchar', length: 500, nullable: true })
  published_url: string;

  @Column({ type: 'text', nullable: true })
  error_log: string;

  @Column({ type: 'integer', nullable: true })
  progress: number; // 0-100

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
