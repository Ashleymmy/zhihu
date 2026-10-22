import { avatarImage, AVATAR_MAX_BYTES } from './user-avatar.service';

// Some shared JPEGs carry a small attachment trailer after the image's EOI marker.
// Validate the JPEG portion while retaining every original byte for QR display/download.
export function businessQrImage(base64: string) {
  const original = Buffer.from(base64, 'base64');
  if (!original.length || original.length > AVATAR_MAX_BYTES || original.toString('base64') !== base64)
    throw new Error('Invalid QR image');
  let image = original;
  if (original.length > 12 && original.readUInt16BE(0) === 0xffd8) {
    const end = original.lastIndexOf(Buffer.from([0xff, 0xd9]));
    const trailingBytes = original.length - end - 2;
    if (end >= 2 && trailingBytes > 0 && trailingBytes <= 1024) image = original.subarray(0, end + 2);
  }
  const parsed = avatarImage(image.toString('base64'));
  return { buffer: original, mime: parsed.mime };
}
