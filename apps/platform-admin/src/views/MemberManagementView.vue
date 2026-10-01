<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useRoute } from "vue-router";
import MemberClientDetails from './MemberClientDetails.vue';
import { bindingLabel, miniFilters, matchesMiniFilter } from '../mini-status';
import { ActionDialog } from "@zhihu-koc/shared-components";
import {
  ROLE_LABELS,
  isStaffRole,
  type GlobalRole,
  type TeamMember,
  type MemberInvitation,
  type TeamApplication,
  type MemberAccessPatch,
  type Project,
} from "@zhihu-koc/shared-contracts/core";
import { apis, http, useAuthStore } from "../stores/auth";
const auth = useAuthStore();
const route=useRoute();
const miniFilter=ref(''),memberIdFilter=ref('');
const projects = ref<Project[]>([]),
  projectSearch = ref("");
const canAssignProjects = computed(
  () =>
    (isStaffRole(auth.user?.role) || auth.user?.role === "leader") &&
    auth.user?.adminDuty !== "finance",
);
function projectLocked(project: { id: string; isEnabled: boolean }) {
  const existing = selected.value?.projects?.find(p => p.id === project.id);
  if (existing?.memberRole === "owner") return true;
  if (existing?.memberRole === "admin" && !auth.user?.permissions?.includes("project.manage")) return true;
  return auth.user?.role === "leader" && (!project.isEnabled || !projects.value.some(p => p.id === project.id && p.isEnabled));
}
const projectOptions = computed(() => {
  const all = new Map(
    projects.value.map((p) => [
      p.id,
      { id: p.id, name: p.name, isEnabled: p.isEnabled },
    ]),
  );
  for (const p of selected.value?.projects ?? [])
    if (!all.has(p.id)) all.set(p.id, p);
  return [...all.values()].filter((p) =>
    p.name.toLowerCase().includes(projectSearch.value.trim().toLowerCase()),
  );
});
const members = ref<TeamMember[]>([]),
  invitations = ref<MemberInvitation[]>([]),
  applications = ref<TeamApplication[]>([]);
const busy = ref(false),
  loading = ref(false),
  error = ref(""),
  notice = ref(""),
  secret = ref("");
const search = ref(""),
  roleFilter = ref(""),
  statusFilter = ref(""),
  page = ref(1),
  tab = ref("members");
const pageSize = 20;
watch(()=>[route.query.mini,route.query.member],()=>{
  miniFilter.value=miniFilters.some(f=>f.value===route.query.mini)?String(route.query.mini):'';
  memberIdFilter.value=typeof route.query.member==='string'&&/^\d+$/.test(route.query.member)?route.query.member:'';
  page.value=1;
},{immediate:true});
const dialog = ref<
    | "create"
    | "edit"
    | "detail"
    | "reset"
    | "invite"
    | "revoke"
    | "delete"
    | null
  >(null),
  selected = ref<TeamMember | null>(null),
  revokeTarget = ref<MemberInvitation | null>(null);
const edit = reactive({
  displayName: "",
  phone: "",
  role: "creator" as GlobalRole,
  adminDuty: "all" as "all" | "operations" | "finance",
  isActive: true,
  parentId: "",
  projectIds: [] as string[],
});
const create = reactive({
  username: "",
  displayName: "",
  role: "creator" as GlobalRole,
  duty: "all",
});
const invite = reactive({ label: "成员邀请", validDays: 7, maxUses: 20 }),
  invitationLink = ref(""),
  resetPassword = ref("");
