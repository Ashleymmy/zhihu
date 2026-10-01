const request = require("./request");
let serial = 0;
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object")
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        if (value[key] !== undefined) result[key] = stable(value[key]);
        return result;
      }, {});
  return value;
}
function intent(owner, path, payload) {
  const signature = JSON.stringify([path, stable(payload)]);
  owner._intents = owner._intents || {};
  if (!owner._intents[signature])
    owner._intents[signature] =
      "wx-" +
      Date.now() +
      "-" +
      ++serial +
      "-" +
      Math.random().toString(36).slice(2);
  return { signature, key: owner._intents[signature] };
}
async function send(owner, method, path, payload) {
  if (owner.canAct && !owner.canAct())
    throw new Error("页面或会话已变化，请重新加载后操作");
  const entry = intent(owner, path, payload);
  if (owner._activeIntents && !owner._activeIntents.includes(entry.signature))
    owner._activeIntents.push(entry.signature);
  // Retain keys until the entire action succeeds, including multi-step submissions.
  return request.send(path, {
    method,
    data: Object.assign({}, payload, { requestKey: entry.key }),
  });
}
async function post(owner, path, payload) {
  return send(owner, "POST", path, payload);
}
async function del(owner, path, payload) {
  return send(owner, "DELETE", path, payload);
}
function finish(owner, signatures) {
  if (!signatures) {
    owner._intents = {};
    return;
  }
  for (const signature of signatures) delete (owner._intents || {})[signature];
}
function money(value, decimals = 2, allowZero = false) {
  return (
    new RegExp("^\\d+(\\.\\d{1," + decimals + "})?$").test(String(value)) &&
    Number.isFinite(Number(value)) &&
    (allowZero ? Number(value) >= 0 : Number(value) > 0)
  );
}
function today() {
  const date = new Date(Date.now() + 8 * 3600000);
  return date.toISOString().slice(0, 10);
}
function publicUrl(value) {
  return /^https?:\/\/[^\s/@:]+(?::\d+)?(?:[/?#][^\s]*)?$/i.test(value);
}
module.exports = { intent, send, post, del, finish, money, today, publicUrl };
