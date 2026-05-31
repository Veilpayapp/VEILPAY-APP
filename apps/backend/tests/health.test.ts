import request from 'supertest';
import { app } from '../src/index';

describe('Health Routes', () => {
  it('should return 200 on /', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('name', 'VeilPay API');
  });
});
