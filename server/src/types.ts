export type Role = 'admin' | 'leader' | 'creator';

export interface AuthUser {
  sub: string;
  role: Role;
  parentId: string | null;
  username: string;
  displayName: string;
  jti: string;
  exp?: number;
}

export interface ProjectCourse {
  id: string;
  projectId: string;
  courseName: string;
  courseUrl: string | null;
  displayOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

declare global {
  namespace Express {
    interface Request {
      user: AuthUser;
      token: string;
    }
  }
}
