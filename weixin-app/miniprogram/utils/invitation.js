// Keep invitation context only for this app session; never persist a stale attribution.
let pending = "";
function capture(options = {}) {
  if (options.invite !== undefined || options.code !== undefined) {
    pending = String(
      options.invite !== undefined ? options.invite : options.code,
    )
      .trim()
      .toUpperCase();
    if (!pending) pending = "INVALID";
  } else if (options.scene !== undefined) {
    try {
      const scene = decodeURIComponent(String(options.scene));
      pending =
        scene
          .replace(/^(invite|code)=/i, "")
          .trim()
          .toUpperCase() || "INVALID";
    } catch (_) {
      pending = "INVALID";
    }
  }
  return pending;
}
module.exports = {
  capture,
  get: () => pending,
  clear: () => {
    pending = "";
  },
  route: (path) =>
    path + (pending ? "?invite=" + encodeURIComponent(pending) : ""),
};
