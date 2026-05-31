import { invoiceRoutes } from '../invoice';

describe('Invoice Routes', () => {
  it('should configure invoice routes', () => {
    const routes = invoiceRoutes.stack
      .filter((layer: any) => layer.route)
      .map((layer: any) => ({
        path: layer.route.path,
        method: Object.keys(layer.route.methods)[0],
      }));

    expect(routes).toContainEqual({ path: '/', method: 'get' });
    expect(routes).toContainEqual({ path: '/create', method: 'post' });
    expect(routes).toContainEqual({ path: '/:id/status', method: 'get' });
    expect(routes).toContainEqual({ path: '/:id', method: 'get' });
    expect(routes).toContainEqual({ path: '/:id/cancel', method: 'post' });
    expect(routes).toContainEqual({ path: '/:id/pay', method: 'post' });
  });
});