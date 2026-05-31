import onrampRoutes from '../onramp';

describe('Onramp Routes', () => {
  it('should configure onramp routes', () => {
    const routes = onrampRoutes.stack
      .filter((layer: any) => layer.route)
      .map((layer: any) => ({
        path: layer.route.path,
        method: Object.keys(layer.route.methods)[0],
      }));

    expect(routes).toContainEqual({ path: '/url', method: 'post' });
    expect(routes).toContainEqual({ path: '/quotes', method: 'get' });
    expect(routes).toContainEqual({ path: '/webhook', method: 'post' });
    expect(routes).toContainEqual({ path: '/status/:id', method: 'get' });
  });
});
