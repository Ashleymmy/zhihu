import { RequestHandler } from 'express';
import { ZodTypeAny } from 'zod';

export const validateBody = (schema: ZodTypeAny): RequestHandler => (req, _res, next) => {
  req.body = schema.parse(req.body);
  next();
};

export const validateQuery = (schema: ZodTypeAny): RequestHandler => (req, _res, next) => {
  Object.assign(req.query, schema.parse(req.query));
  next();
};
