/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string
  readonly VITE_ACCESS_TOKEN: string
  readonly VITE_SECRET_KEY: string
  readonly VITE_TASK_ID: string
  readonly VITE_CHANNEL_ID: string
  readonly VITE_ENABLE_LOCAL_SIGN: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
