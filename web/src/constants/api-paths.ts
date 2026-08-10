/**
 * API 路径常量
 * 所有接口路径集中管理，修改时只改这里
 * docs/03-接口文档.md §一
 */
export const API_PATHS = {
  // 三、推广计划管理
  PLAN_CREATE: '/alliance/api/popularize_plan',
  PLAN_BATCH_CREATE: '/alliance/api/popularize_plans',

  // 四、推广作品管理（v2 优先，v1 将于 2026-08-25 下线）
  COMPOSITION_V2_CREATE: '/alliance/api/popularize_composition/v2',
  COMPOSITION_V2_BATCH_CREATE: '/alliance/api/popularize_compositions/v2',
  COMPOSITION_V2_UPDATE: (id: string) => `/alliance/api/popularize_composition/v2/${id}`,
  COMPOSITION_V2_LIST: '/alliance/api/popularize_compositions',
  // v1（已废弃，保留兼容）
  COMPOSITION_CREATE: '/alliance/api/popularize_composition',
  COMPOSITION_BATCH_CREATE: '/alliance/api/popularize_compositions',
  COMPOSITION_UPDATE: (id: string) => `/alliance/api/popularize_composition/${id}`,
  COMPOSITION_LIST: '/alliance/api/popularize_compositions',

  // 五、代理渠道管理
  AGENT_CHANNELS: '/alliance/api/get_agent_channels',
  SECOND_CHANNELS: '/alliance/api/second_channels',

  // 六、批量任务管理
  BATCH_TASK_RESULT: (batchTaskId: string) =>
    `/alliance/api/get_batch_task_result/${batchTaskId}`,

  // 七、推广任务管理
  POPULARIZE_TASKS: '/alliance/api/popularize_tasks',

  // 八、数据报表
  REAL_TIME_DATA: '/alliance/api/data_report/real_time_data',

  // 九、盐选内容榜单
  VIP_RULE_LABELS: '/alliance/api/vip/content/rule/labels',
  VIP_RULE_CONTENTS: '/alliance/api/vip/rule_contents',
  VIP_RULE_CONTENT_DETAIL: (contentId: string) =>
    `/alliance/api/vip/rule_content/${contentId}`,
  ONLINE_SECTIONS: '/alliance/api/online_sections',

  // 十、有声书
  AUDIO_CONTENTS: '/alliance/api/vip/audio/contents',
  AUDIO_DOWNLOAD: (sectionId: string) =>
    `/alliance/api/vip/audio/${sectionId}/download`,

  // 十一、评论截流举报
  INTERCEPT_IMAGE_UPLOAD: '/alliance/api/intercept_words/image_upload',
  INTERCEPT_WORDS: '/alliance/api/intercept_words',

  // 十二、漫剧内容
  COMIC_DRAMAS: '/alliance/api/comic_dramas',
  COMIC_DRAMA_EPISODES: (dramaId: string) =>
    `/alliance/api/comic_drama/${dramaId}/episodes`,

  // 十三、内容标签
  CONTENT_TAG: '/alliance/api/content_tag',
  CONTENT_TAGS: '/alliance/api/content_tags',

  // 十四、风险举报
  RISK_WORDS: '/alliance/api/risk_words',

  // 十五、基础接口
  FILE_UPLOAD: '/alliance/api/basic/file_upload',
} as const
