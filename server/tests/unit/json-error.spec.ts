import request from 'supertest';
import { createApp } from '../../src/app';

describe('JSON 请求错误', () => {
  it('把 malformed JSON 映射为统一的 400 响应', async () => {
    const response = await request(createApp())
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"username":');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      code: 40000,
      data: null,
      message: '请求体不是有效 JSON',
    });
  });
});
