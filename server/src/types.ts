export type Role = 'boss' | 'leader' | 'member';

export interface AuthUser {
  sub: string;
  role: Role;
  parentId: string | null;
  username: string;
  displayName: string;
  jti: string;
  exp?: number;
}

declare global {
  namespace Express {
    interface Request {
      user: AuthUser;
      token: string;
    }
  }
}
