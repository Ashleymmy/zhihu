import { RowDataPacket } from 'mysql2/promise';
import { rows } from '../db';
import { AppError } from '../middleware/errors';
import { AuthUser } from '../types';
import { listProjects } from './projectMembers.service';
import { listProjectCourses } from './project-courses.service';

const tiers = [
  { key: 'silver', title: '白银课程', subtitle: '入门基础 · 从零跑通第一单' },
  { key: 'gold', title: '黄金课程', subtitle: '进阶提升 · 稳定产出与放量' },
  { key: 'elite', title: '卓越课程', subtitle: '高级策略 · 转化与数据驱动' },
];

interface CollegeRow extends RowDataPacket {
  id: string;
  tier: string;
  title: string;
  cover: string;
  intro: string;
  duration: string;
  sections: { title: string; content: string }[];
}

interface CourseCard {
  id: string;
  tier: string;
  title: string;
  cover: string;
  intro: string;
  duration: string;
  views: null;
  projectId?: string;
  url?: string | null;
}

function card(row: CollegeRow): CourseCard {
  return {
    id: row.id,
    tier: row.tier,
    title: row.title,
    cover: row.cover,
    intro: row.intro,
    duration: row.duration,
    views: null,
  };
}

// Platform onboarding is available before a creator joins any project. Project
// courses retain the same membership checks as the website.
export async function listCollegeCourses(user: AuthUser) {
  const catalog = await rows<CollegeRow>(
    'SELECT id,tier,title,cover,intro,duration FROM college_courses WHERE published=1 ORDER BY display_order,id',
  );
  const result: { key: string; title: string; subtitle: string; courses: CourseCard[] }[] = tiers
    .map((tier) => ({ ...tier, courses: catalog.filter((c) => c.tier === tier.key).map(card) }))
    .filter((tier) => tier.courses.length > 0);
  for (const project of await listProjects(user)) {
    if (!project.isEnabled) continue;
    const courses: CourseCard[] = (await listProjectCourses(user, project.id))
      .filter((c) => c.isActive)
      .map((c) => ({
        id: c.id,
        projectId: c.projectId,
        title: c.courseName,
        intro: '项目课程',
        cover: '',
        tier: 'silver',
        url: c.courseUrl,
        views: null,
        duration: '',
      }));
    if (courses.length) result.push({ key: project.id, title: project.name, subtitle: '项目课程', courses });
  }
  return { tiers: result, total: result.reduce((n, tier) => n + tier.courses.length, 0) };
}

export async function getCollegeCourse(user: AuthUser, id: string) {
  if (!/^\d+$/.test(id)) {
    const [course] = await rows<CollegeRow>('SELECT * FROM college_courses WHERE id=? AND published=1', [id]);
    if (!course) throw new AppError(404, 40400, '课程不存在或已下架');
    return { ...card(course), sections: course.sections };
  }
  const [ref] = await rows(
    'SELECT c.project_id FROM project_courses c JOIN projects p ON p.id=c.project_id WHERE c.id=? AND p.is_enabled=1',
    [id],
  );
  if (!ref) throw new AppError(404, 40400, '课程不存在或已下架');
  const course = (await listProjectCourses(user, String(ref.project_id))).find((c) => c.id === id && c.isActive);
  if (!course) throw new AppError(404, 40400, '课程不存在或已下架');
  return {
    id,
    projectId: course.projectId,
    title: course.courseName,
    tier: 'silver',
    cover: '',
    intro: '项目课程',
    duration: '',
    views: null,
    url: course.courseUrl,
    sections: course.courseUrl ? [{ title: '课程链接', content: course.courseUrl }] : [],
  };
}
