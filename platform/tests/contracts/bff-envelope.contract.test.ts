import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  bffFailureEnvelopeSchema,
  bffPaginationMetaSchema,
  createBffPaginatedEnvelopeSchema,
  createBffSuccessEnvelopeSchema,
} from '../../src/contracts/bff-envelope'

const itemSchema = z.object({
  id: z.string(),
}).strict()

const successEnvelopeSchema = createBffSuccessEnvelopeSchema(itemSchema)
const paginatedEnvelopeSchema = createBffPaginatedEnvelopeSchema(itemSchema)

type Assert<T extends true> = T
type HasRequiredData<T extends { data?: unknown }> = {} extends Pick<T, 'data'> ? false : true
type OptionalSuccessEnvelope = z.infer<ReturnType<
  typeof createBffSuccessEnvelopeSchema<z.ZodOptional<z.ZodString>>
>>
type OptionalSuccessEnvelopeRequiresData = Assert<HasRequiredData<OptionalSuccessEnvelope>>

const validSuccessEnvelope = {
  code: 0,
  message: 'ok',
  data: { id: 'item-1' },
  requestId: 'request-success',
  timestamp: 0,
}

const validPaginatedEnvelope = {
  code: 0,
  message: 'ok',
  data: [{ id: 'item-1' }],
  requestId: 'request-page',
  timestamp: 0,
  meta: {
    page: 1,
    pageSize: 100,
    total: 0,
  },
}

const validFailureEnvelope = {
  code: -1,
  message: 'validation failed',
  requestId: 'request-failure',
  timestamp: 0,
  details: {
    title: ['required'],
  },
}

function expectSchemaToReject(schema: z.ZodTypeAny, value: unknown) {
  expect(schema.safeParse(value).success).toBe(false)
}

