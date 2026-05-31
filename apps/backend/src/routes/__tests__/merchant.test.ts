import { merchantRoutes } from '../merchant';

describe('Merchant Routes', () => {
  it('should configure merchant routes', () => {
    const routes = merchantRoutes.stack
      .filter((layer: any) => layer.route)
      .map((layer: any) => ({
        path: layer.route.path,
        method: Object.keys(layer.route.methods)[0],
      }));

    expect(routes).toContainEqual({ path: '/register', method: 'post' });
    expect(routes).toContainEqual({ path: '/keys/publish', method: 'post' });
    expect(routes).toContainEqual({ path: '/:id', method: 'get' });
    expect(routes).toContainEqual({ path: '/:id/stats', method: 'get' });
    expect(routes).toContainEqual({ path: '/:id', method: 'put' });
  });
});