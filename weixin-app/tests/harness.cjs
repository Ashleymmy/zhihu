const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "../miniprogram");
function harness(handler = () => ({})) {
  const storage = new Map(),
    cache = new Map(),
    calls = [],
    navigation = [];
  let pageDefinition;
  const app = {
    globalData: { user: null, scope: { projectId: "", accountId: "" } },
  };
  const wx = {
    getStorageSync: (key) => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: (key) => storage.delete(key),
    reLaunch: (value) => navigation.push(value.url),
    navigateTo: (value) => navigation.push(value.url),
    redirectTo: (value) => navigation.push(value.url),
    switchTab: (value) => navigation.push(value.url),
    setClipboardData() {},
    // config/env.js 依赖它区分开发版/体验版/正式版；默认开发版，
    // 测试可覆盖为 { miniProgram: { envVersion: 'release' } } 验证生产守卫。
    getAccountInfoSync: () => ({ miniProgram: { envVersion: "develop" } }),
    // 测试可覆盖为 { confirm: false }（Promise 或回调风格均可，feedback 模块两种都兼容）。
    showModal: (options) => {
      const res = { confirm: true, cancel: false };
      if (options && typeof options.success === "function") options.success(res);
      return Promise.resolve(res);
    },
    // 全局反馈基建（utils/feedback.js、screen.js 下拉刷新/触底加载）依赖的
    // 交互 API 桩件：测试中静默成功，需要断言时可覆盖。
    showToast: (options) => {
      if (options && typeof options.complete === "function") options.complete();
    },
    showLoading() {},
    hideLoading() {},
    hideToast() {},
    stopPullDownRefresh() {},
    vibrateShort() {},
    vibrateLong() {},
    request(options) {
      const call = {
        path: new URL(options.url).pathname.replace("/api/v1", ""),
        method: options.method,
        data: options.data,
        header: options.header,
      };
      calls.push(call);
      Promise.resolve()
        .then(() => handler(call))
        .then(
          (value) => {
            if (value && value.networkError)
              options.fail({ errMsg: value.networkError });
            else
              options.success(
                value && value.http
                  ? { statusCode: value.http, data: value.body }
                  : { statusCode: 200, data: { code: 0, data: value } },
              );
          },
          (error) => options.fail({ errMsg: error.message }),
        );
    },
  };
  wx.cloud = {
    init() {},
    callFunction(options) {
      wx.request({
        url: "https://cloud.test/api/v1" + options.data.path,
        method: options.data.method,
        data: options.data.data,
        header: options.data.token ? {Authorization: "Bearer " + options.data.token} : {},
        success(response) {
          options.success({result: Object.assign({statusCode: response.statusCode, code: response.statusCode >= 400 ? response.statusCode * 100 : 0}, response.data)});
        },
        fail: options.fail,
      });
    },
  };
  // 本地文件系统与文件选择：测试用 files.set(path, Buffer) 预置内容。
  // readFile 必须回传 ArrayBuffer，与真机 chooseMessageFile 的语义一致。
  const files = new Map();
  wx.chooseMessageFile = () =>
    Promise.reject(new Error("chooseMessageFile 未在测试中注入"));
  wx.arrayBufferToBase64 = (buffer) =>
    Buffer.from(buffer).toString("base64");
  wx.getFileSystemManager = () => ({
    readFile({ filePath, success, fail }) {
      const content = files.get(filePath);
      if (!content) {
        fail({ errMsg: "readFile:fail no such file or directory" });
        return;
      }
      success({
        data: content.buffer.slice(
          content.byteOffset,
          content.byteOffset + content.byteLength,
        ),
      });
    },
  });
  function load(file) {
    const filename = path.resolve(
      root,
      file.endsWith(".js") ? file : file + ".js",
    );
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} };
    cache.set(filename, module);
    const localRequire = (name) =>
      name.startsWith(".")
        ? load(path.resolve(path.dirname(filename), name))
        : require(name);
    const context = {
      module,
      exports: module.exports,
      require: localRequire,
      wx,
      getApp: () => app,
      getCurrentPages: () => [],
      Page: (d) => {
        pageDefinition = d;
      },
      App: (d) => Object.assign(app, d),
      Component() {},
      console,
      URL,
      Date,
      Set,
      Promise,
      // 小程序运行时有定时器；分片重试依赖它，缺少会让真实上传逻辑无法测试。
      setTimeout,
      clearTimeout,
      // 静默轮询刷新依赖它（keywords 页 onShow 里启动）；unref 避免测试从不
      // 模拟 onHide 时定时器让 Node 进程挂住。
      setInterval: (fn, ms) => setInterval(fn, ms).unref(),
      clearInterval,
    };
    vm.runInNewContext(fs.readFileSync(filename, "utf8"), context, {
      filename,
    });
    return module.exports;
  }
  function session(
    user = { id: "1", role: "admin", adminDuty: "all" },
    token = "test-token",
  ) {
    storage.set("zk_access_token", token);
    app.globalData.user = user;
  }
  function page(name) {
    load("pages/" + name + "/index");
    const instance = Object.assign({}, pageDefinition, {
      data: JSON.parse(JSON.stringify(pageDefinition.data)),
    });
    instance.setData = (values) => {
      for (const [key, value] of Object.entries(values)) {
        const fields = key.split(".");
        let target = instance.data;
        for (const field of fields.slice(0, -1))
          target = target[field] || (target[field] = {});
        target[fields.at(-1)] = value;
      }
    };
    return instance;
  }
  app.handleUnauthorized = () => {
    load("utils/auth").clear();
    wx.reLaunch({ url: "/pages/login/index" });
  };
  return { wx, storage, app, calls, navigation, files, load, page, session };
}
function scoped(call) {
  if (call.path === "/core/projects")
    return [{ id: "1", name: "项目一", isEnabled: true }];
  if (call.path === "/core/projects/1/integrations")
    return [
      { id: "10", name: "知乎账号", moduleId: "zhihu", status: "active" },
    ];
  return undefined;
}
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
module.exports = { harness, scoped, deferred };
