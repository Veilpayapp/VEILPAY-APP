import { healthRoutes } from '../health';

describe('Health Routes', () => {
  it('should configure health routes', () => {
    const routes = healthRoutes.stack
      .filter((layer: any) => layer.route)
      .map((layer: any) => ({
        path: layer.route.path,
        method: Object.keys(layer.route.methods)[0],
      }));

    expect(routes).toContainEqual({ path: '/', method: 'get' });
    expect(routes).toContainEqual({ path: '/ready', method: 'get' });
    expect(routes).toContainEqual({ path: '/live', method: 'get' });
  });
});
