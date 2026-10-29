import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { businessQrImage } from '../../src/services/business-qr-image';
import { avatarImage, AVATAR_MAX_BYTES } from '../../src/services/user-avatar.service';

const jpeg = readFileSync(path.join(__dirname, '../fixtures/business-jpeg-test.jpg'));
const png = readFileSync(path.join(__dirname, '../fixtures/business-wechat-test.png'));
const trailer = Buffer.from('55fbf40900000000000102030405060708090a0b0c0d0e0f', 'hex');
describe('business QR original image validation', () => {
  it('accepts normal JPG and PNG without changing bytes', () => {
    for (const image of [jpeg, png]) expect(businessQrImage(image.toString('base64')).buffer).toEqual(image);
  });
  it('accepts a JPEG attachment trailer and preserves the complete original', () => {
    const original = Buffer.concat([jpeg, trailer]);
    const result = businessQrImage(original.toString('base64'));
    expect(result.mime).toBe('image/jpeg');
    expect(result.buffer).toEqual(original);
    // QR compatibility must not broaden the existing avatar upload contract.
    expect(() => avatarImage(original.toString('base64'))).toThrow();
  });
  it('still rejects oversized, noncanonical, truncated and nonimage payloads', () => {
    for (const value of [
      jpeg.toString('base64') + ' ',
      Buffer.concat([jpeg, Buffer.alloc(AVATAR_MAX_BYTES)]).toString('base64'),
      Buffer.concat([jpeg, Buffer.alloc(1025, 1)]).toString('base64'),
      Buffer.concat([jpeg.subarray(0, -2), trailer]).toString('base64'),
      Buffer.from('<svg onload="alert(1)"/>').toString('base64'),
      Buffer.from('https://example.com/image.jpg').toString('base64'),
    ]) expect(() => businessQrImage(value)).toThrow();
  });
  it('still enforces JPEG dimensions when a trailer is present', () => {
    const original = Buffer.concat([jpeg, trailer]);
    const frame = original.indexOf(Buffer.from([0xff, 0xc0]));
    expect(frame).toBeGreaterThan(0);
    original.writeUInt16BE(2049, frame + 5);
    expect(() => businessQrImage(original.toString('base64'))).toThrow();
  });
});
