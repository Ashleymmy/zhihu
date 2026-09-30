<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref } from "vue";
import { ActionDialog } from "@zhihu-koc/shared-components";
import type { MemberInvitation } from "@zhihu-koc/shared-contracts/core";
import { apis, useAuthStore } from "../stores/auth";
const auth = useAuthStore();
const invitations = ref<MemberInvitation[]>([]),
  search = ref(""),
  busy = ref(false),
  error = ref(""),
  notice = ref("");
const dialog = ref<"create" | "edit" | "link" | "delete" | "regenerate" | null>(
    null,
  ),
  selected = ref<MemberInvitation | null>(null);
const link = ref(""),
  linkInput = ref<HTMLInputElement | null>(null);
const form = reactive({
  label: "",
  validDays: 7,
  maxUses: 20,
  expiresAt: "",
  enabled: true,
});
const visible = computed(() =>
  invitations.value.filter((i) =>
    i.label.toLowerCase().includes(search.value.trim().toLowerCase()),
  ),
);
const labels = {
  active: "生效中",
  expired: "已过期",
  used: "人数已满",
  revoked: "已停用",
};
const title = computed(
  () =>
    ({
      create: "新增邀请链接",
      edit: "编辑邀请链接",
      link: "分享邀请链接",
      delete: "删除邀请链接",
      regenerate: "重新生成链接",
    })[dialog.value ?? "create"],
);
const format = (value: string) => new Date(value).toLocaleString("zh-CN");
function localTime(value: string) {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
async function load() {
  invitations.value = await apis.team.invitations();
}
async function run(fn: () => Promise<unknown>) {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    await fn();
  } catch (e) {
    error.value =
      e instanceof Error
        ? e.message
        : String((e as { message?: string })?.message || "操作失败，请重试");
  } finally {
    busy.value = false;
  }
}
function open(kind: typeof dialog.value, item: MemberInvitation | null = null) {
  selected.value = item;
  dialog.value = kind;
  error.value = "";
  notice.value = "";
  link.value = "";
  Object.assign(form, {
    label: item?.label ?? "成员邀请",
    validDays: 7,
    maxUses: item?.maxUses ?? 20,
    expiresAt: item ? localTime(item.expiresAt) : "",
    enabled: !item?.revokedAt,
  });
}
function showLink(token: string) {
  const url = new URL(import.meta.env.BASE_URL + "register", location.origin);
  url.hash = new URLSearchParams({ invite: token }).toString();
  link.value = url.href;
  dialog.value = "link";
}
async function save() {
  if (dialog.value === "create") {
    const result = await apis.team.createInvitation({
      label: form.label,
      validDays: form.validDays,
      maxUses: form.maxUses,
    });
    showLink(result.token);
  } else if (selected.value) {
    const expiryChanged =
      form.expiresAt !== localTime(selected.value.expiresAt);
    await apis.team.updateInvitation(selected.value.id, {
      label: form.label,
      maxUses: form.maxUses,
      enabled: form.enabled,
      ...(expiryChanged
        ? { expiresAt: new Date(form.expiresAt).toISOString() }
        : {}),
    });
    dialog.value = null;
    notice.value = "邀请链接已更新，已注册成员的归属保持不变。";
  }
  await load();
}
async function share(item: MemberInvitation) {
  selected.value = item;
  showLink((await apis.team.invitationLink(item.id)).token);
  await nextTick();
  await copy();
}
async function copy() {
  try {
    if (!navigator.clipboard) throw new Error();
    await navigator.clipboard.writeText(link.value);
    notice.value = "邀请链接已复制。";
  } catch {
    await nextTick();
    linkInput.value?.focus();
    linkInput.value?.select();
    notice.value = "链接已选中，请使用复制快捷键或长按复制。";
  }
}
async function remove() {
  if (!selected.value) return;
  await apis.team.deleteInvitation(selected.value.id);
  dialog.value = null;
  notice.value = "链接已删除并失效，已注册成员及历史邀请记录保留。";
  await load();
}
async function regenerate() {
  if (!selected.value) return;
  showLink((await apis.team.regenerateInvitation(selected.value.id)).token);
  notice.value = "新链接已生成，旧链接已失效。有效期和人数上限保持不变。";
  await load();
}
onMounted(() => run(load));
</script>
<template>
  <section class="page-stack invitation-page">
    <header class="page-header">
      <div>
        <p class="eyebrow">团队与账号</p>
        <h1>邀请链接</h1>
        <p>
          {{
            auth.user?.role === "leader"
              ? "通过你的链接注册的达人，自动加入你的团队。"
              : "通过你的链接注册的成员成为平台管理的独立达人。"
          }}
          注册时无需填写邀请码，业务项目仍由管理员授权。
        </p>
      </div>
      <button class="primary-action" :disabled="busy" @click="open('create')">
        新增邀请链接
      </button>
    </header>
    <p v-if="error && !dialog" role="alert" class="error">{{ error }}</p>
    <p v-if="notice && !dialog" role="status">{{ notice }}</p>
    <article class="panel">
      <div class="tools">
        <label
          >搜索邀请名称<input
            v-model="search"
            type="search"
            placeholder="输入邀请名称" /></label
        ><button :disabled="busy" @click="run(load)">刷新</button
        ><router-link to="/team">查看团队与成员</router-link>
      </div>
      <p v-if="busy && !invitations.length" role="status">正在加载…</p>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>邀请名称</th>
              <th>注册归属</th>
              <th>已注册 / 上限</th>
              <th>有效期至</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in visible" :key="item.id">
              <td>{{ item.label }}</td>
              <td>
                {{ item.teamName ? item.teamName + "的团队" : "独立达人" }}
              </td>
              <td>{{ item.usedCount }} / {{ item.maxUses }}</td>
              <td>{{ format(item.expiresAt) }}</td>
              <td>{{ labels[item.status] }}</td>
              <td>
                <div class="actions">
                  <button
                    v-if="item.canCopy"
                    :disabled="busy"
                    @click="run(() => share(item))"
                  >
                    复制链接</button
                  ><button :disabled="busy" @click="open('edit', item)">
                    编辑</button
                  ><button :disabled="busy" @click="open('regenerate', item)">
                    {{ item.canCopy ? "重新生成" : "生成可复制链接" }}</button
                  ><button :disabled="busy" @click="open('delete', item)">
                    删除
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="!busy && !visible.length" class="empty-state">
        {{
          search
            ? "没有匹配的邀请链接。"
            : "还没有邀请链接，点击“新增邀请链接”开始邀请。"
        }}
      </p>
    </article>
    <ActionDialog
      :open="!!dialog"
      :title="title"
      :busy="busy"
      @close="dialog = null"
    >
      <p v-if="error" role="alert" class="error">{{ error }}</p>
      <p v-if="notice" role="status">{{ notice }}</p>
      <form
        v-if="dialog === 'create' || dialog === 'edit'"
        @submit.prevent="run(save)"
      >
        <label
          >邀请名称<input v-model.trim="form.label" required maxlength="100"
        /></label>
        <label v-if="dialog === 'create'"
          >有效天数<input
            v-model.number="form.validDays"
            type="number"
            min="1"
            max="30"
            required
        /></label>
        <label v-else
          >有效期至<input
            v-model="form.expiresAt"
            type="datetime-local"
            required
          /><small>修改有效期时，可设置为未来 30 天以内。</small></label
        >
        <label
          >最多注册人数<input
            v-model.number="form.maxUses"
            type="number"
            :min="Math.max(1, selected?.usedCount ?? 0)"
            max="1000"
            required
        /></label>
        <label v-if="dialog === 'edit'" class="toggle"
          ><input v-model="form.enabled" type="checkbox" />启用链接</label
        >
        <p>每条链接固定绑定创建人，编辑不会改变已注册成员的归属。</p>
        <div class="dialog-actions">
          <button type="button" :disabled="busy" @click="dialog = null">
            取消</button
          ><button class="primary" :disabled="busy">
            {{
              busy
                ? "正在保存…"
                : dialog === "create"
                  ? "生成邀请链接"
                  : "保存修改"
            }}
          </button>
        </div>
      </form>
      <div v-else-if="dialog === 'link'">
        <label
          >邀请链接<input
            ref="linkInput"
            :value="link"
            readonly
            @focus="($event.target as HTMLInputElement).select()"
        /></label>
        <p>把链接发给对方，对方打开注册即可自动绑定；无需提供或填写邀请码。</p>
        <div class="dialog-actions">
          <button @click="dialog = null">关闭</button
          ><button class="primary" @click="copy">复制链接</button>
        </div>
      </div>
      <div v-else-if="dialog === 'delete'">
        <p>
          删除“{{
            selected?.label
          }}”后，已分享的链接立即失效。已注册成员和历史邀请记录会保留。
        </p>
        <div class="dialog-actions">
          <button :disabled="busy" @click="dialog = null">取消</button
          ><button class="primary" :disabled="busy" @click="run(remove)">
            确认删除
          </button>
        </div>
      </div>
      <div v-else-if="dialog === 'regenerate'">
        <p>
          为“{{
            selected?.label
          }}”生成新链接后，旧链接立即失效。已注册成员、有效期和人数上限保持不变。
        </p>
        <div class="dialog-actions">
          <button :disabled="busy" @click="dialog = null">取消</button
          ><button class="primary" :disabled="busy" @click="run(regenerate)">
            确认重新生成
          </button>
        </div>
      </div>
    </ActionDialog>
  </section>
