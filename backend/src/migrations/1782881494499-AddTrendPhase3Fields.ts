import { MigrationInterface, QueryRunner } from "typeorm";

export class AddTrendPhase3Fields1782881494499 implements MigrationInterface {
    name = 'AddTrendPhase3Fields1782881494499'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "audit_logs" ("id" SERIAL NOT NULL, "actor_user_id" integer, "action" character varying(100) NOT NULL, "entity_type" character varying(100), "entity_id" character varying(100), "ip_address" character varying(64), "user_agent" character varying(255), "metadata" jsonb, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_1bb179d048bbc581caa3b013439" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "idx_audit_logs_action" ON "audit_logs" ("action") `);
        await queryRunner.query(`CREATE INDEX "idx_audit_logs_actor_user_id" ON "audit_logs" ("actor_user_id") `);
        await queryRunner.query(`ALTER TABLE "trends" ADD "title" character varying(500)`);
        await queryRunner.query(`ALTER TABLE "trends" ADD "views" double precision`);
        await queryRunner.query(`ALTER TABLE "trends" ADD "region" character varying(100) DEFAULT 'global'`);
        await queryRunner.query(`ALTER TABLE "trends" ADD "run_id" uuid`);
        await queryRunner.query(`ALTER TABLE "trends" ADD "crawled_at" TIMESTAMP`);
        await queryRunner.query(`ALTER TABLE "licenses" ADD "bound_user_id" integer`);
        await queryRunner.query(`ALTER TABLE "accounts" ADD "deleted_at" TIMESTAMP`);
        await queryRunner.query(`CREATE UNIQUE INDEX "idx_trends_dedupe_run" ON "trends" ("tenant_id", "platform", "region", "run_id", "keyword") `);
        await queryRunner.query(`CREATE INDEX "idx_trends_platform_region_crawled" ON "trends" ("platform", "region", "crawled_at") `);
        await queryRunner.query(`CREATE INDEX "idx_licenses_bound_user_id" ON "licenses" ("bound_user_id") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."idx_licenses_bound_user_id"`);
        await queryRunner.query(`DROP INDEX "public"."idx_trends_platform_region_crawled"`);
        await queryRunner.query(`DROP INDEX "public"."idx_trends_dedupe_run"`);
        await queryRunner.query(`ALTER TABLE "accounts" DROP COLUMN "deleted_at"`);
        await queryRunner.query(`ALTER TABLE "licenses" DROP COLUMN "bound_user_id"`);
        await queryRunner.query(`ALTER TABLE "trends" DROP COLUMN "crawled_at"`);
        await queryRunner.query(`ALTER TABLE "trends" DROP COLUMN "run_id"`);
        await queryRunner.query(`ALTER TABLE "trends" DROP COLUMN "region"`);
        await queryRunner.query(`ALTER TABLE "trends" DROP COLUMN "views"`);
        await queryRunner.query(`ALTER TABLE "trends" DROP COLUMN "title"`);
        await queryRunner.query(`DROP INDEX "public"."idx_audit_logs_actor_user_id"`);
        await queryRunner.query(`DROP INDEX "public"."idx_audit_logs_action"`);
        await queryRunner.query(`DROP TABLE "audit_logs"`);
    }

}
