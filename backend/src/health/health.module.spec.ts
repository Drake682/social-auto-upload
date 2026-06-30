import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { TransformInterceptor } from '../common/interceptors/transform.interceptor';
import { HealthModule } from './health.module';

describe('HealthModule', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [HealthModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalInterceptors(new TransformInterceptor());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health returns ok status with ISO timestamp', async () => {
    const response = await request(app.getHttpServer()).get('/health').expect(200);

    expect(Object.keys(response.body).sort()).toEqual(['status', 'timestamp']);
    expect(response.body.status).toBe('ok');
    expect(response.body.timestamp).toEqual(expect.any(String));
    expect(new Date(response.body.timestamp).toISOString()).toBe(response.body.timestamp);
  });
});
