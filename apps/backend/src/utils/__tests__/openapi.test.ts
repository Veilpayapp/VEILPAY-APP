import { openApiSpec } from '../openapi';

describe('openApiSpec', () => {
  it('exports a valid openapi structure', () => {
    expect(openApiSpec.openapi).toBe('3.0.3');
    expect(openApiSpec.info.title).toBe('VeilPay API');
    expect(openApiSpec.paths['/api/v1/health']).toBeDefined();
  });
});
