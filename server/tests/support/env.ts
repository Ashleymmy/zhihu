process.env.NODE_ENV = 'test';
process.env.QUEUE_DRIVER = 'memory';
process.env.JWT_SECRET = 'test_jwt_secret_that_is_longer_than_32_chars';
process.env.ZHIHU_ACCESS_TOKEN = 'mock_access_token';
process.env.ZHIHU_SECRET_KEY = 'mock_secret_key';
process.env.CALLBACK_SECRET_ENCRYPTION_KEY = '1'.repeat(64);
