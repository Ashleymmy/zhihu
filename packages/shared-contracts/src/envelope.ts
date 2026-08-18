import { z } from 'zod'

/**
 * 唯一 BFF Envelope（02 §Envelope）。所有 BFF 端点响应都必须匹配这些 Schema。
 * 本包不依赖 Vue / Pinia / axios——只描述契约本身。
 */

const requestIdSchema = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, { message: 'requestId must not be blank' })

const timestampSchema = z.number().int().safe().nonnegative()

function hasDefinedOwnData(value: unknown): value is Record<'data', unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.prototype.hasOwnProperty.call(value, 'data') &&
    Reflect.get(value, 'data') !== undefined
  )
}

const requiredDataPresenceSchema = z.custom<unknown>(hasDefinedOwnData, {
  message: 'data must be an own property and not undefined',
})

type WithRequiredDefinedData<TEnvelope> = TEnvelope extends { data?: infer TData }
  ? Omit<TEnvelope, 'data'> & { data: Exclude<TData, undefined> }
  : never

/** 在 Zod 对象解析前区分缺失字段、继承字段与显式 undefined。 */
function requireOwnDefinedData<TEnvelopeSchema extends z.ZodTypeAny>(
  envelopeSchema: TEnvelopeSchema,
): z.ZodType<
  WithRequiredDefinedData<z.output<TEnvelopeSchema>>,
  z.ZodTypeDef,
  WithRequiredDefinedData<z.input<TEnvelopeSchema>>
> {
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

export const bffPaginationMetaSchema = z
  .object({
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1).max(100),
    total: z.number().int().min(0),
  })
  .strict()

export function createBffSuccessEnvelopeSchema<TDataSchema extends z.ZodTypeAny>(dataSchema: TDataSchema) {
  return requireOwnDefinedData(
    z
      .object({
        ...successEnvelopeFields,
        data: dataSchema,
      })
      .strict(),
  )
}

export function createBffPaginatedEnvelopeSchema<TItemSchema extends z.ZodTypeAny>(itemSchema: TItemSchema) {
  return z
    .object({
      ...successEnvelopeFields,
      data: z.array(itemSchema),
      meta: bffPaginationMetaSchema,
    })
    .strict()
}

export const bffFailureEnvelopeSchema = z
  .object({
    code: z
      .number()
      .int()
      .safe()
      .refine((value) => value !== 0, { message: 'code must be a non-zero safe integer' }),
    message: z.string(),
    requestId: requestIdSchema,
    timestamp: timestampSchema,
    details: z.record(z.array(z.string())).optional(),
  })
  .strict()

/** 财务门禁拒绝（50310）：failedGates 非空、去重、稳定顺序。 */
export const financeGateRejectedSchema = bffFailureEnvelopeSchema
  .omit({ code: true })
  .extend({
    code: z.literal(50310),
    failedGates: z
      .array(z.enum(['D-001-DECISION', 'D-001-READINESS', 'P0-008', 'M6']))
      .min(1)
      .refine((gates) => new Set(gates).size === gates.length, { message: 'failedGates must be deduplicated' }),
  })
  .strict()

export type BffPaginationMeta = z.infer<typeof bffPaginationMetaSchema>
export type BffFailureEnvelope = z.infer<typeof bffFailureEnvelopeSchema>
export type FinanceGateRejectedEnvelope = z.infer<typeof financeGateRejectedSchema>
export type BffSuccessEnvelope<TDataSchema extends z.ZodTypeAny> = z.infer<
  ReturnType<typeof createBffSuccessEnvelopeSchema<TDataSchema>>
>
export type BffPaginatedEnvelope<TItemSchema extends z.ZodTypeAny> = z.infer<
  ReturnType<typeof createBffPaginatedEnvelopeSchema<TItemSchema>>
>
