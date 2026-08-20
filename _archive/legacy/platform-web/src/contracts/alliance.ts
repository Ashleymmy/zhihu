import { z } from "zod";

const ID_PATTERN = /^[^\s]+$/u;
const SNOWFLAKE_PATTERN = /^[1-9][0-9]{0,19}$/u;
const TIMEZONE_ISO_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u;
export const MAX_PAGE = Math.floor(Number.MAX_SAFE_INTEGER / 100) + 1;

const idSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(ID_PATTERN, "ID 必须是非空字符串");
const publicIdSchema = z
  .string()
  .regex(SNOWFLAKE_PATTERN, "上游 ID 必须是有限长度数字字符串");
const nonEmptyStringSchema = z.string().trim().min(1).max(2048);
const httpUrlSchema = z
  .string()
  .url()
  .max(2048)
  .refine((value) => /^https?:\/\//iu.test(value), "必须是 HTTP URL");
const finiteScalarSchema = z.union([z.string(), z.number().finite()]);

export const MEDIA_TYPES = [
  "KOC视频号",
  "KOC百家号",
  "KOC抖音",
  "KOC快手",
  "KOC微博",
  "KOC小红书",
  "KOC定向",
  "KOC头条号",
  "KOC哔哩哔哩",
  "KOC公众号",
] as const;

const releaseTimeSchema = z
  .string()
  .regex(TIMEZONE_ISO_PATTERN, "releaseTime 必须包含显式时区")
  .refine((value) => {
    const timestamp = Date.parse(value);
    return (
      Number.isFinite(timestamp) &&
      Number.isSafeInteger(Math.floor(timestamp / 1000)) &&
      timestamp >= 0
    );
  }, "releaseTime 必须是有效的非负 epoch 时间");

const fileLikeSchema = z.custom<File>((value): value is File => {
  return typeof File !== "undefined" && value instanceof File;
}, "必须提供文件");

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" as const;
const MAX_BATCH_FILE_BYTES = 10 * 1024 * 1024;

function isSafeBatchFilename(name: string): boolean {
  let normalized: string;
  try {
    normalized = name.normalize("NFC");
  } catch {
    return false;
  }
  const bytes = new TextEncoder().encode(normalized).byteLength;
  return (
    bytes >= 1 &&
    bytes <= 255 &&
    normalized === normalized.trim() &&
    !/[\u0000-\u001f\u007f\u0080-\u009f\u202a-\u202e\u2066-\u2069/\\:]/u.test(
      normalized,
    ) &&
    /^[^.].*\.xlsx$/iu.test(normalized) &&
    /\.xlsx$/iu.test(normalized) &&
    !/\.[^.]+\.xlsx$/iu.test(normalized)
  );
}

export const batchFileSchema = fileLikeSchema.superRefine((file, context) => {
  const candidate = file as unknown as {
    name: unknown;
    type?: unknown;
    size?: unknown;
  };
  if (
    typeof candidate.name !== "string" ||
    !isSafeBatchFilename(candidate.name)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "文件名不符合要求",
    });
  }
  if (candidate.type !== XLSX_MIME) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "文件类型不符合要求",
    });
  }
  if (
    typeof candidate.size !== "number" ||
    !Number.isSafeInteger(candidate.size) ||
    candidate.size < 1 ||
    candidate.size > MAX_BATCH_FILE_BYTES
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "文件大小不符合要求",
    });
  }
});

export const batchTaskDataSchema = z
  .object({ batchTaskId: publicIdSchema })
  .strict();

function isNativeFormData(value: unknown): value is FormData {
  return typeof FormData !== "undefined" && value instanceof FormData;
}

export const batchFormDataSchema = z.custom<FormData>(
  isNativeFormData,
  "必须使用原生 FormData",
);

export const XLSX_CONTENT_TYPE = XLSX_MIME;
export const XLSX_MAX_BYTES = MAX_BATCH_FILE_BYTES;

export async function validateBatchFileMagic(file: File): Promise<void> {
  const bytes = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  if (
    bytes.length < 4 ||
    bytes[0] !== 0x50 ||
    bytes[1] !== 0x4b ||
    bytes[2] !== 0x03 ||
    bytes[3] !== 0x04
  ) {
    throw new Error("文件内容不符合要求");
  }
}

export const createPlanRequestSchema = z
  .object({
    taskId: idSchema,
    channelId: idSchema,
    contentUrl: httpUrlSchema,
    popularizeType: z.literal(0),
    keyword: nonEmptyStringSchema,
    secondChannelId: idSchema.optional(),
  })
  .strict();

export const batchPlanRequestSchema = z
  .object({
    file: batchFileSchema,
    taskId: idSchema,
    channelId: idSchema,
    popularizeType: z.literal(0),
    secondChannelId: idSchema.optional(),
  })
  .strict();

const compositionFields = {
  planId: idSchema,
  channelId: idSchema,
  mediaType: z.enum(MEDIA_TYPES),
  mediaAccount: nonEmptyStringSchema,
  compositionType: z.number().int().min(0).max(2),
  compositionSubType: z.number().int().min(1).max(11),
  compositionUrl: httpUrlSchema,
  releaseTime: releaseTimeSchema,
};

function isSupportedCompositionCategory(
  compositionType: number,
  compositionSubType: number,
): boolean {
  return (
    (compositionType === 0 && compositionSubType === 11) ||
    (compositionType === 1 &&
      compositionSubType >= 1 &&
      compositionSubType <= 4) ||
    (compositionType === 2 &&
      compositionSubType >= 5 &&
      compositionSubType <= 10)
  );
}

