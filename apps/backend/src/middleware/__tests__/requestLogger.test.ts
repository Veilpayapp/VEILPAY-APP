import { requestLogger } from '../requestLogger';

describe('requestLogger middleware', () => {
  let mockReq: any;
  let mockRes: any;
  let mockNext: any;
  
  beforeEach(() => {
    mockReq = {
      method: 'GET',
      path: '/api/test',
      headers: {}
    };
    mockRes = {
      statusCode: 200,
      setHeader: jest.fn(),
      on: jest.fn((event, cb) => {
        if (event === 'finish') {
          // Store cb to call it later
          mockRes.finishCb = cb;
        }
      })
    };
    mockNext = jest.fn();
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('calls next and logs request on finish', () => {
    requestLogger(mockReq, mockRes, mockNext);
    
    expect(mockRes.setHeader).toHaveBeenCalledWith('X-Request-Id', expect.any(String));
    expect(mockNext).toHaveBeenCalled();
    
    // Simulate response finish
    mockRes.finishCb();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('[HTTP] GET /api/test 200'));
  });

  it('uses existing x-request-id if provided', () => {
    mockReq.headers['x-request-id'] = 'my-req-id';
    requestLogger(mockReq, mockRes, mockNext);
    
    expect(mockRes.setHeader).toHaveBeenCalledWith('X-Request-Id', 'my-req-id');
  });
});
