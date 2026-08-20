/**
 * 基础文件上传服务
 * 来源：docs/03-接口文档.md § 15.1
 *
 * 通用上传接口，替代 § 11.1，额外返回 file_url 可直接预览。
 * 所有需要上传截图的场景（评论截流 §11.2、风险举报 §14.1）统一走这里。
 */
import { apiPost } from '@/infra/http'
import { API_PATHS } from '@/constants/api-paths'
import { FileType } from '@/constants/enums'
import type { UploadFileResponse } from '@/types/models'

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png'] as const
const MAX_IMAGE_BYTES = 2 * 1024 * 1024 // 2 MB

/** 前端校验文件格式和大小，避免无效请求消耗日配额 */
export function validateImageFile(file: File): string | null {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type as typeof ALLOWED_IMAGE_TYPES[number])) {
    return '只支持 jpeg / png 格式的图片'
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return `图片不能超过 2 MB，当前 ${(file.size / 1024 / 1024).toFixed(2)} MB`
  }
  return null
}

/**
 * § 15.1 文件上传
 *
 * 目前只支持 file_type=1（图片）。
 * 返回的 file_token 用于 §11.2 / §14.1 的 image_tokens 参数（多个用逗号拼接）。
 * 返回的 file_url 可直接用于 <img> 预览。
 */
export function uploadFile(file: File, fileType = FileType.Image): Promise<UploadFileResponse> {
  const err = validateImageFile(file)
  if (err) return Promise.reject(new Error(err))

  const formData = new FormData()
  formData.append('file_type', String(fileType))
  formData.append('file', file)

  return apiPost<UploadFileResponse>(API_PATHS.FILE_UPLOAD, formData, {
    headers: {
      'X-Requested-With': 'openApi',
      'Content-Type': 'multipart/form-data',
    },
  })
}
