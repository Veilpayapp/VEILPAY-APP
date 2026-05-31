import { webhookRoutes } from '../webhook';

describe('Webhook Routes', () => {
  it('should configure webhook routes', () => {
    const routes = webhookRoutes.stack
      .filter((layer: any) => layer.route)
      .map((layer: any) => ({
        path: layer.route.path,
        method: Object.keys(layer.route.methods)[0],
      }));

    expect(routes).toContainEqual({ path: '/test', method: 'post' });
    expect(routes).toContainEqual({ path: '/verify', method: 'post' });
    expect(routes).toContainEqual({ path: '/failed', method: 'get' });
    expect(routes).toContainEqual({ path: '/:id/retry', method: 'post' });
  });
});
