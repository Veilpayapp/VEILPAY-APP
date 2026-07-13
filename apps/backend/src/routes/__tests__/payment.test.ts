import { paymentRoutes } from '../payment';

interface RouteLayer {
  route: {
    path: string;
    methods: Record<string, boolean>;
    stack: unknown[];
  };
}

describe('Payment Routes', () => {
  // Returns the Express Route object for a given path+method, or undefined.
  function getRoute(path: string, method: string): RouteLayer | undefined {
    return paymentRoutes.stack
      .filter((layer: any) => layer.route)
      .find((layer: any) =>
        layer.route.path === path && Object.keys(layer.route.methods)[0] === method
      ) as RouteLayer | undefined;
  }

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

  it('SEC-001: /confirm is auth-gated (has authMiddleware + requireAuth before the handler)', () => {
    // Before the fix, /confirm was registered with a single handler:
    //   router.post('/confirm', asyncHandler(confirmPayment))
    // After the fix it carries authMiddleware + requireAuth + asyncHandler:
    //   router.post('/confirm', authMiddleware, requireAuth, asyncHandler(confirmPayment))
    // Each handler becomes a layer in route.stack, so the gated route has >= 3
    // layers where the pre-fix route had exactly 1.
    const confirmRoute = getRoute('/confirm', 'post');
    expect(confirmRoute).toBeDefined();
    expect(confirmRoute?.route.stack.length).toBeGreaterThanOrEqual(3);

    // The GET routes were already auth-gated before the fix (1 auth + 1 require + 1 handler = 3).
    const listRoute = getRoute('/', 'get');
    expect(listRoute).toBeDefined();
    expect(listRoute?.route.stack.length).toBeGreaterThanOrEqual(3);

    const detailRoute = getRoute('/:id', 'get');
    expect(detailRoute).toBeDefined();
    expect(detailRoute?.route.stack.length).toBeGreaterThanOrEqual(3);
  });
});