describe('BFF Envelope Contract', () => {
  it('BFF-CONTRACT-001 validates ordinary success Envelope values and boundaries', () => {
    expect(successEnvelopeSchema.parse(validSuccessEnvelope)).toEqual(validSuccessEnvelope)
    expect(successEnvelopeSchema.safeParse({
      ...validSuccessEnvelope,
      timestamp: Number.MAX_SAFE_INTEGER,
    }).success).toBe(true)

    for (const { name, dataSchema, validData } of [
      { name: 'unknown', dataSchema: z.unknown(), validData: null },
      { name: 'any', dataSchema: z.any(), validData: null },
      { name: 'optional', dataSchema: z.string().optional(), validData: 'value' },
      { name: 'unionUndefined', dataSchema: z.union([z.string(), z.undefined()]), validData: 'value' },
    ]) {
      const schema = createBffSuccessEnvelopeSchema(dataSchema)
      expect(schema.safeParse({ ...validSuccessEnvelope, data: validData }).success, name).toBe(true)
      expectSchemaToReject(schema, {
        code: 0,
        message: 'ok',
        requestId: 'request-required-data',
        timestamp: 0,
      })
      expectSchemaToReject(schema, { ...validSuccessEnvelope, data: undefined })
    }

    const nullDataSchema = createBffSuccessEnvelopeSchema(z.null())
    expect(nullDataSchema.safeParse({ ...validSuccessEnvelope, data: null }).success).toBe(true)
    expectSchemaToReject(nullDataSchema, { ...validSuccessEnvelope, data: undefined })

    const inheritedDataEnvelope = Object.assign(Object.create({ data: 'inherited' }), {
      code: 0,
      message: 'ok',
      requestId: 'request-inherited-data',
      timestamp: 0,
    })
    expectSchemaToReject(createBffSuccessEnvelopeSchema(z.string()), inheritedDataEnvelope)

    for (const code of ['0', 'OK', Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      expectSchemaToReject(successEnvelopeSchema, { ...validSuccessEnvelope, code })
    }

    for (const requestId of ['', '   ']) {
      expectSchemaToReject(successEnvelopeSchema, { ...validSuccessEnvelope, requestId })
    }

    for (const timestamp of ['0', -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      expectSchemaToReject(successEnvelopeSchema, { ...validSuccessEnvelope, timestamp })
    }
  })

  it('BFF-CONTRACT-002 validates paginated Envelope and meta boundaries', () => {
    expect(paginatedEnvelopeSchema.parse(validPaginatedEnvelope)).toEqual(validPaginatedEnvelope)
    expect(bffPaginationMetaSchema.parse({ page: 1, pageSize: 100, total: 0 })).toEqual({
      page: 1,
      pageSize: 100,
      total: 0,
    })
    expect(paginatedEnvelopeSchema.safeParse({
      ...validPaginatedEnvelope,
      data: [],
    }).success).toBe(true)

    for (const meta of [
      { page: 0, pageSize: 1, total: 0 },
      { page: 1.5, pageSize: 1, total: 0 },
      { page: 1, pageSize: 0, total: 0 },
      { page: 1, pageSize: 101, total: 0 },
      { page: 1, pageSize: 1.5, total: 0 },
      { page: 1, pageSize: 1, total: -1 },
      { page: 1, pageSize: 1, total: 0.5 },
      { page: 1, pageSize: '1', total: 0 },
      { page: 1, pageSize: 1, total: '0' },
      { page: 1, pageSize: 1, total: 0, cursor: 'unexpected' },
    ]) {
      expectSchemaToReject(paginatedEnvelopeSchema, { ...validPaginatedEnvelope, meta })
    }

    expectSchemaToReject(paginatedEnvelopeSchema, {
      ...validPaginatedEnvelope,
      data: [{ id: 1 }],
    })
  })

  it('BFF-CONTRACT-003 validates failure Envelope code and details', () => {
    expect(bffFailureEnvelopeSchema.parse(validFailureEnvelope)).toEqual(validFailureEnvelope)
    expect(bffFailureEnvelopeSchema.safeParse({
      ...validFailureEnvelope,
      code: Number.MAX_SAFE_INTEGER,
      details: undefined,
    }).success).toBe(true)

    for (const code of [0, '1', 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      expectSchemaToReject(bffFailureEnvelopeSchema, { ...validFailureEnvelope, code })
    }

    for (const details of [
      { title: 'required' },
      { title: { messages: ['required'] } },
      { title: [1] },
    ]) {
      expectSchemaToReject(bffFailureEnvelopeSchema, { ...validFailureEnvelope, details })
    }
  })

  it('BFF-CONTRACT-004 rejects unknown fields, upstream leaks, and type deception', () => {
    expect(successEnvelopeSchema.safeParse(validSuccessEnvelope).success).toBe(true)
    expect(paginatedEnvelopeSchema.safeParse(validPaginatedEnvelope).success).toBe(true)
    expect(bffFailureEnvelopeSchema.safeParse(validFailureEnvelope).success).toBe(true)

    expectSchemaToReject(successEnvelopeSchema, { ...validSuccessEnvelope, traceId: 'upstream-trace' })
    expectSchemaToReject(paginatedEnvelopeSchema, { ...validPaginatedEnvelope, upstream: { status: 200 } })
    expectSchemaToReject(bffFailureEnvelopeSchema, { ...validFailureEnvelope, status: 502 })
    expectSchemaToReject(successEnvelopeSchema, {
      ...validSuccessEnvelope,
      data: { id: 1 },
    })
    expectSchemaToReject(paginatedEnvelopeSchema, {
      ...validPaginatedEnvelope,
      meta: { page: '1', pageSize: 1, total: 0 },
    })
    expectSchemaToReject(bffFailureEnvelopeSchema, {
      ...validFailureEnvelope,
      code: new Number(1),
    })
  })

  it('BFF-CONTRACT-005 rejects legacy Mock and pagination shapes', () => {
    expect(paginatedEnvelopeSchema.safeParse(validPaginatedEnvelope).success).toBe(true)

    expectSchemaToReject(successEnvelopeSchema, { ...validSuccessEnvelope, success: true })
    expectSchemaToReject(bffFailureEnvelopeSchema, { ...validFailureEnvelope, error: 'legacy error' })
    expectSchemaToReject(paginatedEnvelopeSchema, { ...validPaginatedEnvelope, items: [] })
    expectSchemaToReject(paginatedEnvelopeSchema, { ...validPaginatedEnvelope, list: [] })
    expectSchemaToReject(paginatedEnvelopeSchema, { ...validPaginatedEnvelope, page_size: 20 })
    expectSchemaToReject(paginatedEnvelopeSchema, {
      ...validPaginatedEnvelope,
      data: {
        items: [{ id: 'item-1' }],
        page: 1,
        pageSize: 20,
        total: 1,
      },
    })
    expectSchemaToReject(successEnvelopeSchema, {
      code: 0,
      message: 'ok',
      data: { id: 'item-1' },
      timestamp: 0,
    })
    expectSchemaToReject(paginatedEnvelopeSchema, {
      code: 0,
      message: 'ok',
      data: [{ id: 'item-1' }],
      requestId: 'request-page',
      meta: { page: 1, pageSize: 20, total: 1 },
    })
    expectSchemaToReject(bffFailureEnvelopeSchema, {
      code: 1,
      message: 'failed',
      requestId: 'request-failure',
    })
  })
})
