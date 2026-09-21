<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { fetchAllOffsetPages } from '@zhihu-koc/shared-services'
import { useAuthStore, apis } from '../context'

interface SaltBoard { id: string; name: string; type: number; updatedAt?: string }
interface SaltContent { id: string; title: string; url?: string; contentType?: string; bayesFirstCategory?: string; theme?: string; rCmdConsumeValue?: string }

const boards = ref<SaltBoard[]>([])
const activeBoard = ref<SaltBoard | null>(null)
const contents = ref<SaltContent[]>([])
const total = ref(0)
const loadingBoards = ref(true)
const loadingContents = ref(false)
const error = ref('')

function unwrap(resp: any): any[] {
  if (Array.isArray(resp)) return resp
  return resp?.data ?? []
}

async function loadBoards() {
  loadingBoards.value = true
  try {
    boards.value = unwrap(await apis.story.saltBoards())
    if (boards.value.length) await selectBoard(boards.value[0]!)
  }
  catch (e: any) { error.value = e?.message ?? String(e) }
  finally { loadingBoards.value = false }
}

let loadVersion = 0
async function selectBoard(board: SaltBoard) {
  if (!board) return
  const version = ++loadVersion
  contents.value = []
  total.value = 0
  activeBoard.value = board
  loadingContents.value = true
  error.value = ''
  try {
    const result = await fetchAllOffsetPages<SaltContent>((params) => apis.story.saltBoardContents(board.id, params))
    if (version !== loadVersion) return
    contents.value = result.items
    total.value = result.total
  }
  catch (e: any) { if (version === loadVersion) error.value = e?.message ?? String(e) }
  finally { if (version === loadVersion) loadingContents.value = false }
}

onMounted(loadBoards)
</script>

<template>
  <div class="page-stack">
    <router-link to="/zhihu-story" class="back-link">← 返回知乎故事</router-link>
    <header class="page-header">
      <div>
        <p class="section-index">04 / 盐选榜单</p>
        <h1>盐选榜单</h1>
        <p>知乎盐选官方榜单与内容数据，实时来自知乎开放平台。</p>
      </div>
      <select :value="activeBoard?.id ?? ''" @change="selectBoard(boards.find(b => b.id === ($event.target as HTMLSelectElement).value)!)">
        <option v-for="b in boards" :key="b.id" :value="b.id">{{ b.name }}</option>
      </select>
    </header>

    <div v-if="error" style="padding: 12px 16px; background: #f1ded9; color: #964639; font-size: 13px; border-radius: var(--radius); border: 1px solid var(--clay);">{{ error }}</div>

    <article class="panel data-panel" style="min-height: 300px;">
      <div class="list-toolbar">
        <span class="toolbar-title">{{ activeBoard?.name ?? '榜单内容' }}</span>
        <span class="toolbar-count">{{ total }}</span>
      </div>
      <div v-if="loadingBoards || loadingContents" style="display: grid; min-height: 200px; place-content: center; color: var(--ink-soft); font-size: 12px;">加载中...</div>
      <div v-else-if="!contents.length" class="empty-panel"><span>该榜单暂无内容数据。</span></div>
      <div v-else class="responsive-table">
        <table>
          <thead><tr><th>标题</th><th>类型</th><th>领域</th><th>兴趣标签</th><th>消费价值</th><th>链接</th></tr></thead>
          <tbody>
            <tr v-for="c in contents" :key="c.id">
              <td><strong>{{ c.title }}</strong></td>
              <td style="font-size: 13px;">{{ c.contentType || '—' }}</td>
              <td style="font-size: 13px;">{{ c.bayesFirstCategory || '—' }}</td>
              <td style="font-size: 13px;">{{ c.theme || '—' }}</td>
              <td><span v-if="c.rCmdConsumeValue" class="status-badge paused">{{ c.rCmdConsumeValue }}</span><span v-else style="color: var(--ink-soft);">—</span></td>
              <td><a v-if="c.url" :href="c.url" target="_blank" class="row-action" style="text-decoration: none;">打开</a></td>
            </tr>
          </tbody>
        </table>
      </div>
    </article>
  </div>
</template>
