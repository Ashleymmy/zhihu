"use strict";
const https = require("node:https");
const crypto = require("node:crypto");
const { checkContent } = require("./content-safety");
const ENDPOINT = "https://timo.clouddo.cc/api/v1/mini/bridge";
const APP_ID = "wx22b91776ccf37354";
function createBridge({
  context,
  secret,
  environment,
  version,
  check,
  send = sendHttps,
}) {
  return async (event) => {
    try {
      const wx = context();
      if (!wx.OPENID || wx.APPID !== APP_ID)
        return {
          statusCode: 403,
          code: 40300,
          data: null,
          message: "请从 TIMO 小程序访问",
        };
      if (!secret || secret.length < 32)
        return {
          statusCode: 503,
          code: 50300,
          data: null,
          message: "小程序接入尚未配置",
        };
      if (
        !event ||
        !/^\/(core|modules\/zhihu)\/[a-zA-Z0-9_/-]+$/.test(event.path || "") ||
        !["GET", "POST", "PATCH", "PUT", "DELETE"].includes(
          event.method || "GET",
        )
      )
        return {
          statusCode: 422,
          code: 42200,
          data: null,
          message: "请求参数不正确",
        };
      // Identity always comes from the WeChat invocation, never event.openId or event.appId.
      const observation = {};
      if (/^[\w-]{1,80}$/.test(environment || ""))
        observation.environment = environment;
      if (/^[\w.-]{1,32}$/.test(version || "")) observation.version = version;
      const info = event.clientInfo || {};
      if (
        typeof info.version === "string" &&
        /^[\w.-]{1,32}$/.test(info.version)
      )
        observation.clientVersion = info.version;
      if (["develop", "trial", "release"].includes(info.envVersion))
        observation.clientEnv = info.envVersion;
      const method = event.method || "GET",
        data = event.data || {};
      let contentSafety;
      try {
        contentSafety = await checkContent(
          event.path,
          method,
          data,
          wx.OPENID,
          check,
        );
      } catch (e) {
        return {
          statusCode: e.statusCode || 503,
          code: e.code || 50332,
          data: null,
          message: e.message,
        };
      }
      const payload = JSON.stringify({
        appId: wx.APPID,
        openId: wx.OPENID,
        path: event.path,
        method,
        data,
        token: event.token || undefined,
        observation,
        contentSafety,
      });
      if (Buffer.byteLength(payload) > 1024 * 1024)
        return {
          statusCode: 413,
          code: 41300,
          data: null,
          message: "请求过大，请分块上传文件",
        };
      const timestamp = String(Date.now()),
        nonce = crypto.randomBytes(16).toString("hex");
      const signature = crypto
        .createHmac("sha256", secret)
        .update(timestamp + "\n" + nonce + "\n" + payload)
        .digest("hex");
      return await send(ENDPOINT, payload, {
        "X-Bridge-Time": timestamp,
        "X-Bridge-Nonce": nonce,
        "X-Bridge-Signature": signature,
      });
    } catch (_) {
      // Do not log bodies, account passwords, tokens, or signing keys.
      return {
        statusCode: 502,
        code: 50200,
        data: null,
        message: "服务器暂时未响应，请稍后刷新确认操作结果",
      };
    }
  };
}
function sendHttps(url, payload, headers) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: "POST",
        timeout: 55000,
        headers: {
          ...headers,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        let size = 0;
        const chunks = [];
        res.on("data", (b) => {
          size += b.length;
          if (size > 8 * 1024 * 1024) {
            res.destroy(new Error("response too large"));
            return;
          }
          chunks.push(b);
        });
        res.on("error", reject);
        res.on("end", () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            if (typeof body.code !== "number")
              throw new Error("invalid response");
            resolve({ ...body, statusCode: res.statusCode });
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end(payload);
  });
}
module.exports = { createBridge };
