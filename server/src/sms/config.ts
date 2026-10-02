import { AppError } from '../middleware/errors';
import { unsafeProductionJwtSecret } from '../utils/productionSecrets';
import { createHash } from 'node:crypto';

export const SMS_TTL_SECONDS = 300;
export const SMS_RETRY_SECONDS = 60;
export const SMS_MAX_ATTEMPTS = 5;

export function smsSettings(invitationToken?: string) {
  if (process.env.SMS_REGISTRATION_ENABLED !== undefined && !['0', '1'].includes(process.env.SMS_REGISTRATION_ENABLED))
    throw new AppError(503, 50320, '短信验证开关配置错误，请联系管理员');
  const globalEnabled = process.env.SMS_REGISTRATION_ENABLED === '1';
  const pilot = (process.env.SMS_REGISTRATION_PILOT_INVITATIONS ?? '').trim();
  const pilotInvitations = pilot ? pilot.split(',').map((value) => value.trim()) : [];
  if (pilotInvitations.length > 20 || pilotInvitations.some((value) => !/^[a-f0-9]{64}$/.test(value)))
    throw new AppError(503, 50320, '短信测试范围配置错误，请联系管理员');
  // Resolve and validate the invitation server-side; a client cannot choose its verification policy.
  const invitationHash = invitationToken ? createHash('sha256').update(invitationToken).digest('hex') : '';
  const enabled = globalEnabled || (!!invitationHash && pilotInvitations.includes(invitationHash));
  const signName = process.env.SMS_SIGN_NAME?.trim() ?? '';
  const templateCode = process.env.SMS_TEMPLATE_CODE?.trim() ?? '';
  const secret = process.env.SMS_VERIFICATION_SECRET ?? '';
  const dailyLimit = Number(process.env.SMS_DAILY_LIMIT ?? 100);
  if (
    (globalEnabled || pilotInvitations.length > 0) &&
    (!signName ||
      !/^SMS_\d+$/.test(templateCode) ||
      secret.length < 32 ||
      (process.env.NODE_ENV === 'production' && unsafeProductionJwtSecret(secret)) ||
      !Number.isInteger(dailyLimit) ||
      dailyLimit < 1 ||
      dailyLimit > 10000)
  )
    throw new AppError(503, 50320, '短信验证配置不完整，请联系管理员');
  return { enabled, signName, templateCode, secret, dailyLimit };
}

export function requireSmsEnabled(invitationToken?: string) {
  const settings = smsSettings(invitationToken);
  if (!settings.enabled) throw new AppError(503, 50320, '短信验证尚未启用');
  return settings;
}
