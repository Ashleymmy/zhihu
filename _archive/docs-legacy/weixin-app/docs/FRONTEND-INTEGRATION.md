# 前端接入指南

本文档提供微信小程序前端接入云函数 API 的完整指南和代码示例。

## 目录

1. [快速开始](#快速开始)
2. [认证和会话管理](#认证和会话管理)
3. [文件上传](#文件上传)
4. [报表导入流程](#报表导入流程)
5. [财务确认流程](#财务确认流程)
6. [资金开放流程](#资金开放流程)
7. [提现申请流程](#提现申请流程)
8. [错误处理](#错误处理)
9. [请求键规范](#请求键规范)
10. [分批接口处理](#分批接口处理)

## 快速开始

### 1. 引入工具函数

```javascript
const request = require('../../utils/request')
const upload = require('../../utils/upload')
```

### 2. 基本请求

```javascript
// GET 请求
const projects = await request.get('/core/projects')

// POST 请求
const result = await request.post('/core/auth/login', {
  username: 'user@example.com',
  password: 'password123'
})
```

### 3. 错误处理

```javascript
try {
  const result = await request.post('/some/path', data)
  // 处理成功
} catch (error) {
  if (error.status === 401) {
    // 未授权，跳转登录
    getApp().handleUnauthorized()
  } else if (error.status === 409) {
    // 冲突，提示用户重新操作
    wx.showModal({
      title: '提示',
      content: error.message
    })
  } else {
    // 其他错误
    wx.showToast({
      title: error.message || '操作失败',
      icon: 'none'
    })
  }
}
```

## 认证和会话管理

### 登录流程

```javascript
// pages/login/index.js
Page({
  data: {
    username: '',
    password: ''
  },

  async onLogin() {
    const { username, password } = this.data

    if (!username || !password) {
      wx.showToast({ title: '请输入账号和密码', icon: 'none' })
      return
    }

    wx.showLoading({ title: '登录中...' })

    try {
      const result = await request.post('/core/auth/login', {
        username,
        password
      })

      // 保存 token
      wx.setStorageSync('zk_access_token', result.token)
      wx.setStorageSync('zk_user', result.user)

      if (result.mustChangePwd) {
        // 必须修改密码
        wx.redirectTo({ url: '/pages/password/index' })
      } else {
        // 跳转首页
        wx.switchTab({ url: '/pages/home/index' })
      }
    } catch (error) {
      wx.showToast({
        title: error.message || '登录失败',
        icon: 'none'
      })
    } finally {
      wx.hideLoading()
    }
  }
})
```

### 修改密码

```javascript
async onChangePassword() {
  const { oldPassword, newPassword, confirmPassword } = this.data

  if (newPassword !== confirmPassword) {
    wx.showToast({ title: '两次密码不一致', icon: 'none' })
    return
  }

  wx.showLoading({ title: '修改中...' })

  try {
    await request.post('/core/auth/change-password', {
      oldPassword,
      newPassword
    })

    wx.showToast({ title: '修改成功', icon: 'success' })

    // 跳转首页
    setTimeout(() => {
      wx.switchTab({ url: '/pages/home/index' })
    }, 1500)
  } catch (error) {
    wx.showToast({
      title: error.message || '修改失败',
      icon: 'none'
    })
  } finally {
    wx.hideLoading()
  }
}
```

### 登出

```javascript
async onLogout() {
  try {
    await request.post('/core/auth/logout')
  } catch (error) {
    // 登出失败不阻塞
    console.error('logout error', error)
  } finally {
    // 清理本地缓存
    wx.removeStorageSync('zk_access_token')
    wx.removeStorageSync('zk_user')
    wx.removeStorageSync('zk_project_id')
    wx.removeStorageSync('zk_account_id')

    // 跳转登录页
    wx.reLaunch({ url: '/pages/login/index' })
  }
}
```

### 会话检查

在 `app.js` 中处理未授权：

```javascript
// app.js
App({
  handleUnauthorized() {
    // 清理缓存
    wx.removeStorageSync('zk_access_token')
    wx.removeStorageSync('zk_project_id')

    // 跳转登录
    wx.reLaunch({ url: '/pages/login/index' })
  }
})
```

## 文件上传

### 基本用法

```javascript
const upload = require('../../utils/upload')

Page({
  data: {
    projectId: '',
    accountId: ''
  },

  async onUploadReport() {
    const { projectId, accountId } = this.data

    wx.showLoading({ title: '上传中...' })

    try {
      // 守卫函数：检查会话和项目是否变化
      const guard = () => {
        const currentProject = wx.getStorageSync('zk_project_id')
        return currentProject === projectId
      }

      const fileId = await upload.upload(
        { projectId, accountId },
        'report',
        guard
      )

      wx.showToast({ title: '上传成功', icon: 'success' })

      // 继续后续操作，如导入预览
      this.onImportPreview(fileId)
    } catch (error) {
      wx.showToast({
        title: error.message || '上传失败',
        icon: 'none'
      })
    } finally {
      wx.hideLoading()
    }
  }
})
```

### 带进度的上传（扩展）

> ⚠️ **以下接口当前不存在。** `miniprogram/utils/upload.js` 只导出 `upload`，没有进度回调，上传过程中不会返回进度。下面是需要自行扩展时的参考写法，不是可直接调用的 API。

如果需要显示上传进度，可以扩展 `upload.js`：

```javascript
// utils/upload.js 扩展版本
async function uploadWithProgress(scope, purpose, guard, onProgress) {
  // ... 前面的逻辑相同

  // 在上传分片循环中调用进度回调
  for (let index = 0; index < totalChunks; index++) {
    // ... 上传逻辑

    // 通知进度
    if (onProgress) {
      onProgress({
        current: index + 1,
        total: totalChunks,
        percent: Math.round(((index + 1) / totalChunks) * 100)
      })
    }
  }
}
```

使用进度回调：

```javascript
async onUploadWithProgress() {
  this.setData({ uploadPercent: 0 })

  try {
    const fileId = await upload.uploadWithProgress(
      { projectId, accountId },
      'report',
      guard,
      (progress) => {
        this.setData({ uploadPercent: progress.percent })
      }
    )
  } catch (error) {
    // 处理错误
  }
}
```

## 报表导入流程

完整的报表导入流程：上传 → 预览 → 确认 → 处理 → 查询进度

```javascript
Page({
  data: {
    projectId: '',
    accountId: '',
    importId: '',
    importStatus: '',
    previewHash: '',
    requestKey: ''
  },

  // 步骤 1: 上传文件
  async onUploadReport() {
    wx.showLoading({ title: '上传中...' })

    try {
      const { projectId, accountId } = this.data

      const fileId = await upload.upload(
        { projectId, accountId },
        'report',
        () => true
      )

      // 继续预览
      this.onImportPreview(fileId)
    } catch (error) {
      wx.showToast({ title: error.message, icon: 'none' })
      wx.hideLoading()
    }
  },

  // 步骤 2: 创建导入任务并预览
  async onImportPreview(fileId) {
    wx.showLoading({ title: '解析中...' })

    try {
      const { projectId, accountId } = this.data

      let result = await request.post('/modules/zhihu/imports', {
        projectId,
        accountId,
        fileId
      })

      // 若状态为 preparing，继续轮询直到 preview
      while (result.status === 'preparing') {
        await this.sleep(2000)

        result = await request.post('/modules/zhihu/imports', {
          projectId,
          accountId,
          fileId
        })
      }

      if (result.status === 'preview') {
        this.setData({
          importId: result.id,
          previewHash: result.previewHash,
          previewData: result.preview || {},
          requestKey: this.generateRequestKey()
        })

        wx.hideLoading()
        wx.showToast({ title: '解析完成，请确认', icon: 'success' })
      } else {
        throw new Error('解析失败')
      }
    } catch (error) {
      wx.showToast({ title: error.message, icon: 'none' })
      wx.hideLoading()
    }
  },

  // 步骤 3: 确认并提交导入
  async onConfirmImport() {
    const { importId, previewHash, requestKey } = this.data

    wx.showLoading({ title: '提交中...' })

    try {
      await request.post(`/modules/zhihu/imports/${importId}/commit`, {
        previewHash,
        requestKey
      })

      wx.showToast({ title: '提交成功', icon: 'success' })

      // 开始轮询进度
      this.startPollingImportProgress()
    } catch (error) {
      wx.showToast({ title: error.message, icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  // 步骤 4: 轮询导入进度
  startPollingImportProgress() {
    const { importId } = this.data

    const poll = async () => {
      try {
        const result = await request.get(`/modules/zhihu/imports/${importId}`)

        this.setData({
          importStatus: result.status,
          importProgress: {
            cursor: result.cursor,
            total: result.rowCount,
            percent: Math.round((result.cursor / result.rowCount) * 100)
          }
        })

        if (result.status === 'processing') {
          // 继续轮询
          setTimeout(poll, 3000)
        } else if (result.status === 'completed') {
          wx.showToast({ title: '导入完成', icon: 'success' })
        } else if (result.status === 'failed') {
          wx.showModal({
            title: '导入失败',
            content: result.error || '请重试',
            confirmText: '重试',
            success: (res) => {
              if (res.confirm) {
                this.onRetryImport()
              }
            }
          })
        }
      } catch (error) {
        console.error('poll import error', error)
      }
    }

    poll()
  },

  // 步骤 5: 重试失败的导入
  async onRetryImport() {
    const { importId } = this.data

    wx.showLoading({ title: '重试中...' })

    try {
      await request.post(`/modules/zhihu/imports/${importId}/process`)

      wx.showToast({ title: '已重新开始', icon: 'success' })

      // 继续轮询
      this.startPollingImportProgress()
    } catch (error) {
      wx.showToast({ title: error.message, icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  // 工具函数
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  },

  generateRequestKey() {
    return 'import_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10)
  }
})
```

## 财务确认流程

分批确认财务数据，使用游标处理大量数据：

```javascript
Page({
  data: {
    projectId: '',
    accountId: '',
    fromDate: '',
    toDate: '',
    pendingFacts: [],
    reviewHash: '',
    requestKey: ''
  },

  // 步骤 1: 加载待确认数据
  async loadPendingFinance() {
    const { projectId, accountId, fromDate, toDate } = this.data

    wx.showLoading({ title: '加载中...' })

    try {
      const result = await request.get('/modules/zhihu/workbench', {
        projectId,
        accountId,
        from: fromDate,
        to: toDate
      })

      this.setData({
        pendingFacts: result.rows || [],
        reviewHash: result.reviewHash
      })

      wx.hideLoading()
    } catch (error) {
      wx.showToast({ title: error.message, icon: 'none' })
      wx.hideLoading()
    }
  },

  // 步骤 2: 选择单个来源并加载详情
  async loadFactDetail(factId) {
    const { projectId, accountId, fromDate, toDate } = this.data

    wx.showLoading({ title: '加载详情...' })

    try {
      const result = await request.get('/modules/zhihu/workbench', {
        projectId,
        accountId,
        from: fromDate,
        to: toDate,
        factIds: [factId]
      })

      this.setData({
        selectedFactId: factId,
        factDetail: result.rows[0],
        reviewHash: result.reviewHash,
        requestKey: this.generateRequestKey()
      })

      wx.hideLoading()
    } catch (error) {
      wx.showToast({ title: error.message, icon: 'none' })
      wx.hideLoading()
    }
  },

  // 步骤 3: 确认财务
  async onConfirmFinance() {
    const { projectId, accountId, fromDate, toDate, selectedFactId, reviewHash, requestKey } = this.data

    if (!reviewHash) {
      wx.showToast({ title: '请先加载数据', icon: 'none' })
      return
    }

    wx.showModal({
      title: '确认财务',
      content: '确认后将生成收入记录，是否继续？',
      success: async (res) => {
        if (!res.confirm) return

        wx.showLoading({ title: '确认中...' })

        try {
          await request.post('/modules/zhihu/workbench/confirm', {
            projectId,
            accountId,
            from: fromDate,
            to: toDate,
            factIds: [selectedFactId],
            reviewHash,
            acknowledged: true,
            requestKey
          })

          wx.showToast({ title: '确认成功', icon: 'success' })

          // 刷新列表
          this.loadPendingFinance()
        } catch (error) {
          if (error.status === 409) {
            wx.showModal({
              title: '数据已变化',
              content: '请重新加载后再确认',
              confirmText: '重新加载',
              success: (res) => {
                if (res.confirm) {
                  this.loadPendingFinance()
                }
              }
            })
          } else {
            wx.showToast({ title: error.message, icon: 'none' })
          }
        } finally {
          wx.hideLoading()
        }
      }
    })
  },

  generateRequestKey() {
    return 'confirm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10)
  }
})
```

## 资金开放流程

分步骤开放资金：候选列表 → 选中 → 获取哈希 → 开放

```javascript
Page({
  data: {
    projectId: '',
    accountId: '',
    candidateIncomes: [],
    selectedIncomeIds: [],
    fundingHash: '',
    fundingAmount: '',
    requestKey: ''
  },

  // 步骤 1: 加载候选列表（首页）
  async loadCandidates() {
    const { projectId, accountId } = this.data

    wx.showLoading({ title: '加载中...' })

    try {
      const result = await request.get('/core/finance/funding-preview', {
        projectId,
        accountId,
        moduleId: 'zhihu'
      })

      this.setData({
        candidateIncomes: result.rows || [],
        nextCursor: result.nextCursor
      })

      wx.hideLoading()
    } catch (error) {
      wx.showToast({ title: error.message, icon: 'none' })
      wx.hideLoading()
    }
  },

  // 加载更多候选（翻页）
  async loadMoreCandidates() {
    const { nextCursor } = this.data

    if (!nextCursor) return

    try {
      const result = await request.get('/core/finance/funding-preview', {
        cursor: nextCursor
      })

      this.setData({
        candidateIncomes: [...this.data.candidateIncomes, ...result.rows],
        nextCursor: result.nextCursor
      })
    } catch (error) {
      wx.showToast({ title: error.message, icon: 'none' })
    }
  },

  // 步骤 2: 选中收入并获取哈希
  async onSelectIncomes(incomeIds) {
    const { projectId, accountId } = this.data

    if (incomeIds.length === 0 || incomeIds.length > 3) {
      wx.showToast({ title: '请选择 1-3 条收入', icon: 'none' })
      return
    }

    wx.showLoading({ title: '计算中...' })

    try {
      const result = await request.get('/core/finance/funding-preview', {
        projectId,
        accountId,
        moduleId: 'zhihu',
        incomeIds
      })

      this.setData({
        selectedIncomeIds: incomeIds,
        fundingAmount: result.amount,
        fundingHash: result.hash,
        requestKey: this.generateRequestKey()
      })

      wx.hideLoading()
      wx.showToast({ title: '已选中，请确认开放', icon: 'success' })
    } catch (error) {
      wx.showToast({ title: error.message, icon: 'none' })
      wx.hideLoading()
    }
  },

  // 步骤 3: 确认开放资金
  async onConfirmFunding() {
    const { projectId, accountId, selectedIncomeIds, fundingHash, fundingAmount, requestKey } = this.data

    if (!fundingHash) {
      wx.showToast({ title: '请先选择收入', icon: 'none' })
      return
    }

    wx.showModal({
      title: '确认开放',
      content: `将开放 ${fundingAmount} 元至钱包，是否继续？`,
      success: async (res) => {
        if (!res.confirm) return

        wx.showLoading({ title: '开放中...' })

        try {
          await request.post('/core/finance/funding', {
            projectId,
            accountId,
            moduleId: 'zhihu',
            incomeIds: selectedIncomeIds,
            hash: fundingHash,
            reference: `资金开放 ${new Date().toISOString()}`,
            requestKey
          })

          wx.showToast({ title: '开放成功', icon: 'success' })

          // 刷新列表
          this.loadCandidates()
        } catch (error) {
          if (error.status === 409) {
            wx.showModal({
              title: '数据已变化',
              content: '请重新选择后再开放',
              confirmText: '重新加载',
              success: (res) => {
                if (res.confirm) {
                  this.loadCandidates()
                }
              }
            })
          } else {
            wx.showToast({ title: error.message, icon: 'none' })
          }
        } finally {
          wx.hideLoading()
        }
      }
    })
  },

  generateRequestKey() {
    return 'funding_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10)
  }
})
```

## 提现申请流程

创建提现申请 → 审核 → 上传付款凭证

```javascript
Page({
  data: {
    projectId: '',
    accountId: '',
    availableBalance: '0',
    withdrawAmount: '',
    requestKey: ''
  },

  // 步骤 1: 加载钱包余额
  async loadWallet() {
    const { projectId, accountId } = this.data

    try {
      const result = await request.get('/core/finance', {
        projectId,
        accountId,
        moduleId: 'zhihu'
      })

      this.setData({
        availableBalance: result.available
      })
    } catch (error) {
      wx.showToast({ title: error.message, icon: 'none' })
    }
  },

  // 步骤 2: 申请提现
  async onApplyWithdraw() {
    const { projectId, accountId, withdrawAmount, availableBalance } = this.data

    const amount = parseFloat(withdrawAmount)
    const available = parseFloat(availableBalance)

    if (!amount || amount <= 0) {
      wx.showToast({ title: '请输入提现金额', icon: 'none' })
      return
    }

    if (amount > available) {
      wx.showToast({ title: '余额不足', icon: 'none' })
      return
    }

    wx.showModal({
      title: '确认提现',
      content: `将申请提现 ${withdrawAmount} 元，是否继续？`,
      success: async (res) => {
        if (!res.confirm) return

        wx.showLoading({ title: '提交中...' })

        try {
          const result = await request.post('/core/finance/withdrawals', {
            projectId,
            accountId,
            moduleId: 'zhihu',
            amount: withdrawAmount,
            requestKey: this.generateRequestKey()
          })

          wx.showToast({ title: '申请成功', icon: 'success' })

          // 跳转到提现列表
          setTimeout(() => {
            wx.navigateTo({ url: '/pages/withdrawals/index' })
          }, 1500)
        } catch (error) {
          wx.showToast({ title: error.message, icon: 'none' })
        } finally {
          wx.hideLoading()
        }
      }
    })
  },

  // 步骤 3: 审核提现（leader）
  async onReviewWithdraw(withdrawalId, action) {
    wx.showModal({
      title: action === 'approve' ? '批准提现' : '拒绝提现',
      content: '确认操作？',
      success: async (res) => {
        if (!res.confirm) return

        wx.showLoading({ title: '处理中...' })

        try {
          await request.post(`/core/finance/withdrawals/${withdrawalId}/review`, {
            action,
            requestKey: this.generateRequestKey()
          })

          wx.showToast({ title: '操作成功', icon: 'success' })

          // 刷新列表
          this.loadWithdrawals()
        } catch (error) {
          wx.showToast({ title: error.message, icon: 'none' })
        } finally {
          wx.hideLoading()
        }
      }
    })
  },

  // 步骤 4: 上传付款凭证（admin-finance）
  async onUploadProof(withdrawalId) {
    wx.showLoading({ title: '准备上传...' })

    try {
      // 准备文件上传
      const prepared = await request.post(`/core/finance/withdrawals/${withdrawalId}/proof/prepare`, {
        name: 'payment_proof.jpg'
      })

      wx.hideLoading()

      // 上传文件
      const fileId = await upload.upload(
        {}, // 付款凭证不需要 projectId/accountId
        'payment-proof',
        () => true
      )

      // 登记凭证
      wx.showLoading({ title: '登记中...' })

      await request.post(`/core/finance/withdrawals/${withdrawalId}/proof`, {
        fileId,
        requestKey: this.generateRequestKey()
      })

      wx.showToast({ title: '凭证已上传', icon: 'success' })

      // 刷新列表
      this.loadWithdrawals()
    } catch (error) {
      wx.showToast({ title: error.message, icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  generateRequestKey() {
    return 'withdraw_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10)
  }
})
```

## 错误处理

### 统一错误处理

在 `utils/request.js` 中已实现基本错误处理，前端可以根据错误码做进一步处理：

```javascript
try {
  const result = await request.post('/some/path', data)
  // 成功
} catch (error) {
  // error.status: HTTP 状态码
  // error.code: 业务错误码
  // error.message: 错误信息
  // error.requestId: 请求 ID（用于追踪）

  if (error.status === 401) {
    // 未授权，清理缓存并跳转登录
    getApp().handleUnauthorized()
  } else if (error.status === 409) {
    // 冲突：测试模式、数据变化、需要重新核对
    wx.showModal({
      title: '提示',
      content: error.message,
      confirmText: '重新操作'
    })
  } else if (error.status === 413) {
    // 请求过大或超出批量限制
    wx.showModal({
      title: '数据量过大',
      content: '请缩小范围或分批处理'
    })
  } else if (error.status === 503) {
    // 服务不可用（迁移未完成）
    wx.showModal({
      title: '服务维护中',
      content: error.message,
      showCancel: false
    })
  } else {
    // 其他错误
    wx.showToast({
      title: error.message || '操作失败',
      icon: 'none',
      duration: 3000
    })
  }
}
```

### 网络超时处理

```javascript
// 带重试的请求
async function requestWithRetry(path, options, maxRetries = 3) {
  let lastError

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await request.send(path, options)
    } catch (error) {
      lastError = error

      // 致命错误不重试
      if (error.status && error.status < 500) {
        throw error
      }

      // 最后一次重试失败
      if (i === maxRetries - 1) {
        throw error
      }

      // 等待后重试
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)))
    }
  }

  throw lastError
}
```

## 请求键规范

### 什么是请求键

`requestKey` 是一个 8-128 位的字符串，用于实现**幂等性**：

- 同一请求键的重复请求只会执行一次
- 防止网络超时导致的重复提交
- 保证财务操作的安全性

### 生成规则

```javascript
// ✅ 正确：同一操作使用同一键
Page({
  data: {
    requestKey: '' // 存储在 data 中
  },

  onLoad() {
    // 页面加载时生成
    this.setData({
      requestKey: this.generateRequestKey()
    })
  },

  async onSubmit() {
    const { requestKey } = this.data

    try {
      await request.post('/some/path', {
        ...data,
        requestKey  // 使用同一键
      })
    } catch (error) {
      // 超时重试时会使用同一键
      if (error.code === 'NETWORK_ERROR') {
        // 重试（自动使用同一 requestKey）
        setTimeout(() => this.onSubmit(), 2000)
      }
    }
  },

  generateRequestKey() {
    return 'key_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10)
  }
})
```

```javascript
// ❌ 错误：每次请求都生成新键
async onSubmit() {
  await request.post('/some/path', {
    ...data,
    requestKey: this.generateRequestKey() // 每次都不同
  })
}
```

### 何时换键

**必须换键的情况：**

1. 用户修改了数据
2. 用户取消后重新操作
3. 页面重新加载

```javascript
// 用户修改数据时换键
onInputChange(e) {
  this.setData({
    amount: e.detail.value,
    requestKey: this.generateRequestKey() // 换新键
  })
}

// 取消后重新操作时换键
onCancel() {
  this.setData({
    requestKey: this.generateRequestKey()
  })
}
```

## 分批接口处理

### 游标分页模式

用于处理大量数据，避免一次加载过多：

```javascript
Page({
  data: {
    items: [],
    cursor: null,
    hasMore: true,
    loading: false
  },

  async loadData() {
    if (this.data.loading || !this.data.hasMore) return

    this.setData({ loading: true })

    try {
      const params = this.data.cursor
        ? { cursor: this.data.cursor }
        : { projectId: this.data.projectId }

      const result = await request.get('/some/list', params)

      this.setData({
        items: [...this.data.items, ...result.rows],
        cursor: result.nextCursor,
        hasMore: !!result.nextCursor
      })
    } catch (error) {
      wx.showToast({ title: error.message, icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  // 触底加载更多
  onReachBottom() {
    this.loadData()
  },

  // 下拉刷新
  async onPullDownRefresh() {
    this.setData({
      items: [],
      cursor: null,
      hasMore: true
    })

    await this.loadData()
    wx.stopPullDownRefresh()
  }
})
```

### 分批确认模式

用于批量操作（如财务确认、资金开放）：

```javascript
// 1. 先获取候选列表
const candidates = await request.get('/path/preview')

// 2. 选中部分数据（1-3 条）
const selected = candidates.rows.slice(0, 2)

// 3. 用选中的 ID 再次请求，获取哈希
const review = await request.get('/path/preview', {
  ids: selected.map(item => item.id)
})

// 4. 提交时携带完全相同的 ID、哈希和请求键
await request.post('/path/confirm', {
  ids: selected.map(item => item.id),
  hash: review.hash,
  requestKey: this.data.requestKey
})
```

### 轮询处理模式

用于长时间任务（如报表导入、后台作业）：

```javascript
async function pollTask(taskId, onProgress) {
  const maxAttempts = 60 // 最多轮询 60 次
  const interval = 3000   // 每 3 秒一次

  for (let i = 0; i < maxAttempts; i++) {
    try {
      const result = await request.get(`/tasks/${taskId}`)

      // 通知进度
      if (onProgress) {
        onProgress(result)
      }

      // 已完成
      if (result.status === 'completed') {
        return result
      }

      // 失败
      if (result.status === 'failed') {
        throw new Error(result.error || '任务失败')
      }

      // 继续等待
      await new Promise(resolve => setTimeout(resolve, interval))
    } catch (error) {
      // 最后一次重试
      if (i === maxAttempts - 1) {
        throw error
      }
    }
  }

  throw new Error('任务超时')
}

// 使用
async onStartTask() {
  try {
    const task = await request.post('/start-task', data)

    await pollTask(task.id, (progress) => {
      this.setData({
        taskProgress: progress.percent
      })
    })

    wx.showToast({ title: '任务完成', icon: 'success' })
  } catch (error) {
    wx.showToast({ title: error.message, icon: 'none' })
  }
}
```

## 最佳实践

### 1. 会话检查

在每个需要登录的页面 `onLoad` 中检查：

```javascript
onLoad() {
  const token = wx.getStorageSync('zk_access_token')
  if (!token) {
    wx.reLaunch({ url: '/pages/login/index' })
    return
  }

  this.loadData()
}
```

### 2. 项目切换

当用户切换项目时，清理相关缓存：

```javascript
onProjectChange(projectId) {
  wx.setStorageSync('zk_project_id', projectId)
  wx.setStorageSync('zk_account_id', '') // 清理旧账号

  // 刷新当前页面
  this.onLoad()
}
```

### 3. 防抖处理

防止用户快速点击导致重复请求：

```javascript
Page({
  data: {
    submitting: false
  },

  async onSubmit() {
    if (this.data.submitting) return

    this.setData({ submitting: true })

    try {
      await request.post('/some/path', data)
    } finally {
      this.setData({ submitting: false })
    }
  }
})
```

### 4. 加载状态

提供清晰的加载反馈：

```javascript
async loadData() {
  wx.showLoading({ title: '加载中...', mask: true })

  try {
    const result = await request.get('/some/path')
    // 处理数据
  } catch (error) {
    wx.showToast({ title: error.message, icon: 'none' })
  } finally {
    wx.hideLoading()
  }
}
```

### 5. 错误提示

根据错误类型提供友好提示：

```javascript
function handleError(error) {
  const messages = {
    401: '登录已过期，请重新登录',
    403: '没有权限执行此操作',
    409: '数据已变化，请刷新后重试',
    413: '数据量过大，请分批处理',
    422: '参数不正确，请检查输入',
    503: '服务维护中，请稍后再试'
  }

  const message = messages[error.status] || error.message || '操作失败'

  wx.showToast({
    title: message,
    icon: 'none',
    duration: 3000
  })
}
```

## 总结

本文档涵盖了微信小程序接入云函数 API 的所有核心流程。主要要点：

1. **认证管理** - 8 小时会话，绑定微信身份
2. **文件上传** - 使用云函数分片，支持大文件
3. **请求键** - 确保操作幂等性，防止重复提交
4. **分批处理** - 使用游标分页，处理大量数据
5. **错误处理** - 根据错误码提供友好反馈
6. **状态管理** - 防抖、加载状态、会话检查

更多详细的 API 定义，请参考 [API-REFERENCE.md](./API-REFERENCE.md)。
