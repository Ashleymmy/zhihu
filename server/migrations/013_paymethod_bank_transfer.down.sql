ALTER TABLE withdrawal_requests
  MODIFY COLUMN pay_method ENUM('alipay','wechat') NOT NULL;