const filtered = computed(() =>
  members.value.filter(
    (m) =>
      (!memberIdFilter.value || m.id===memberIdFilter.value) &&
      matchesMiniFilter(m,miniFilter.value) &&
      (!roleFilter.value || m.role === roleFilter.value) &&
      (!statusFilter.value ||
        String(Number(m.isActive)) === statusFilter.value) &&
      [
        m.username,
        m.displayName,
        m.id,
        m.phone,
        m.parentName,
        m.inviterName,
      ].some((s) =>
        String(s ?? "")
          .toLowerCase()
          .includes(search.value.trim().toLowerCase()),
      ),
  ),
);
const visible = computed(() =>
  filtered.value.slice((page.value - 1) * pageSize, page.value * pageSize),
);
const pending = computed(() =>
  applications.value.filter((a) => a.status === "pending"),
);
const leaders = computed(() =>
  members.value.filter((m) => m.role === "leader" && m.isActive),
);
const managementRoles = computed<GlobalRole[]>(() =>
  auth.user?.role === "developer"
    ? ["creator", "leader", "operator", "admin", "developer"]
    : auth.user?.role === "admin" && (auth.user.adminDuty ?? "all") === "all"
      ? ["creator", "leader", "operator"]
      : isStaffRole(auth.user?.role)
        ? ["creator", "leader"]
        : ["creator"],
);
const format = (value?: string | null) =>
  value ? new Date(value).toLocaleString("zh-CN") : "—";
const source = (m: TeamMember) =>
  m.registrationSource === "invitation"
    ? "邀请注册"
    : m.registrationSource === "managed"
      ? "管理创建"
      : "自主注册 / 历史账号";
