import { errorHandler } from '../errorHandler';
import { ZodError } from 'zod';

describe('errorHandler middleware', () => {
  let mockReq: any;
  let mockRes: any;
  let mockNext: any;
  
  beforeEach(() => {
    mockReq = {};
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };
    mockNext = jest.fn();
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('handles ZodError', () => {
    const error = new ZodError([{ code: 'custom', path: ['field'], message: 'Bad field' }]);
    errorHandler(error, mockReq, mockRes, mockNext);
    
    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Validation error' }));
  });

  it('handles PrismaClientKnownRequestError', () => {
    const error = new Error('Prisma error');
    error.name = 'PrismaClientKnownRequestError';
    errorHandler(error, mockReq, mockRes, mockNext);
    
    expect(mockRes.status).toHaveBeenCalledWith(409);
    expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Database conflict' }));
  });

  it('handles generic error', () => {
    const error = new Error('Something exploded');
    errorHandler(error, mockReq, mockRes, mockNext);
    
    expect(mockRes.status).toHaveBeenCalledWith(500);
    expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Internal server error' }));
  });
});