function compositionRequestSchema() {
  return z
    .object(compositionFields)
    .strict()
    .superRefine((value, context) => {
      if (
        !isSupportedCompositionCategory(
          value.compositionType,
          value.compositionSubType,
        )
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["compositionSubType"],
          message: "作品分类组合不受支持",
        });
      }
    });
}

export const createCompositionRequestSchema = compositionRequestSchema();
export const updateCompositionRequestSchema = compositionRequestSchema();

export const batchCompositionRequestSchema = z
  .object({
    file: batchFileSchema,
    bindType: z.union([z.literal(1), z.literal(2)]),
    channelId: idSchema,
  })
  .strict();

export const compositionIdSchema = publicIdSchema;

export const compositionListQuerySchema = z
  .object({
    channelId: idSchema,
    keyword: nonEmptyStringSchema,
    page: z.number().int().min(1).max(MAX_PAGE),
    pageSize: z.number().int().min(1).max(100),
  })
  .strict();

const realtimeFieldNames = ["search_num", "order_num", "created_at"] as const;
export const realTimeQuerySchema = z
  .object({
    type: z.literal(1),
    timeScale: z.literal(1),
    fields: z
      .string()
      .min(1)
      .max(128)
      .refine((value) => {
        const fields = value.split(",");
        return (
          fields.length > 0 &&
          fields.every((field) =>
            (realtimeFieldNames as readonly string[]).includes(field),
          ) &&
          new Set(fields).size === fields.length
        );
      }, "fields 不是受支持的唯一字段集合"),
  })
  .strict();

export const requestIdSchema = z.string().min(1).max(256);
export const timestampSchema = z.number().int().safe().nonnegative();

export const allianceMetaSchema = z
  .object({
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1).max(100),
    total: z.number().int().safe().nonnegative(),
  })
  .strict();

export const successEnvelopeSchema = z
  .object({
    code: z.literal(0),
    message: z.string().min(1),
    data: z.unknown(),
    requestId: requestIdSchema,
    timestamp: timestampSchema,
  })
  .strict();

export const pagedSuccessEnvelopeSchema = successEnvelopeSchema.extend({
  meta: allianceMetaSchema,
});

export const failureEnvelopeSchema = z
  .object({
    code: z
      .number()
      .int()
      .safe()
      .refine((code) => code !== 0, "失败 code 不能为 0"),
    message: z.string().min(1),
    requestId: requestIdSchema,
    timestamp: timestampSchema,
    details: z.record(z.string(), z.array(z.string())).optional(),
  })
  .strict();

export const allianceSuccessEnvelopeSchema = successEnvelopeSchema;
export const alliancePagedSuccessEnvelopeSchema = pagedSuccessEnvelopeSchema;
export const allianceFailureEnvelopeSchema = failureEnvelopeSchema;

export const createPlanDataSchema = z
  .object({ planId: publicIdSchema })
  .strict();
export const createCompositionDataSchema = z
  .object({ compositionId: publicIdSchema })
  .strict();

export const compositionListItemSchema = z
  .object({
    compositionId: publicIdSchema,
    compositionUrl: httpUrlSchema,
    submitTime: finiteScalarSchema,
    compositionType: z.number().int().min(0).max(2),
    compositionSubType: z.number().int().min(1).max(11),
    keyword: nonEmptyStringSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      !isSupportedCompositionCategory(
        value.compositionType,
        value.compositionSubType,
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["compositionSubType"],
        message: "作品分类组合不受支持",
      });
    }
  });

export const compositionListDataSchema = z.array(compositionListItemSchema);

const realtimeFieldsDataSchema = z
  .object({
    searchNum: finiteScalarSchema.optional(),
    orderNum: finiteScalarSchema.optional(),
    createdAt: finiteScalarSchema.optional(),
  })
  .strict();

export const realTimeDataItemSchema = z
  .object({
    keyword: nonEmptyStringSchema,
    channelId: idSchema,
    channelName: nonEmptyStringSchema,
    fieldsData: realtimeFieldsDataSchema,
  })
  .strict();

export const realTimeDataSchema = z
  .object({
    timeRange: nonEmptyStringSchema,
    items: z.array(realTimeDataItemSchema),
  })
  .strict();

export type CreatePlanRequest = z.infer<typeof createPlanRequestSchema>;
export type BatchPlanRequest = z.infer<typeof batchPlanRequestSchema>;
export type CreateCompositionRequest = z.infer<
  typeof createCompositionRequestSchema
>;
export type UpdateCompositionRequest = z.infer<
  typeof updateCompositionRequestSchema
>;
export type BatchCompositionRequest = z.infer<
  typeof batchCompositionRequestSchema
>;
export type BatchTaskData = z.infer<typeof batchTaskDataSchema>;
export type CompositionListQuery = z.infer<typeof compositionListQuerySchema>;
export type AllianceMeta = z.infer<typeof allianceMetaSchema>;
export type CreatePlanData = z.infer<typeof createPlanDataSchema>;
export type CreateCompositionData = z.infer<typeof createCompositionDataSchema>;
export type CompositionListItem = z.infer<typeof compositionListItemSchema>;
export type RealTimeDataItem = z.infer<typeof realTimeDataItemSchema>;
export type RealTimeData = z.infer<typeof realTimeDataSchema>;
export type AllianceSuccessEnvelope = z.infer<typeof successEnvelopeSchema>;
export type AllianceFailureEnvelope = z.infer<typeof failureEnvelopeSchema>;
