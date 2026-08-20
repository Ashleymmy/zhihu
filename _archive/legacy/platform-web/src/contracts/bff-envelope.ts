import { z } from 'zod'

const requestIdSchema = z.string().min(1).refine(value => value.trim().length > 0, {
  message: 'requestId must not be blank',
})

const timestampSchema = z.number().int().safe().nonnegative()

function hasDefinedOwnData(value: unknown): value is Record<'data', unknown> {
  return typeof value === 'object' && value !== null &&
    Object.prototype.hasOwnProperty.call(value, 'data') &&
    Reflect.get(value, 'data') !== undefined
}

const requiredDataPresenceSchema = z.custom<unknown>(hasDefinedOwnData, {
  message: 'data must be an own property and not undefined',
})

type WithRequiredDefinedData<TEnvelope> = TEnvelope extends { data?: infer TData }
  ? Omit<TEnvelope, 'data'> & { data: Exclude<TData, undefined> }
  : never

function requireOwnDefinedData<TEnvelopeSchema extends z.ZodTypeAny>(
  envelopeSchema: TEnvelopeSchema,
): z.ZodType<
  WithRequiredDefinedData<z.output<TEnvelopeSchema>>,
  z.ZodTypeDef,
  WithRequiredDefinedData<z.input<TEnvelopeSchema>>
> {
  // 在 Zod 对象解析前区分缺失字段、继承字段与显式 undefined。
  return requiredDataPresenceSchema.pipe(envelopeSchema) as z.ZodType<
    WithRequiredDefinedData<z.output<TEnvelopeSchema>>,
    z.ZodTypeDef,
    WithRequiredDefinedData<z.input<TEnvelopeSchema>>
  >
}

const successEnvelopeFields = {
  code: z.literal(0),
  message: z.string(),
  requestId: requestIdSchema,
  timestamp: timestampSchema,
}

export const bffPaginationMetaSchema = z.object({
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1).max(100),
  total: z.number().int().min(0),
}).strict()

export function createBffSuccessEnvelopeSchema<TDataSchema extends z.ZodTypeAny>(
  dataSchema: TDataSchema,
) {
  return requireOwnDefinedData(z.object({
    ...successEnvelopeFields,
    data: dataSchema,
  }).strict())
}

export function createBffPaginatedEnvelopeSchema<TItemSchema extends z.ZodTypeAny>(
  itemSchema: TItemSchema,
) {
  return z.object({
    ...successEnvelopeFields,
    data: z.array(itemSchema),
    meta: bffPaginationMetaSchema,
  }).strict()
}

export const bffFailureEnvelopeSchema = z.object({
  code: z.number().int().safe().refine(value => value !== 0, {
    message: 'code must be a non-zero safe integer',
  }),
  message: z.string(),
  requestId: requestIdSchema,
  timestamp: timestampSchema,
  details: z.record(z.array(z.string())).optional(),
}).strict()

export type BffPaginationMeta = z.infer<typeof bffPaginationMetaSchema>
export type BffFailureEnvelope = z.infer<typeof bffFailureEnvelopeSchema>
export type BffSuccessEnvelope<TDataSchema extends z.ZodTypeAny> = z.infer<
  ReturnType<typeof createBffSuccessEnvelopeSchema<TDataSchema>>
>
export type BffPaginatedEnvelope<TItemSchema extends z.ZodTypeAny> = z.infer<
  ReturnType<typeof createBffPaginatedEnvelopeSchema<TItemSchema>>
>
