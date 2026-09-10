-- 013: 提现收款方式补充对公转账

ALTER TABLE withdrawal_requests
  MODIFY COLUMN pay_method ENUM('alipay','wechat','bank_transfer') NOT NULL;
