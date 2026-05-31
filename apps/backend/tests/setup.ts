process.env.DATABASE_URL = 'postgresql://dummy:dummy@localhost:5432/dummy';
process.env.JWT_SECRET = 'dummydummydummydummydummydummydummydummydummy';
process.env.API_KEY_SALT = 'dummydummydummydummydummydummydummydummydummy';
process.env.WEBHOOK_SIGNING_SECRET = 'dummydummydummydummydummydummydummydummydummy';
process.env.NODE_ENV = 'test';


jest.setTimeout(30000);
