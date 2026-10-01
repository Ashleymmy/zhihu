// Export the agreement page content to Markdown docs for legal review.
const fs = require("node:fs");
const path = require("node:path");

const src = fs.readFileSync(
  path.join(__dirname, "../miniprogram/pages/agreement/index.js"),
  "utf8",
);
// Page() stub: capture the data constants by evaluating the module source.
let captured = {};
const Page = (config) => { captured = config; };
const wx = { setNavigationBarTitle() {} };
eval(src.replace(/^\/\/[^\n]*\n/gm, "")); // strip comment lines

const date = new Date().toISOString().slice(0, 10);
function toMd(title, sections) {
  const body = sections
    .map((s) => "## " + s.title + "\n\n" + s.body)
    .join("\n\n");
  return (
    "# TIMO 多渠道 OPC 业务平台" + title + "\n\n" +
    "更新与生效日期：" + date + "\n\n" + body +
    "\n\n---\n\n本协议最终解释权归平台运营方所有。\n"
  );
}
// eval gives us the data() initial value only; sections live in constants.
// Grab them directly from module scope via a second eval trick:
const sectionsMatch = { user: "USER_SECTIONS", privacy: "PRIVACY_SECTIONS" };
const sandbox = src.replace(/^\/\/[^\n]*\n/gm, "");
const grab = (name) => {
  const fn = new Function("Page", "wx", sandbox + "; return " + name + ";");
  return fn(Page, wx);
};
fs.writeFileSync(
  path.join(__dirname, "../docs/用户协议.md"),
  toMd("用户协议", grab(sectionsMatch.user)),
  "utf8",
);
fs.writeFileSync(
  path.join(__dirname, "../docs/隐私协议.md"),
  toMd("隐私协议", grab(sectionsMatch.privacy)),
  "utf8",
);
console.log("exported docs/用户协议.md and docs/隐私协议.md");
