<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { http, useAuthStore } from "../stores/auth";
import { DetailDrawer } from "@zhihu-koc/shared-components";
const auth = useAuthStore();
const canConfigure = computed(
  () =>
    ["admin", "developer"].includes(auth.user?.role || "") &&
    (auth.user?.adminDuty || "all") === "all",
);
type Settings = {
  serviceUrl: string;
  businessUrl: string;
  serviceHours: string;
  miniContactEnabled: boolean;
  revision: number;
};
const settings = ref<Settings | null>(null),
  draft = ref<Settings | null>(null),
  loading = ref(false),
  saving = ref(false),
  error = ref(""),
  saved = ref("");
async function load() {
  loading.value = true;
  error.value = "";
  try {
    settings.value = await http.get<Settings>("/support");
  } catch (e: any) {
    error.value = e.message || "联系方式加载失败，请重试";
  } finally {
    loading.value = false;
  }
}
async function save() {
  if (!draft.value || saving.value) return;
  saving.value = true;
  error.value = "";
  try {
    settings.value = await http.put<Settings>("/support", draft.value);
    draft.value = null;
    saved.value = "联系方式已保存";
  } catch (e: any) {
    error.value = e.message || "保存失败，请重试";
  } finally {
    saving.value = false;
  }
}
onMounted(load);
</script>
<template>
  <section class="page-stack support-page">
    <header class="page-header">
      <div>
        <h1>帮助与客服</h1>
        <p>使用问题找客服，项目合作找商务。</p>
      </div>
      <button
        v-if="canConfigure && settings"
        class="row-action"
        @click="
          draft = { ...settings };
          saved = '';
        "
      >
        设置联系方式
      </button>
    </header>
    <p v-if="error" role="alert">
      {{ error }} <button class="row-action" @click="load">刷新</button>
    </p>
    <p v-if="saved" role="status">{{ saved }}</p>
    <p v-if="loading">正在加载联系方式…</p>
    <div v-if="settings" class="support-cards">
      <article class="panel">
        <h2>联系客服</h2>
        <p>账号、作品提交和收益查询等使用问题。</p>
        <p v-if="settings.serviceHours">
          服务时间：{{ settings.serviceHours }}
        </p>
        <a
          v-if="settings.serviceUrl"
          :href="settings.serviceUrl"
          target="_blank"
          rel="noopener noreferrer"
          class="primary-action"
          >在飞书联系客服 ↗</a
        >
        <p v-else>在线联系方式尚未开通，可先查看下方常见问题。</p>
      </article>
      <article class="panel">
        <h2>商务合作</h2>
        <p>渠道、团队和项目合作咨询。</p>
        <a
          v-if="settings.businessUrl"
          :href="settings.businessUrl"
          target="_blank"
          rel="noopener noreferrer"
          class="row-action"
          >在飞书联系商务 ↗</a
        >
        <p v-else>商务联系方式尚未开通。</p>
      </article>
    </div>
    <article class="panel">
      <h2>常见问题</h2>
      <details>
        <summary>登录遇到问题</summary>
        <p>
          使用已验证的手机号加密码登录，也可以选择短信验证码。尚未验证手机号的旧账号可使用原账号登录。
        </p>
      </details>
      <details>
        <summary>作品提交失败怎么办</summary>
        <p>
          在作品记录中查看失败提示，修改作品信息后重新提交。提交成功后仍需等待审核结果。
        </p>
      </details>
      <details>
        <summary>咨询时需要提供什么</summary>
        <p>
          请提供你的用户
          ID、相关关键词、发生时间和问题截图。不要发送密码或短信验证码。
        </p>
        <p>你的用户 ID：{{ auth.user?.userId || "—" }}</p>
      </details>
    </article>
    <DetailDrawer :open="!!draft" title="联系方式设置" @close="draft = null">
      <form v-if="draft" class="support-form" @submit.prevent="save">
        <label
          >客服飞书链接<input
            v-model.trim="draft.serviceUrl"
            type="url"
            placeholder="https://…"
            maxlength="2048"
        /></label>
        <label
          >商务合作飞书链接<input
            v-model.trim="draft.businessUrl"
            type="url"
            placeholder="https://…"
            maxlength="2048"
        /></label>
        <label
          >服务时间<input
            v-model.trim="draft.serviceHours"
            maxlength="100"
            placeholder="例如：工作日 9:00–18:00"
        /></label>
        <label class="check"
          ><input
            v-model="draft.miniContactEnabled"
            type="checkbox"
          />已在微信后台绑定客服人员，并确认能接收消息</label
        >
        <p>
          勾选后，小程序客服页显示微信客服按钮。飞书链接留空时，用户端不显示对应跳转按钮。
        </p>
        <p v-if="error" role="alert">{{ error }}</p>
        <button class="primary-action" :disabled="saving">
          {{ saving ? "保存中…" : "保存设置" }}
        </button>
      </form>
    </DetailDrawer>
  </section>
</template>
<style scoped>
.support-cards {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
}
.panel {
  padding: 24px;
}
.panel h2 {
  margin: 0 0 12px;
}
.panel p {
  color: var(--ink-soft);
  line-height: 1.7;
}
.panel a {
  display: inline-flex;
  text-decoration: none;
  max-width: 100%;
  white-space: normal;
}
.support-form {
  display: grid;
  gap: 20px;
}
.support-form label {
  display: grid;
  gap: 8px;
}
.support-form input:not([type="checkbox"]) {
  width: 100%;
  min-width: 0;
}
.support-form .check {
  display: flex;
  align-items: flex-start;
}
.support-form p {
  color: var(--ink-soft);
  line-height: 1.7;
}
details {
  padding: 16px 0;
  border-bottom: 1px solid var(--line);
}
summary {
  cursor: pointer;
}
details:last-child {
  border: 0;
}
@media (max-width: 700px) {
  .support-cards {
    grid-template-columns: 1fr;
  }
  .panel {
    padding: 18px;
  }
  .page-header {
    flex-wrap: wrap;
  }
}
</style>
