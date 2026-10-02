const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const assert = require("node:assert/strict");
const { harness } = require("../tests/harness.cjs");
const root = path.resolve(__dirname, "../miniprogram");
const walk = (dir) =>
  fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) =>
      entry.isDirectory()
        ? walk(path.join(dir, entry.name))
        : [path.join(dir, entry.name)],
    );
const files = walk(root);
for (const file of files) {
  if (file.endsWith(".js"))
    new vm.Script(fs.readFileSync(file, "utf8"), { filename: file });
  if (file.endsWith(".json")) JSON.parse(fs.readFileSync(file, "utf8"));
}
const app = JSON.parse(fs.readFileSync(path.join(root, "app.json")));
const shared = fs.readFileSync(
  path.join(root, "templates/shared.wxml"),
  "utf8",
);
for (const page of app.pages) {
  for (const ext of ["js", "json", "wxml", "wxss"])
    assert.ok(
      fs.existsSync(path.join(root, page + "." + ext)),
      page + "." + ext,
    );
  const config = JSON.parse(fs.readFileSync(path.join(root, page + ".json")));
  for (const component of Object.values(config.usingComponents || {}))
    for (const ext of ["js", "json", "wxml", "wxss"])
      assert.ok(
        fs.existsSync(
          path.join(root, component.replace(/^\//, "") + "." + ext),
        ),
        component,
      );
  const name = page.replace(/^pages\//, "").replace(/\/index$/, ""),
    instance = harness().page(name);
  const source = fs.readFileSync(path.join(root, page + ".wxml"), "utf8");
  // Only validate shared handlers for pages that actually import that template.
  const wxml =
    source +
    (source.includes("templates/shared.wxml") ? shared : "") +
    (source.includes("templates/consent.wxml")
      ? fs.readFileSync(path.join(root, "templates/consent.wxml"), "utf8")
      : "");
  for (const event of wxml.matchAll(/(?:bind|catch):?[\w-]+="([A-Za-z]\w*)"/g))
    assert.equal(
      typeof instance[event[1]],
      "function",
      page + " missing event " + event[1],
    );
  for (const target of wxml.matchAll(/data-path="\/(pages\/[^"]+)"/g))
    assert.ok(app.pages.includes(target[1]), target[1]);
}
// Windows PowerShell 5.1（Windows 自带，本机 `pwsh` 实际指向的版本）会把无 BOM 的
// .ps1 按 GBK 读取，脚本里的中文路径（微信开发者工具）随即变成乱码，报
// 「无法将 ... 识别为 cmdlet」。云端脚本此前只在 PowerShell 7 下验证过。
// 编辑器或写文件工具很容易把 BOM 丢掉，所以在这里强制校验。
const ps1Directory = path.resolve(__dirname);
const ps1Files = fs
  .readdirSync(ps1Directory)
  .filter((name) => name.endsWith(".ps1"));
for (const name of ps1Files) {
  const bytes = fs.readFileSync(path.join(ps1Directory, name));
  assert.ok(
    bytes.length >= 3 &&
      bytes[0] === 0xef &&
      bytes[1] === 0xbb &&
      bytes[2] === 0xbf,
    name + " 必须保存为带 BOM 的 UTF-8，否则 PowerShell 5.1 会误读其中的中文",
  );
}
console.log(
  "Static checks passed:",
  app.pages.length,
  "pages; JS, JSON, components, routes and WXML event handlers;",
  ps1Files.length,
  "PowerShell scripts carry a UTF-8 BOM",
);
if (process.argv.includes("--wechat")) {
  const bin =
    process.env.WECHAT_COMPILER_DIR ||
    [
      "resources/app.asar.unpacked/node_modules/wcc-exec",
      "code/package.nw/node_modules/wcc-exec",
    ]
      .map((folder) =>
        path.join("C:/Program Files (x86)/Tencent/微信web开发者工具", folder),
      )
      .find((folder) => fs.existsSync(path.join(folder, "wcc.exe"))) ||
    "";
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "timo-opc-compile-"));
  for (const [name, extension] of [
    ["wcc", "wxml"],
    ["wcsc", "wxss"],
  ]) {
    const compiler = path.join(bin, name + ".exe");
    assert.ok(
      fs.existsSync(compiler),
      "Compiler missing: set WECHAT_COMPILER_DIR",
    );
    const inputs = files
      .filter((f) => f.endsWith("." + extension))
      .map((f) => path.relative(root, f).replaceAll("\\", "/"));
    const result = spawnSync(
      compiler,
      ["-o", path.join(output, name + ".js"), ...inputs],
      { cwd: root, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
    );
    assert.equal(
      result.status,
      0,
      result.stderr || String(result.error || result.stdout),
    );
    console.log(name + " compiled " + inputs.length + " files");
  }
}
