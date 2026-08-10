/**
 * 基础接口类型
 * 来源：docs/03-接口文档.md § 十五
 */
import type { FileType } from '@/constants/enums'

// ─── § 15.1 文件上传 ──────────────────────────────────────────────────────────
export interface UploadFileFormFields {
  /** 文件类型，见 § 2.6，目前只支持 1（图片）*/
  file_type: FileType
}

export interface UploadFileResponse {
  /** 用于 § 11.2 / § 14.1 的 image_tokens 参数 */
  file_token: string
  /** 可直接用于前端预览 */
  file_url:   string
}
