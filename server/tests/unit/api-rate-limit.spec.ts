import { beforeAll, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
vi.mock('../../src/config', () => ({ config: { queueDriver: 'memory', jwt: { secret: 'isolated-rate-limit-secret' } } }));
import { apiRateLimit } from '../../src/middleware/apiRateLimit';
import { errorHandler } from '../../src/middleware/errors';
const token = (id: string, expired = false) => jwt.sign({ role: 'creator', username: id, displayName: id }, 'isolated-rate-limit-secret', { algorithm: 'HS256', subject: id, jwtid: 'rate-' + id, expiresIn: expired ? -1 : 60 });
const app = express();
beforeAll(() => {
  app.use(apiRateLimit({ userLimit: 2, anonLimit: 1 }));
  app.get('/probe', (req, res) => res.json({ grantedIdentity: !!req.user }));
  app.use(errorHandler);
});
describe('rate limiting before router authentication', () => {
  it('keeps authenticated colleagues on the same IP in separate buckets without granting an identity', async () => {
    for (const id of ['colleague-one', 'colleague-two']) {
      for (let i = 0; i < 2; i++) {
        const result = await request(app).get('/probe').set('Authorization', 'Bearer ' + token(id));
        expect(result.status).toBe(200); expect(result.body.grantedIdentity).toBe(false);
      }
      expect((await request(app).get('/probe').set('Authorization', 'Bearer ' + token(id))).status).toBe(429);
    }
  });
  it('does not trust forged or expired bearer subjects to bypass the anonymous limit', async () => {
    const forged = jwt.sign({ sub: 'forged', role: 'creator', username: 'forged', displayName: 'forged' }, 'wrong-secret', { algorithm: 'HS256', jwtid: 'forged' });
    expect((await request(app).get('/probe').set('Authorization', 'Bearer ' + forged)).status).toBe(200);
    expect((await request(app).get('/probe').set('Authorization', 'Bearer ' + token('expired', true))).status).toBe(429);
    expect((await request(app).get('/probe')).status).toBe(429);
  });
});
