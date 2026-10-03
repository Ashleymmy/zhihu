"use strict";
const crypto = require("node:crypto");
// Only publishable text. Never send passwords, OTPs, phone numbers, contacts,
// payment accounts, tokens, raw imports or file bodies to the moderation API.
const PUBLIC_FIELDS = new Set([
  "displayName",
  "name",
  "title",
  "keyword",
  "label",
  "intro",
  "description",
  "content",
  "message",
  "remark",
  "reason",
  "note",
  "courseName",
  "mediaAccount",
  "accountName",
]);
function textsFor(path, method, data) {
  if (!["POST", "PUT", "PATCH"].includes(method)) return [];
  if (
    path.startsWith("/core/auth/") &&
    !["/core/auth/register", "/core/auth/profile"].includes(path)
  )
    return [];
  if (
    path.startsWith("/core/account-privacy/") ||
    path.startsWith("/core/files/") ||
    path.startsWith("/core/finance")
  )
    return [];
  const texts = [];
  function visit(value, depth) {
    if (depth > 8 || value === null || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach((v) => visit(v, depth + 1));
      return;
    }
    for (const [key, v] of Object.entries(value)) {
      if (PUBLIC_FIELDS.has(key) && typeof v === "string" && v.trim())
        texts.push(v.trim());
      else if (v && typeof v === "object") visit(v, depth + 1);
    }
  }
  visit(data, 0);
  if (path === "/core/auth/register" && typeof data.username === "string")
    texts.push(data.username.trim());
  return texts;
}
function digest(path, method, texts) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify([path, method, texts]))
    .digest("hex");
}
async function checkContent(path, method, data, openId, check) {
  const texts = textsFor(path, method, data);
  if (!texts.length) return undefined;
  if (typeof check !== "function")
    throw Object.assign(new Error("内容安全服务暂不可用，请稍后重试"), {
      statusCode: 503,
      code: 50332,
    });
  const text = texts.join("\n");
  if (Array.from(text).length > 12000)
    throw Object.assign(new Error("本次文字内容过多，请分批提交"), {
      statusCode: 422,
      code: 42232,
    });
  const chars = Array.from(text),
    traceIds = [];
  for (let start = 0; start < chars.length; start += 2000) {
    let result;
    try {
      result = await check({
        content: chars.slice(start, start + 2000).join(""),
        version: 2,
        scene: path.startsWith("/core/auth/") ? 1 : 3,
        openid: openId,
      });
    } catch (e) {
      console.warn(
        "content_safety_unavailable",
        Number(e?.errCode ?? e?.errcode) || "unknown",
      );
      throw Object.assign(new Error("内容安全服务暂不可用，请稍后重试"), {
        statusCode: 503,
        code: 50332,
      });
    }
    if (
      Number(result?.errCode ?? result?.errcode ?? -1) !== 0 ||
      !["pass", "review", "risky"].includes(result?.result?.suggest)
    )
      throw Object.assign(new Error("内容安全服务暂不可用，请稍后重试"), {
        statusCode: 503,
        code: 50332,
      });
    if (result.result.suggest !== "pass")
      throw Object.assign(
        new Error(
          "内容未通过安全检查，请调整后重新提交；如有疑问可在帮助与隐私中联系我们",
        ),
        { statusCode: 422, code: 42233 },
      );
    traceIds.push(
      String(result.traceId ?? result.trace_id ?? "").slice(0, 128),
    );
  }
  return { version: 1, digest: digest(path, method, texts), traceIds };
}
module.exports = { textsFor, digest, checkContent };
