import { directoryRoutes } from '../directory';

describe('Directory Routes', () => {
  it('should configure directory routes', () => {
    const routes = directoryRoutes.stack
      .filter((layer: any) => layer.route)
      .map((layer: any) => ({
        path: layer.route.path,
        method: Object.keys(layer.route.methods)[0],
      }));

    expect(routes).toContainEqual({ path: '/:id', method: 'get' });
  });
});
