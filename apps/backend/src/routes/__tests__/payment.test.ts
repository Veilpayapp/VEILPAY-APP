import { paymentRoutes } from '../payment';

describe('Payment Routes', () => {
  it('should configure payment routes', () => {
    const routes = paymentRoutes.stack
      .filter((layer: any) => layer.route)
      .map((layer: any) => ({
        path: layer.route.path,
        method: Object.keys(layer.route.methods)[0],
      }));

    expect(routes).toContainEqual({ path: '/confirm', method: 'post' });
    expect(routes).toContainEqual({ path: '/', method: 'get' });
    expect(routes).toContainEqual({ path: '/:id', method: 'get' });
  });
});
