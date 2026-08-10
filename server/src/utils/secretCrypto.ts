import crypto from 'node:crypto';
import { config } from '../config';

export interface EncryptedSecret { ciphertext: string; iv: string; authTag: string; lastFour: string }

export function encryptSecret(secret: string): EncryptedSecret {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', config.callbackEncryptionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('hex'),
    authTag: cipher.getAuthTag().toString('hex'),
    lastFour: secret.slice(-4),
  };
}

export function decryptSecret(value: EncryptedSecret): string {
  const decipher = crypto.createDecipheriv('aes-256-gcm', config.callbackEncryptionKey, Buffer.from(value.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(value.authTag, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(value.ciphertext, 'base64')), decipher.final()]).toString('utf8');
}

export const generateCallbackSecret = () => `sk_live_${crypto.randomBytes(24).toString('hex')}`;
