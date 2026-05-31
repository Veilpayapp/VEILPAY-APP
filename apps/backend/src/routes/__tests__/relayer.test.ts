import { relayerRoutes } from '../relayer';

describe('Relayer Routes', () => {
  it('should configure relayer routes', () => {
    const routes = relayerRoutes.stack
      .filter((layer: any) => layer.route)
      .map((layer: any) => ({
        path: layer.route.path,
        method: Object.keys(layer.route.methods)[0],
      }));

    expect(routes).toContainEqual({ path: '/withdraw', method: 'post' });
  });
});
