import { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { rows, withTransaction } from '../db';
import { AppError } from '../middleware/errors';
import { AuthUser, ProjectCourse } from '../types';
import { writeAudit } from './audit.service';
import { assertProjectMembership } from './projectMembers.service';

interface CourseRow extends RowDataPacket {
  id: string;
  project_id: string;
  course_name: string;
  course_url: string | null;
  display_order: number;
  is_active: number;
  created_at: Date;
  updated_at: Date;
}

const publicCourse = (row: CourseRow): ProjectCourse => ({
  id: String(row.id),
  projectId: String(row.project_id),
  courseName: row.course_name,
  courseUrl: row.course_url,
  displayOrder: row.display_order,
  isActive: Boolean(row.is_active),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

async function assertProjectExists(projectId: string) {
  const found = await rows<RowDataPacket>('SELECT id FROM projects WHERE id = ? LIMIT 1', [projectId]);
  if (!found.length) throw new AppError(404, 40402, '项目不存在');
}

export async function listProjectCourses(user: AuthUser, projectId: string) {
  await assertProjectExists(projectId);
  await assertProjectMembership(user, projectId);
  const courses = await rows<CourseRow>(
    'SELECT * FROM project_courses WHERE project_id = ? ORDER BY display_order, id',
    [projectId],
  );
  return courses.map(publicCourse);
}

export async function createProjectCourse(
  user: AuthUser,
  projectId: string,
  input: { courseName: string; courseUrl?: string; displayOrder?: number },
  ip?: string,
) {
  await assertProjectExists(projectId);
  const id = await withTransaction(async (connection) => {
    const [result] = await connection.query<ResultSetHeader>(
      'INSERT INTO project_courses (project_id, course_name, course_url, display_order) VALUES (?, ?, ?, ?)',
      [projectId, input.courseName, input.courseUrl ?? null, input.displayOrder ?? 0],
    );
    const courseId = String(result.insertId);
    await writeAudit(
      {
        userId: user.sub,
        action: 'project.course_add',
        resourceType: 'project',
        resourceId: projectId,
        detail: { courseId, courseName: input.courseName },
        ip,
      },
      connection,
    );
    return courseId;
  });
  const [created] = await rows<CourseRow>('SELECT * FROM project_courses WHERE id = ? LIMIT 1', [id]);
  return publicCourse(created);
}

export async function deleteProjectCourse(user: AuthUser, projectId: string, courseId: string, ip?: string) {
  await assertProjectExists(projectId);
  await withTransaction(async (connection) => {
    const [result] = await connection.query<ResultSetHeader>(
      'DELETE FROM project_courses WHERE id = ? AND project_id = ?',
      [courseId, projectId],
    );
    if (result.affectedRows !== 1) throw new AppError(404, 40404, '课程不存在');
    await writeAudit(
      {
        userId: user.sub,
        action: 'project.course_remove',
        resourceType: 'project',
        resourceId: projectId,
        detail: { courseId },
        ip,
      },
      connection,
    );
  });
}
