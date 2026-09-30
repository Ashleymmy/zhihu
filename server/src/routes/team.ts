import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware';
import { requirePermission } from '../auth/permissions';
import { asyncHandler } from '../middleware/errors';
import { validateBody } from '../middleware/validate';
import { createMember, deleteMember, disableMember, listMembers, resetPassword, updateMember, listLeaders, myTeam, applyToTeam, listMyApplications, listApplications, reviewApplication, cancelMyApplication } from '../services/team.service';
import { ok } from '../utils/response';
import { createInvitation, listInvitations, revokeInvitation, invitationLink, updateInvitation, regenerateInvitation, deleteInvitation } from '../services/invitations.service';
import { updateMemberAccess } from '../services/member-access.service';

const id = z.string().regex(/^\d+$/);
const create = z.object({
  username: z.string().trim().min(1).max(64),
  displayName: z.string().trim().min(1).max(64),
  phone: z.string().max(20).nullable().optional(),
  role: z
    .enum(['leader', 'member', 'creator'])
    .transform((value) => (value === 'member' ? 'creator' : value))
    .optional(),
  parentId: id.nullable().optional(),
});
const update = z.object({
  displayName: z.string().trim().min(1).max(64).optional(),
  phone: z.string().max(20).nullable().optional(),
});
const resetPwd = z.object({
  password: z.string().min(8).max(128).optional(),
});
const apply = z.object({
  leaderUsername: z.string().trim().min(1).max(64),
  message: z.string().trim().max(500).optional(),
});
const review = z.object({
  action: z.enum(['approve', 'reject']),
});
export const teamRouter = Router();
teamRouter.use(requireAuth);
teamRouter.get('/invitations',requirePermission('team.create_member'),asyncHandler(async(req,res)=>ok(res,await listInvitations(req.user))));
teamRouter.get('/invitations/:id/link',requirePermission('team.create_member'),asyncHandler(async(req,res)=>{res.set('Cache-Control','no-store');ok(res,await invitationLink(req.user,id.parse(req.params.id)))}));
teamRouter.patch('/invitations/:id',requirePermission('team.create_member'),validateBody(z.object({label:z.string().trim().min(1).max(100).optional(),maxUses:z.number().int().min(1).max(1000).optional(),expiresAt:z.string().datetime().optional(),enabled:z.boolean().optional()}).strict().refine(v=>Object.keys(v).length>0)),asyncHandler(async(req,res)=>{await updateInvitation(req.user,id.parse(req.params.id),req.body);ok(res,null)}));
teamRouter.post('/invitations/:id/regenerate',requirePermission('team.create_member'),asyncHandler(async(req,res)=>{res.set('Cache-Control','no-store');ok(res,await regenerateInvitation(req.user,id.parse(req.params.id)))}));
teamRouter.delete('/invitations/:id',requirePermission('team.create_member'),asyncHandler(async(req,res)=>{await deleteInvitation(req.user,id.parse(req.params.id));ok(res,null)}));
teamRouter.post('/invitations',requirePermission('team.create_member'),validateBody(z.object({label:z.string().trim().min(1).max(100),validDays:z.number().int().min(1).max(30).default(7),maxUses:z.number().int().min(1).max(1000).default(20)}).strict()),asyncHandler(async(req,res)=>ok(res,await createInvitation(req.user,req.body),201)));
teamRouter.post('/invitations/:id/revoke',requirePermission('team.create_member'),asyncHandler(async(req,res)=>{await revokeInvitation(req.user,id.parse(req.params.id));ok(res,null)}));
teamRouter.patch('/members/:id/access',requirePermission('team.create_member'),validateBody(z.object({displayName:z.string().trim().min(1).max(64).optional(),phone:z.string().max(20).nullable().optional(),role:z.enum(['developer','admin','operator','leader','creator']).optional(),adminDuty:z.enum(['all','operations','finance']).optional(),isActive:z.boolean().optional(),parentId:id.nullable().optional(),projectIds:z.array(id).max(200).refine(ids=>new Set(ids).size===ids.length).optional()}).strict().refine(v=>Object.keys(v).length>0)),asyncHandler(async(req,res)=>{await updateMemberAccess(req.user,id.parse(req.params.id),req.body);ok(res,null)}));
teamRouter.get(
  '/members',
  requirePermission('team.view'),
  asyncHandler(async (req, res) => ok(res, await listMembers(req.user))),
);
teamRouter.post(
  '/members',
  requirePermission('team.create_member'),
  validateBody(create),
  asyncHandler(async (req, res) => ok(res, await createMember(req.user, req.body, req.ip), 201)),
);
teamRouter.patch(
  '/members/:id',
  requirePermission('team.create_member'),
  validateBody(update),
  asyncHandler(async (req, res) => {
    await updateMember(req.user, id.parse(req.params.id), req.body, req.ip);
    ok(res, null);
  }),
);
teamRouter.post(
  '/members/:id/reset-password',
  requirePermission('team.reset_pwd'),
  validateBody(resetPwd),
  asyncHandler(async (req, res) => ok(res, await resetPassword(req.user, id.parse(req.params.id), req.ip, req.body.password))),
);
teamRouter.post(
  '/members/:id/disable',
  requirePermission('team.disable'),
  asyncHandler(async (req, res) => {
    await disableMember(req.user, id.parse(req.params.id), req.ip);
    ok(res, null);
  }),
);
teamRouter.delete(
  '/members/:id',
  requirePermission('team.delete'),
  asyncHandler(async (req, res) => {
    await deleteMember(req.user, id.parse(req.params.id), req.ip);
    ok(res, null);
  }),
);
teamRouter.get(
  '/leaders',
  requirePermission('team.apply'),
  asyncHandler(async (_req, res) => ok(res, await listLeaders())),
);
teamRouter.get(
  '/my',
  requirePermission('team.apply'),
  asyncHandler(async (req, res) => ok(res, await myTeam(req.user))),
);
teamRouter.post(
  '/applications',
  requirePermission('team.apply'),
  validateBody(apply),
  asyncHandler(async (req, res) => ok(res, await applyToTeam(req.user, req.body.leaderUsername, req.body.message, req.ip), 201)),
);
teamRouter.get(
  '/applications/mine',
  requirePermission('team.apply'),
  asyncHandler(async (req, res) => ok(res, await listMyApplications(req.user))),
);
teamRouter.get(
  '/applications',
  requirePermission('team.review'),
  asyncHandler(async (req, res) => ok(res, await listApplications(req.user))),
);
teamRouter.post(
  '/applications/:id/cancel',
  requirePermission('team.apply'),
  asyncHandler(async (req, res) => {
    await cancelMyApplication(req.user, id.parse(req.params.id), req.ip);
    ok(res, null);
  }),
);
teamRouter.post(
  '/applications/:id/review',
  requirePermission('team.review'),
  validateBody(review),
  asyncHandler(async (req, res) => {
    await reviewApplication(req.user, id.parse(req.params.id), req.body.action, req.ip);
    ok(res, null);
  }),
);