const title = computed(
  () =>
    ({
      create: "创建成员",
      edit: "编辑成员",
      detail: "成员信息与权限",
      reset: "重置密码",
      invite: "邀请成员",
      revoke: "停用邀请",
      delete: "删除成员",
    })[dialog.value ?? "detail"],
);
async function load() {
  loading.value = true;
  try {
    const [m, i, a, p] = await Promise.all([
      apis.team.listMembers(),
      apis.team.invitations(),
      apis.team.listApplications(),
      canAssignProjects.value ? apis.projects.list() : Promise.resolve([]),
    ]);
    members.value = m;
    invitations.value = i;
    applications.value = a;
    projects.value = p;
    page.value = Math.min(
      page.value,
      Math.max(1, Math.ceil(filtered.value.length / pageSize)),
    );
  } finally {
    loading.value = false;
  }
}
async function run(fn: () => Promise<unknown>) {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    await fn();
  } catch (e: any) {
    error.value = e?.message || "操作失败，请重试";
  } finally {
    busy.value = false;
  }
}
function open(kind: typeof dialog.value, member?: TeamMember) {
  error.value = "";
  dialog.value = kind;
  selected.value = member ?? null;
  resetPassword.value = "";
  projectSearch.value = "";
  if (member)
    Object.assign(edit, {
      displayName: member.displayName,
      phone: member.phone ?? "",
      role: member.role,
      adminDuty: member.adminDuty ?? "all",
      isActive: Boolean(member.isActive),
      parentId: member.parentId ?? "",
      projectIds: (member.projects ?? []).map((p) => p.id),
    });
}
async function save() {
  const m = selected.value;
  if (!m) return;
  const patch: MemberAccessPatch = {
    displayName: edit.displayName,
    phone: edit.phone || null,
    role: edit.role,
    isActive: edit.isActive,
  };
  if (edit.role === "admin" && auth.user?.role === "developer")
    patch.adminDuty = edit.adminDuty;
  if (edit.role === "creator" && isStaffRole(auth.user?.role))
    patch.parentId = edit.parentId || null;
  if (
    m.canAssignProjects &&
    !isStaffRole(edit.role) &&
    JSON.stringify([...edit.projectIds].sort()) !==
      JSON.stringify((m.projects ?? []).map((p) => p.id).sort())
  )
    patch.projectIds = [...edit.projectIds];
  await apis.team.manageMember(m.id, patch);
  dialog.value = null;
  notice.value =
    "成员已更新；角色、团队、项目或状态发生变化时，原登录会话会退出。";
  await load();
}
async function createMember() {
  const data = isStaffRole(create.role)
    ? await http.post<{ username: string; temporaryPassword: string }>(
        "/staff",
        create,
      )
    : await apis.team.createMember({
        username: create.username,
        displayName: create.displayName,
        role: create.role as "leader" | "creator",
      });
  secret.value = `账号：${data.username}；临时密码：${data.temporaryPassword}。首次登录需修改密码。`;
  dialog.value = null;
  create.username = "";
  create.displayName = "";
  await load();
}
async function reset() {
  if (!selected.value) return;
  const result = await apis.team.resetPassword(
    selected.value.id,
    resetPassword.value || undefined,
  );
  secret.value = result.temporaryPassword
    ? `${selected.value.username} 的临时密码：${result.temporaryPassword}`
    : "密码已重置，原设备会话已退出。";
  dialog.value = null;
  await load();
}
async function createInvite() {
  const result = await apis.team.createInvitation(invite);
  const url = new URL(import.meta.env.BASE_URL + "register", location.origin);
  url.hash = new URLSearchParams({ invite: result.token }).toString();
  invitationLink.value = url.href;
  await load();
}
async function copyLink() {
  try {
    if (!navigator.clipboard) throw new Error();
    await navigator.clipboard.writeText(invitationLink.value);
    notice.value = "邀请链接已复制。";
  } catch {
    const input = document.getElementById(
      "invitation-link",
    ) as HTMLInputElement | null;
    input?.focus();
    input?.select();
    notice.value = "链接已选中，请使用复制快捷键或长按复制。";
  }
}
async function revoke() {
  if (!revokeTarget.value) return;
  await apis.team.revokeInvitation(revokeTarget.value.id);
  dialog.value = null;
  notice.value = "邀请已停用，现有成员不受影响。";
  await load();
}
async function remove() {
  if (!selected.value) return;
  await apis.team.deleteMember(selected.value.id);
  dialog.value = null;
  notice.value = "成员已删除。";
  await load();
}
const permissionNames: Record<string, string> = {
  "team.view": "查看团队",
  "team.create_member": "创建与编辑成员",
  "team.reset_pwd": "重置下级密码",
  "team.disable": "管理成员状态",
  "team.review": "审核入团申请",
  "team.delete": "删除无业务成员",
  "team.apply": "申请入团",
  "project.manage": "管理项目授权",
  "staff.manage": "管理下级管理账号",
  "system.develop": "开发工具",
  "module.manage": "模块配置",
  "audit.view": "审计记录",
};
onMounted(() => run(load));
</script>
<template>
  <section class="page-stack members-page">
    <header class="page-header">
      <div>
        <p class="eyebrow">团队与账号</p>
        <h1>成员管理</h1>
        <p>查看成员资料、角色权限、团队归属与邀请记录。</p>
      </div>
      <div class="member-actions">
        <router-link to="/invitations">管理邀请链接</router-link>
        <button
          @click="
            open('invite');
            invitationLink = '';
          "
        >
          邀请成员</button
        ><button class="primary-action" @click="open('create')">
          创建成员
        </button>
      </div>
    </header>
    <p v-if="error && !dialog" role="alert" class="member-error">{{ error }}</p>
    <p v-if="notice" role="status">{{ notice }}</p>
    <div v-if="secret" class="secret-note" role="status">
      {{ secret }} <button @click="secret = ''">收起密码</button>
    </div>
    <nav class="member-tabs" aria-label="成员管理分类">
      <button :aria-pressed="tab === 'members'" @click="tab = 'members'">
        全部成员 {{ members.length }}</button
      ><button
        :aria-pressed="tab === 'applications'"
        @click="tab = 'applications'"
      >
        入团申请
        {{ pending.length ? `(${pending.length} 待处理)` : "" }}</button
      ><button
        :aria-pressed="tab === 'invitations'"
        @click="tab = 'invitations'"
      >
        我的邀请 {{ invitations.length }}
      </button>
    </nav>
    <article v-if="tab === 'members'" class="panel">
      <form class="member-filters" @submit.prevent="page = 1">
        <label
          >搜索成员<input
            v-model="search"
            type="search"
            placeholder="账号、昵称、ID、手机或邀请人"
            @input="page = 1" /></label
        ><label
          >角色<select v-model="roleFilter" @change="page = 1">
            <option value="">全部角色</option>
            <option
              v-for="(label, role) in ROLE_LABELS"
              :key="role"
              :value="role"
            >
              {{ label }}
            </option>
          </select></label
        ><label
          >状态<select v-model="statusFilter" @change="page = 1">
            <option value="">全部状态</option>
            <option value="1">启用</option>
            <option value="0">停用</option>
          </select></label
        ><label>小程序状态<select v-model="miniFilter" @change="page=1"><option value="">全部绑定与登录状态</option><option v-for="f in miniFilters" :key="f.value" :value="f.value">{{ f.label }}</option></select></label>
        <button type="button" :disabled="busy" @click="run(load)">刷新</button>
      </form>
      <p v-if="memberIdFilter">正在定位成员 ID {{ memberIdFilter }} <button @click="memberIdFilter='';page=1">查看全部成员</button></p>
      <p v-if="loading" class="member-empty" role="status">正在加载成员…</p>
      <div v-else class="member-table">
        <table>
          <thead>
            <tr>
              <th>成员</th>
              <th>角色 / 状态</th>
              <th>所属团队</th>
              <th>注册 / 邀请来源</th>
              <th>注册 / 最后登录</th>
              <th>微信小程序</th>
              <th class="actions-column">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="m in visible" :key="m.id">
              <td>
                <strong>{{ m.displayName }}</strong
                ><small>{{ m.username }} · ID {{ m.id }}</small
                ><small>{{ m.phone || "未填写手机号" }}{{ m.phone ? (m.phoneVerifiedAt ? ' · 手机号已验证' : ' · 手机号未验证') : '' }}</small>
              </td>
              <td>
                {{ ROLE_LABELS[m.role]
                }}<small>{{
                  m.role === "admin"
                    ? { all: "完整管理", finance: "财务", operations: "运营" }[
                        m.adminDuty ?? "all"
                      ]
                    : m.role === "operator"
                      ? "业务运营"
                      : ""
                }}</small
                ><span :class="['member-status', { disabled: !m.isActive }]">{{
                  m.isActive ? "启用" : "停用"
                }}</span>
              </td>
              <td>
                {{ m.parentName || (m.role === "leader" ? "团长本人" : "—")
                }}<small
                  >成员 {{ m.memberCount ?? 0 }} · 项目
                  {{ m.projectCount ?? 0 }}</small
                >
              </td>
              <td>
                {{ source(m)
                }}<small>{{
                  m.inviterName
                    ? `邀请人：${m.inviterName}`
                    : m.createdByName
                      ? `创建人：${m.createdByName}`
                      : "未记录创建人"
                }}</small
                ><small>已邀请 {{ m.invitedCount ?? 0 }} 人</small>
              </td>
              <td>
                <small>{{ format(m.createdAt) }}</small
                ><small>登录：{{ format(m.lastLoginAt) }}</small>
              </td>
              <td>
                {{ bindingLabel(m.miniProgram) }}
                <small>登录：{{ format(m.miniProgram?.lastLoginAt) }}</small>
                <small v-if="matchesMiniFilter(m,'no-project')">待分配项目</small>
                <small v-if="m.miniProgram?.recentBindingConflict">近期有绑定冲突</small>
              </td>
              <td class="actions-column">
                <div class="member-actions">
                  <button @click="open('detail', m)">详情</button
                  ><button v-if="m.canManage" @click="open('edit', m)">
                    编辑</button
                  ><button
                    v-if="
                      m.canManage &&
                      auth.user?.permissions?.includes('team.reset_pwd') &&
                      !(m.role === 'developer')
                    "
                    @click="open('reset', m)"
                  >
                    重置密码</button
                  ><button
                    v-if="
                      m.canManage &&
                      !isStaffRole(m.role) &&
                      auth.user?.permissions?.includes('team.delete')
                    "
                    class="danger"
                    @click="open('delete', m)"
                  >
                    删除
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-if="!visible.length" class="member-empty">没有符合条件的成员。</p>
      </div>
      <footer class="member-pagination">
        <span
          >共 {{ filtered.length }} 人，第 {{ page }} /
          {{ Math.max(1, Math.ceil(filtered.length / pageSize)) }} 页</span
        ><button :disabled="page === 1" @click="page--">上一页</button
        ><button :disabled="page * pageSize >= filtered.length" @click="page++">
          下一页
        </button>
      </footer>
    </article>
    <article v-else-if="tab === 'applications'" class="panel member-table">
      <table>
        <thead>
          <tr>
            <th>申请人</th>
            <th>目标团长</th>
            <th>留言</th>
            <th>时间 / 状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="a in applications" :key="a.id">
            <td>
              {{ a.creatorName }}<small>{{ a.creatorUsername }}</small>
            </td>
            <td>{{ a.leaderName }}</td>
            <td>{{ a.message || "—" }}</td>
            <td>
              {{ format(a.createdAt)
              }}<small>{{
                {
                  pending: "待审批",
                  approved: "已通过",
                  rejected: "已驳回",
                  cancelled: "已撤回",
                }[a.status]
              }}</small>
            </td>
            <td>
              <div v-if="a.status === 'pending'" class="member-actions">
                <button
                  :disabled="busy"
                  @click="
                    run(async () => {
                      await apis.team.reviewApplication(a.id, 'approve');
                      await load();
                    })
                  "
                >
                  通过</button
                ><button
                  :disabled="busy"
                  @click="
                    run(async () => {
                      await apis.team.reviewApplication(a.id, 'reject');
                      await load();
                    })
                  "
                >
                  驳回
                </button>
              </div>
              <span v-else>已处理</span>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="!applications.length" class="member-empty">暂无入团申请。</p>
    </article>
    <article v-else class="panel member-table">
      <table>
        <thead>
          <tr>
            <th>邀请名称</th>
            <th>注册归属</th>
            <th>已使用 / 上限</th>
            <th>有效期</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="i in invitations" :key="i.id">
            <td>
              {{ i.label }}<small>ID {{ i.id }}</small>
            </td>
            <td>{{ i.teamName ? i.teamName + "的团队" : "独立达人" }}</td>
            <td>{{ i.usedCount }} / {{ i.maxUses }}</td>
            <td>{{ format(i.expiresAt) }}</td>
            <td>
              {{
                {
                  active: "生效中",
                  expired: "已过期",
                  used: "已用完",
                  revoked: "已停用",
                }[i.status]
              }}
            </td>
            <td>
              <button
                v-if="i.status === 'active'"
                @click="
                  revokeTarget = i;
                  open('revoke');
                "
              >
                停用
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="!invitations.length" class="member-empty">
        还没有邀请链接，点击“邀请成员”创建。
      </p>
    </article>
    <ActionDialog
      :open="!!dialog"
      :title="title"
      :busy="busy"
      @close="dialog = null"
      ><p v-if="error" role="alert">{{ error }}</p>
      <form v-if="dialog === 'create'" @submit.prevent="run(createMember)">
        <label
          >登录账号<input
            v-model.trim="create.username"
            required
            minlength="3"
            maxlength="64"
            pattern="[a-zA-Z0-9_-]+" /></label
        ><label
          >显示名称<input
            v-model.trim="create.displayName"
            required
            maxlength="64" /></label
        ><label
          >角色<select v-model="create.role">
            <option v-for="role in managementRoles" :value="role" :key="role">
              {{ ROLE_LABELS[role] }}
            </option>
          </select></label
        ><label v-if="create.role === 'admin'"
          >管理员职责<select v-model="create.duty">
            <option value="all">完整管理</option>
            <option value="finance">财务</option>
            <option value="operations">运营</option>
          </select></label
        >
        <p>新账号使用随机临时密码，首次登录需要修改。</p>
        <div class="dialog-actions">
          <button type="button" :disabled="busy" @click="dialog = null">
            取消</button
          ><button class="primary" :disabled="busy">创建成员</button>
        </div>
      </form>
      <form
        v-else-if="dialog === 'edit' && selected"
        @submit.prevent="run(save)"
      >
        <label>登录账号<input :value="selected.username" readonly /></label
        ><label
          >显示名称<input
            v-model.trim="edit.displayName"
            required
            maxlength="64" /></label
        ><label>手机号<input v-model.trim="edit.phone" maxlength="20" /></label>
        <div class="edit-pair">
          <label
            >角色<select v-model="edit.role">
              <option
                v-for="role in selected.editableRoles"
                :key="role"
                :value="role"
              >
                {{ ROLE_LABELS[role] }}
              </option>
            </select></label
          ><label
            >状态<select v-model="edit.isActive">
              <option :value="true">启用</option>
              <option :value="false">停用</option>
            </select></label
          >
        </div>
        <label v-if="edit.role === 'admin' && auth.user?.role === 'developer'"
          >权限职责<select v-model="edit.adminDuty">
            <option value="all">完整管理</option>
            <option value="operations">业务运营</option>
            <option value="finance">财务</option>
          </select></label
        ><label v-if="edit.role === 'creator' && isStaffRole(auth.user?.role)"
          >所属团队<select v-model="edit.parentId">
            <option value="">独立达人</option>
            <option
              v-for="leader in leaders"
              :key="leader.id"
              :value="leader.id"
            >
              {{ leader.displayName }}（{{ leader.username }}）
            </option>
          </select></label
        >
        <fieldset class="member-projects">
          <legend>分配项目</legend>
          <p v-if="isStaffRole(edit.role)">
            管理角色按角色和职责访问全部项目，无需单独加入。
          </p>
          <template v-else-if="selected.canAssignProjects && canAssignProjects">
            <p v-if="auth.user?.role === 'leader'">可分配自己已加入且启用中的项目，仅对直属达人生效。超出范围的已有项目及管理权限会保留。</p>
            <label
              >搜索项目<input
                v-model="projectSearch"
                type="search"
                placeholder="输入项目名称"
            /></label>
            <div class="project-choices">
              <label
                v-for="project in projectOptions"
                :key="project.id"
                class="project-choice"
                ><input
                  v-model="edit.projectIds"
                  type="checkbox"
                  :value="project.id"
                  :disabled="
                    busy || projectLocked(project) ||
                    (!project.isEnabled &&
                      !edit.projectIds.includes(project.id))
                  "
                />
                <span
                  >{{ project.name
                  }}{{ project.isEnabled ? "" : "（已停用）" }}{{ projectLocked(project) ? "（只读）" : "" }}</span
                ></label
              >
            </div>
            <p v-if="!projectOptions.length">没有匹配的项目。</p>
            <small
              >已选择
              {{
                edit.projectIds.length
              }}
              个项目，保存后生效。新增成员权限为普通项目成员；有使用中关键词的项目需先处理后才能移出。</small
            >
          </template>
          <p v-else>
            {{
              selected.projects?.map((p) => p.name).join("、") ||
              "尚未分配项目"
            }}。当前账号无权为此成员分配项目。
          </p>
        </fieldset>
        <p>
          权限按角色和职责生效。调整角色或团队前，需先处理该成员使用中的关键词及下属成员。
        </p>
        <div class="dialog-actions">
          <button type="button" :disabled="busy" @click="dialog = null">
            取消</button
          ><button class="primary" :disabled="busy">保存修改</button>
        </div>
      </form>
      <div v-else-if="dialog === 'detail' && selected" class="member-detail">
        <dl>
          <dt>账号</dt>
          <dd>
            {{ selected.displayName }} · {{ selected.username }} · ID
            {{ selected.id }}
          </dd>
          <dt>角色与职责</dt>
          <dd>
            {{ ROLE_LABELS[selected.role] }}
            {{
              selected.adminDuty === "finance"
                ? "· 财务"
                : selected.adminDuty === "operations"
                  ? "· 运营"
                  : ""
            }}
          </dd>
          <dt>团队</dt>
          <dd>{{ selected.parentName || "未归属团长" }}</dd>
          <dt>注册来源</dt>
          <dd>{{ source(selected) }}</dd>
          <dt>创建人 / 邀请人</dt>
          <dd>
            {{ selected.createdByName || "—" }} /
            {{ selected.inviterName || "—" }}
          </dd>
          <dt>邀请记录</dt>
          <dd>
            {{ selected.invitationLabel || "无邀请链接记录"
            }}<small>{{ format(selected.invitedAt) }}</small>
          </dd>
          <dt>注册 / 登录</dt>
          <dd>
            {{ format(selected.createdAt) }} /
            {{ format(selected.lastLoginAt) }}
          </dd>
          <dt>业务范围</dt>
          <dd>
            {{
              isStaffRole(selected.role)
                ? "管理角色按职责访问项目"
                : selected.projects?.map((p) => p.name).join("、") ||
                  "尚未分配项目"
            }}
          </dd>
          <dt>成员统计</dt>
          <dd>
            项目 {{ selected.projectCount ?? 0 }} · 下属成员
            {{ selected.memberCount ?? 0 }} · 已邀请
            {{ selected.invitedCount ?? 0 }} 人
          </dd>
        </dl>
        <MemberClientDetails :member="selected" />
        <h3>角色权限</h3>
        <p>
          {{
            selected.role === "leader"
              ? "管理本人团队成员；业务按项目授权生效。"
              : selected.role === "creator"
                ? "只处理本人及分配给本人的业务。"
                : selected.adminDuty === "finance"
                  ? "仅财务职责范围，不能执行运营和账号管理操作。"
                  : selected.role === "operator"
                    ? "业务运营及下级团队管理，不含财务、接入密钥和管理账号授权。"
                    : "按角色层级管理账号与业务，不能越级授权。"
          }}
        </p>
        <div class="permission-tags">
          <span
            v-for="permission in selected.permissions?.filter(
              (p) => permissionNames[p],
            )"
            :key="permission"
            >{{ permissionNames[permission] }}</span
          >
        </div>
      </div>
      <form
        v-else-if="dialog === 'reset' && selected"
        @submit.prevent="run(reset)"
      >
        <p>重置 {{ selected.displayName }} 的密码将退出其所有设备。</p>
        <label
          >新密码（留空生成临时密码）<input
            v-model="resetPassword"
            type="password"
            autocomplete="new-password"
            minlength="8"
            maxlength="72"
        /></label>
        <div class="dialog-actions">
          <button type="button" :disabled="busy" @click="dialog = null">
            取消</button
          ><button class="primary" :disabled="busy">重置密码</button>
        </div>
      </form>
      <form v-else-if="dialog === 'invite'" @submit.prevent="run(createInvite)">
        <p>
          邀请注册固定创建达人{{
            auth.user?.role === "leader"
              ? "，自动加入你的团队"
              : "，由运营人员后续分配团队"
          }}。业务项目仍需单独授权。
        </p>
        <label
          >邀请名称<input v-model.trim="invite.label" required maxlength="100"
        /></label>
        <div class="edit-pair">
          <label
            >有效天数<input
              v-model.number="invite.validDays"
              type="number"
              min="1"
              max="30"
              required /></label
          ><label
            >最多注册人数<input
              v-model.number="invite.maxUses"
              type="number"
              min="1"
              max="1000"
              required
          /></label>
        </div>
        <div v-if="invitationLink">
          <label
            >邀请链接<input
              id="invitation-link"
              :value="invitationLink"
              readonly
              @focus="($event.target as HTMLInputElement).select()"
          /></label>
          <p>可在“邀请链接”页面再次复制、编辑或删除此链接。</p>
          <button type="button" @click="copyLink">复制邀请链接</button>
        </div>
        <div class="dialog-actions">
          <button type="button" :disabled="busy" @click="dialog = null">
            关闭</button
          ><button class="primary" :disabled="busy || !!invitationLink">
            生成邀请链接
          </button>
        </div>
      </form>
      <div v-else-if="dialog === 'revoke'">
        <p>
          停用“{{
            revokeTarget?.label
          }}”后，该链接不能再注册。已注册的成员不受影响。
        </p>
        <div class="dialog-actions">
          <button @click="dialog = null">取消</button
          ><button class="primary" :disabled="busy" @click="run(revoke)">
            确认停用
          </button>
        </div>
      </div>
      <div v-else-if="dialog === 'delete'">
        <p>
          永久删除“{{
            selected?.displayName
          }}”不可恢复。有业务数据或邀请记录的账号会被拒绝删除，可在编辑中改为停用。
        </p>
        <div class="dialog-actions">
          <button @click="dialog = null">取消</button
          ><button :disabled="busy" @click="run(remove)">确认删除</button>
        </div>
      </div>
    </ActionDialog>
  </section>
