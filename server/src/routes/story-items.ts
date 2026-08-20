import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware';
import { asyncHandler } from '../middleware/errors';
import { validateBody, validateQuery } from '../middleware/validate';
import {
  createStoryItem,
  deleteStoryItem,
  listStoryItems,
  STORY_ITEM_TYPES,
  updateStoryItem,
} from '../services/story-items.service';
import { ok } from '../utils/response';

const id = z.string().regex(/^\d+$/);
const typeSchema = z.enum(STORY_ITEM_TYPES);
const listQuery = z.object({
  type: typeSchema,
  includeArchived: z.enum(['true', 'false']).optional(),
});
const create = z.object({
  type: typeSchema,
  title: z.string().trim().min(1).max(255),
  url: z.string().url().max(1024).nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
});
const patch = z.object({
  title: z.string().trim().min(1).max(255).optional(),
  url: z.string().url().max(1024).nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
  status: z.enum(['active', 'archived']).optional(),
});

export const storyItemsRouter = Router();
storyItemsRouter.use(requireAuth);
storyItemsRouter.get(
  '/',
  validateQuery(listQuery),
  asyncHandler(async (req, res) =>
    ok(res, await listStoryItems(req.user, req.query.type as never, req.query.includeArchived === 'true')),
  ),
);
storyItemsRouter.post(
  '/',
  validateBody(create),
  asyncHandler(async (req, res) => ok(res, await createStoryItem(req.user, req.body, req.ip), 201)),
);
storyItemsRouter.patch(
  '/:id',
  validateBody(patch),
  asyncHandler(async (req, res) => {
    await updateStoryItem(req.user, id.parse(req.params.id), req.body, req.ip);
    ok(res, null);
  }),
);
storyItemsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    await deleteStoryItem(req.user, id.parse(req.params.id), req.ip);
    ok(res, null);
  }),
);