</template>
<style scoped>
.invitation-page,
.invitation-page > .panel,
.invitation-page .page-header > div {
  min-width: 0;
}
.invitation-page > .panel {
  padding: 20px;
}
.invitation-page .page-header p {
  max-width: 760px;
  line-height: 1.7;
}
.tools,
.actions {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
}
.tools {
  margin-bottom: 20px;
}
.tools label {
  min-width: 220px;
}
.table-wrap {
  overflow-x: auto;
  max-width: 100%;
}
table {
  width: 100%;
  min-width: 780px;
  border-collapse: collapse;
}
th,
td {
  text-align: left;
  padding: 14px 12px;
  border-bottom: 1px solid var(--line, #ddd);
  vertical-align: top;
}
th {
  white-space: nowrap;
}
.actions {
  justify-content: flex-end;
  min-width: 220px;
}
th:last-child {
  text-align: right;
}
label {
  display: grid;
  gap: 8px;
  margin: 12px 0;
}
input {
  width: 100%;
  box-sizing: border-box;
}
.toggle {
  display: flex;
  align-items: center;
}
.toggle input {
  width: auto;
}
small {
  color: var(--muted, #666);
}
.error {
  color: #a52e2e;
}
.empty-state {
  padding: 28px 0;
}
@media (max-width: 640px) {
  .page-header {
    align-items: flex-start;
    gap: 16px;
    flex-direction: column;
  }
  .tools {
    align-items: stretch;
  }
  .tools label {
    width: 100%;
  }
}
</style>
