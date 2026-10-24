import assert from "node:assert/strict";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

const root = await realpath(fileURLToPath(new URL("../", import.meta.url)));
const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));

// Agent 指令入口
assert.ok(
  (await readFile(path.join(root, "AGENTS.md"), "utf8")).trim(),
  "AGENTS.md must contain the shared project instructions",
);
assert.match(
  await readFile(path.join(root, "CLAUDE.md"), "utf8"),
  /^@AGENTS\.md\r?$/m,
  "CLAUDE.md must import @AGENTS.md on its own line",
);

// 根目录即插件包：检查清单和入口，不实现完整的 magpie 清单校验
const manifest = await readJson(path.join(root, "package.json"));
for (const field of ["name", "version", "main"]) {
  assert.equal(typeof manifest[field], "string", "package.json: missing " + field);
  assert.ok(manifest[field].trim(), "package.json: empty " + field);
}
assert.equal(manifest.private, true, "package.json: keep private until npm publishing is intended");
assert.equal(manifest.workspaces, undefined, "package.json: the plugin root must not be a workspace");
assert.ok((await readFile(path.join(root, "README.md"), "utf8")).trim(), "README.md must not be empty");
const entry = await realpath(path.resolve(root, manifest.main));
const relative = path.relative(root, entry);
assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative), "Entry must stay inside the repository");
assert.ok((await stat(entry)).isFile(), "Entry is not a file: " + manifest.main);

// 面板文件必须在仓库内并存在
for (const panel of manifest.magpie?.panels ?? []) {
  const file = path.resolve(root, panel.file);
  const rel = path.relative(root, file);
  assert.ok(rel && !rel.startsWith("..") && !path.isAbsolute(rel), "Panel must stay inside the repository: " + panel.file);
  assert.ok((await stat(file)).isFile(), "Panel file is missing: " + panel.file);
  assert.ok(["agents", "usage", "settings", "provider"].includes(panel.slot), "Unknown panel slot: " + panel.slot);
}

// 宿主会把入口导出的每个函数当作插件调用：只允许默认导出插件函数
const mod = await import(pathToFileURL(entry).href);
assert.equal(typeof mod.default, "function", "Entry must default-export the plugin function");
for (const [name, value] of Object.entries(mod)) {
  if (name !== "default") assert.notEqual(typeof value, "function", "Entry must not export helper function: " + name);
}

// JavaScript 语法
let sources = 0;
async function checkSources(dir) {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    if (["node_modules", ".git", "coverage", "dist"].includes(item.name)) continue;
    const file = path.join(dir, item.name);
    assert.ok(!item.isSymbolicLink(), "Source symlinks are not checked: " + file);
    if (item.isDirectory()) await checkSources(file);
    else if (/\.(?:js|mjs|cjs)$/.test(item.name)) {
      execFileSync(process.execPath, ["--check", file], { stdio: "inherit" });
      sources++;
    }
  }
}
await checkSources(root);

// 单元测试（node:test，不调用外部服务）
execFileSync(process.execPath, ["--test", "test/"], { cwd: root, stdio: "inherit" });

console.log("Checked Agent entry files, plugin manifest, " + sources + " JavaScript file(s) and unit tests.");
