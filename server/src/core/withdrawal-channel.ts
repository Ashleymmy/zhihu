import type { RequestHandler } from 'express';
import { wechatContext } from '../wechat/context';
import { AppError } from '../middleware/errors';

export const MINI_WITHDRAWAL_PAUSED = '小程序暂不受理新的提现申请，收益、余额及历史申请进度仍可查看，已提交申请继续按原规则处理。';

/** Product-wide pause, independent of account, amount, version or review status. */
export const requireWithdrawalApplication: RequestHandler = (req, _res, next) => {
  if (wechatContext(req)) return next(new AppError(403, 40330, MINI_WITHDRAWAL_PAUSED));
  next();
};
