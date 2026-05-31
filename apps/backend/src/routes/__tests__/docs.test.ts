import { docsRoutes } from '../docs';

describe('Docs Routes', () => {
  it('should configure docs routes', () => {
    const routes = docsRoutes.stack
      .filter((layer: any) => layer.route)
      .map((layer: any) => ({
        path: layer.route.path,
        method: Object.keys(layer.route.methods)[0],
      }));

    expect(routes).toContainEqual({ path: '/', method: 'get' });
    expect(routes).toContainEqual({ path: '/ui', method: 'get' });
  });
});
