import Dysmsapi, { SendSmsRequest } from '@alicloud/dysmsapi20170525';
import { Config } from '@alicloud/openapi-client';
import Credential, { Config as CredentialConfig } from '@alicloud/credentials';
import { RuntimeOptions } from '@alicloud/tea-util';
import { requireSmsEnabled } from './config';
import { AppError } from '../middleware/errors';

let client: Dysmsapi | undefined;
export async function sendRegistrationSms(phone: string, code: string): Promise<void> {
  const { signName, templateCode } = requireSmsEnabled();
  try {
    // ECS role is the default; explicit server-only RAM credentials support isolated deployments.
    if (!client) {
      const id = process.env.ALIBABA_CLOUD_ACCESS_KEY_ID;
      const secret = process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET;
      const token = process.env.ALIBABA_CLOUD_SECURITY_TOKEN;
      const credential = new Credential(
        new CredentialConfig(
          id && secret
            ? {
                type: token ? 'sts' : 'access_key',
                accessKeyId: id,
                accessKeySecret: secret,
                securityToken: token,
              }
            : { type: 'ecs_ram_role', roleName: process.env.ALIBABA_CLOUD_ECS_METADATA, disableIMDSv1: true },
        ),
      );
      client = new Dysmsapi(new Config({ credential, endpoint: 'dysmsapi.aliyuncs.com' }));
    }
    const response = await client.sendSmsWithOptions(
      new SendSmsRequest({
        phoneNumbers: phone,
        signName,
        templateCode,
        templateParam: JSON.stringify({ code }),
      }),
      new RuntimeOptions({ autoretry: false, connectTimeout: 3000, readTimeout: 5000 }),
    );
    if (response.body?.code !== 'OK') throw new Error('provider_rejected');
  } catch {
    // SDK exceptions can contain the signed request, credentials, phone and code. Never propagate them.
    throw new AppError(503, 50321, '短信暂时无法发送，请稍后再试');
  }
}
