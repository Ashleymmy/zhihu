import axios, {
  type AxiosInstance,
  type AxiosRequestConfig,
  type AxiosResponse,
} from "axios";
import { z } from "zod";
import {
  allianceMetaSchema,
  failureEnvelopeSchema,
  pagedSuccessEnvelopeSchema,
  successEnvelopeSchema,
  type AllianceMeta,
} from "@/contracts/alliance";

export class AllianceProtocolError extends Error {
  constructor(message = "Alliance 响应不符合严格契约") {
    super(message);
    this.name = "AllianceProtocolError";
  }
}

export class AllianceHttpError extends Error {
  readonly code: number;
  readonly status: number;
  readonly details?: Record<string, string[]>;

  constructor(
    code: number,
    message: string,
    status: number,
    details?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "AllianceHttpError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export interface AllianceHttpClient {
  requestData<T>(
    config: AxiosRequestConfig,
    requestSchema: z.ZodType<unknown>,
    dataSchema: z.ZodType<T>,
  ): Promise<T>;
  requestPage<T>(
    config: AxiosRequestConfig,
    requestSchema: z.ZodType<unknown>,
    dataSchema: z.ZodType<T>,
  ): Promise<{ data: T; meta: AllianceMeta }>;
}

function authToken(): string | undefined {
  if (typeof localStorage === "undefined") return undefined;
  return localStorage.getItem("token") ?? undefined;
}

function createAxiosClient(): AxiosInstance {
  return axios.create({
    baseURL: "/api",
    timeout: 15_000,
    headers: { "Content-Type": "application/json" },
    validateStatus: () => true,
  });
}

function withAuth(config: AxiosRequestConfig): AxiosRequestConfig {
  const token = authToken();
  if (!token) return config;
  return {
    ...config,
    headers: {
      ...(config.headers ?? {}),
      Authorization: `Bearer ${token}`,
    },
  };
}

function parseFailure(
  response: AxiosResponse<unknown>,
): AllianceHttpError | undefined {
  const parsed = failureEnvelopeSchema.safeParse(response.data);
  if (!parsed.success) return undefined;
  return new AllianceHttpError(
    parsed.data.code,
    parsed.data.message,
    response.status,
    parsed.data.details,
  );
}

function protocolFailure(): never {
  throw new AllianceProtocolError();
}

function transportFailure(error: unknown): never {
  if (axios.isAxiosError(error)) {
    throw new AllianceHttpError(
      0,
      "Alliance 网络请求失败",
      error.response?.status ?? 0,
    );
  }
  throw new AllianceHttpError(0, "Alliance 网络请求失败", 0);
}

function parseData<T>(
  response: AxiosResponse<unknown>,
  dataSchema: z.ZodType<T>,
): T {
  const failure = parseFailure(response);
  if (failure) throw failure;
  if (response.status < 200 || response.status >= 300) protocolFailure();

  const envelope = successEnvelopeSchema.safeParse(response.data);
  if (!envelope.success) protocolFailure();
  const data = dataSchema.safeParse(envelope.data.data);
  if (!data.success) protocolFailure();
  return data.data;
}

function parsePage<T>(
  response: AxiosResponse<unknown>,
  dataSchema: z.ZodType<T>,
): { data: T; meta: AllianceMeta } {
  const failure = parseFailure(response);
  if (failure) throw failure;
  if (response.status < 200 || response.status >= 300) protocolFailure();

  const envelope = pagedSuccessEnvelopeSchema.safeParse(response.data);
  if (!envelope.success) protocolFailure();
  const data = dataSchema.safeParse(envelope.data.data);
  const meta = allianceMetaSchema.safeParse(envelope.data.meta);
  if (!data.success || !meta.success) protocolFailure();
  return { data: data.data, meta: meta.data };
}

function requestInput(
  config: AxiosRequestConfig,
  schema: z.ZodType<unknown>,
): AxiosRequestConfig {
  if (config.method?.toUpperCase() === "GET") {
    return { ...config, params: schema.parse(config.params ?? {}) };
  }
  return { ...config, data: schema.parse(config.data ?? {}) };
}

function stripJsonContentType(config: AxiosRequestConfig): AxiosRequestConfig {
  const data = config.data;
  const isFormDataValue =
    data !== null &&
    typeof data === "object" &&
    typeof (data as { append?: unknown }).append === "function" &&
    typeof (data as { entries?: unknown }).entries === "function";
  if (!isFormDataValue) return config;
  const headers = { ...(config.headers ?? {}) } as Record<string, unknown>;
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === "content-type") delete headers[key];
  }
  headers["Content-Type"] = undefined;
  return { ...config, headers: headers as AxiosRequestConfig["headers"] };
}

export function createAllianceHttpClient(
  client: AxiosInstance = createAxiosClient(),
): AllianceHttpClient {
  async function send(
    config: AxiosRequestConfig,
    requestSchema: z.ZodType<unknown>,
  ): Promise<AxiosResponse<unknown>> {
    const validated = stripJsonContentType(requestInput(config, requestSchema));
    try {
      return await client.request<unknown>(withAuth(validated));
    } catch (error: unknown) {
      return transportFailure(error);
    }
  }

  return {
    async requestData<T>(
      config: AxiosRequestConfig,
      requestSchema: z.ZodType<unknown>,
      dataSchema: z.ZodType<T>,
    ) {
      return parseData(await send(config, requestSchema), dataSchema);
    },
    async requestPage<T>(
      config: AxiosRequestConfig,
      requestSchema: z.ZodType<unknown>,
      dataSchema: z.ZodType<T>,
    ) {
      return parsePage(await send(config, requestSchema), dataSchema);
    },
  };
}

export const allianceHttp = createAllianceHttpClient();
