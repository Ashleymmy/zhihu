<script setup lang="ts">
import { ref } from "vue";
import RateSettings from "../../src/RateSettings.vue";
import type { WorkspaceHttp } from "../../src/core-workspace";
const open = ref(false);
const config = (
  window as unknown as { rateTest: { token: string; client: string } }
).rateTest;
async function call<T>(
  method: string,
  route: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch("/api/v1/core" + route, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + config.token,
      "X-Client-Id": config.client,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok) throw Error(data.message ?? "请求失败");
  return data.data;
}
const http: WorkspaceHttp = {
  get: (url, params) =>
    call(
      "GET",
      url + "?" + new URLSearchParams(params as Record<string, string>),
    ),
  post: (url, body) => call("POST", url, body),
  patch: (url, body) => call("PATCH", url, body),
  del: (url) => call("DELETE", url),
};
</script>
<template>
  <main>
    <p>知乎故事推广</p>
    <h1>计费规则</h1>
    <button @click="open = true">查看与设置单价</button
    ><RateSettings
      :open="open"
      project-id="1"
      module-id="zhihu"
      :http="http"
      @close="open = false"
    />
  </main>
</template>
<style>
html,
body {
  margin: 0;
  background: #f7f8f6;
  color: #243438;
  font-family: system-ui, sans-serif;
}
main {
  padding: 28px;
}
main button {
  background: #195e62;
  color: #fff;
  border: 0;
  border-radius: 8px;
  padding: 12px 18px;
  font: inherit;
}
</style>