</template>
<style scoped>
.members-page {
  min-width: 0;
  grid-template-columns: minmax(0, 1fr);
}
.members-page > * {
  min-width: 0;
  max-width: 100%;
}
.members-page p {
  overflow-wrap: anywhere;
}
.members-page p {
  line-height: 1.6;
}
.member-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.members-page button {
  min-height: 40px;
  padding: 8px 12px;
  cursor: pointer;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: var(--paper);
  color: inherit;
}
.members-page button.primary-action {
  background: #195e62;
  color: white;
}
.members-page button:disabled {
  opacity: 0.5;
  cursor: default;
}
.member-tabs {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.member-tabs [aria-pressed="true"] {
  background: #195e62;
  color: white;
}
.member-filters {
  display: flex;
  gap: 16px;
  align-items: end;
  flex-wrap: wrap;
  padding: 20px;
  border-bottom: 1px solid var(--line);
}
.member-filters label {
  display: grid;
  gap: 8px;
  font-size: 13px;
}
.member-filters label:first-child {
  flex: 1;
  min-width: 230px;
}
.member-filters input,
.member-filters select {
  min-height: 42px;
  padding: 8px 12px;
  border: 1px solid var(--line);
  border-radius: 7px;
  color: inherit;
  background: var(--paper);
}
.member-table {
  overflow: auto;
  max-width: 100%;
}
.member-table table {
  width: 100%;
  border-collapse: collapse;
  text-align: left;
}
.member-table th,
.member-table td {
  padding: 16px;
  border-bottom: 1px solid var(--line);
  font-size: 13px;
  vertical-align: middle;
}
.member-table th {
  white-space: nowrap;
  font-weight: 500;
  color: var(--ink-soft);
}
.member-table small,
.member-detail small {
  display: block;
  color: var(--ink-soft);
  font-size: 12px;
  margin-top: 5px;
}
.actions-column {
  text-align: right;
  min-width: 200px;
}
.member-status {
  display: inline-block;
  padding: 3px 8px;
  border-radius: 5px;
  background: #e3efea;
  color: #23544a;
  margin-top: 8px;
  font-size: 12px;
}
.member-status.disabled {
  background: #f2e7e4;
  color: #8c413b;
}
.member-pagination {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  align-items: center;
  padding: 16px;
  font-size: 13px;
}
.member-pagination span {
  margin-right: auto;
}
.member-empty {
  padding: 32px;
  text-align: center;
  color: var(--ink-soft);
}
.member-error,
.danger {
  color: #a02f39 !important;
}
.secret-note {
  padding: 16px;
  border: 1px solid #d7c38c;
  background: #fbf4df;
  overflow-wrap: anywhere;
}
.edit-pair {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
.member-detail dl {
  display: grid;
  grid-template-columns: 120px 1fr;
  gap: 14px;
}
.member-detail dt {
  color: var(--ink-soft);
}
.member-detail dd {
  margin: 0;
  overflow-wrap: anywhere;
}
.permission-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.permission-tags span {
  background: #e8efec;
  padding: 6px 10px;
  border-radius: 5px;
  font-size: 12px;
}
@media (max-width: 650px) {
  .member-filters {
    padding: 14px;
    gap: 12px;
  }
  .member-filters label {
    flex: 1;
    min-width: 120px;
  }
  .member-filters label:first-child {
    flex-basis: 100%;
    min-width: 0;
  }
  .member-table table {
    min-width: 950px;
  }
  .edit-pair {
    grid-template-columns: 1fr;
  }
  .member-detail dl {
    grid-template-columns: 1fr;
    gap: 7px;
  }
  .member-detail dd {
    margin-bottom: 10px;
  }
  .member-pagination {
    flex-wrap: wrap;
  }
}
</style>
<style scoped>
.member-projects {
  min-width: 0;
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 16px;
}
.member-projects legend {
  padding: 0 6px;
  font-weight: 600;
}
.project-choices {
  max-height: 180px;
  overflow: auto;
  margin: 12px 0;
  display: grid;
  gap: 8px;
}
.project-choice {
  display: flex !important;
  align-items: center;
  gap: 10px !important;
  min-height: 36px;
}
.project-choice input {
  width: 18px !important;
  min-height: 18px !important;
  height: 18px;
  flex: 0 0 18px;
}
.project-choice span {
  overflow-wrap: anywhere;
}
</style>
