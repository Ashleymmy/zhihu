import crypto from 'node:crypto';
import jwt, { SignOptions } from 'jsonwebtoken';
import { config } from '../config';
import { AuthUser, Role } from '../types';
import { normalizeRole } from './roles';
import { revocationStore } from './revocation';

export interface TokenUser {
  id: string;
  role: Role;
  parentId: string | null;
  username: string;
  displayName: string;
}

export async function signToken(user: TokenUser) {
  const jti = crypto.randomUUID();
  const token = jwt.sign(
    { role: user.role, parentId: user.parentId, username: user.username, displayName: user.displayName },
    config.jwt.secret,
    { algorithm: 'HS256', subject: user.id, jwtid: jti, expiresIn: config.jwt.expiresIn as SignOptions['expiresIn'] },
  );
  const decoded = jwt.decode(token) as jwt.JwtPayload;
  const ttlSeconds = Math.max((decoded.exp ?? 0) - Math.floor(Date.now() / 1000), 1);
  await revocationStore.register(user.id, jti, ttlSeconds);
  return token;
}

export function verifyToken(token: string): AuthUser {
  const decoded = jwt.verify(token, config.jwt.secret, { algorithms: ['HS256'] }) as jwt.JwtPayload;
  if (!decoded.sub || !decoded.jti || !decoded.role || !decoded.username || !decoded.displayName)
    throw new Error('invalid token');
  const role = normalizeRole(decoded.role);
  if (!role) throw new Error('unknown role');
  return {
    sub: decoded.sub,
    jti: decoded.jti,
    role,
    parentId: (decoded.parentId as string | null) ?? null,
    username: String(decoded.username),
    displayName: String(decoded.displayName),
    exp: decoded.exp,
  };
}

export const tokenTtl = (user: AuthUser) => Math.max((user.exp ?? 0) - Math.floor(Date.now() / 1000), 1);
