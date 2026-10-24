import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";

const context = {};
vm.runInNewContext(await readFile(new URL("../ui/core.js", import.meta.url), "utf8"), context);
const S = context.CodexRelaySettings;
const plain = (o) => JSON.parse(JSON.stringify(o));
const save = (form, existing) => plain(S.optionsFromForm({ ...S.formFromOptions(existing), ...form }, existing));

test("form round-trip keeps options and preserves unknown keys", () => {
  const existing = {
    inheritFrom: "relay",
    stripPrefix: ["vendor/"],
    models: ["vendor/a", { id: "vendor/b", context: 512000 }],
    modelDefaults: { context: 512000, variants: ["low", "high"] },
    identity: { originator: "x" },
    setHeaders: { "x-a": "1" },
  };
  const { options, errors } = save({}, existing);
  assert.deepEqual(errors, []);
  assert.deepEqual(options, existing);
});

test("models and stripPrefix are not form fields and are kept as saved", () => {
  const f = S.formFromOptions({ inheritFrom: "r", models: ["a"], stripPrefix: ["x/"] });
  assert.equal("models" in f, false);
  assert.equal("stripPrefix" in f, false);
  const { options } = save({ debug: true }, { inheritFrom: "r", models: ["a"], stripPrefix: ["x/"] });
  assert.deepEqual(options.models, ["a"]);
  assert.deepEqual(options.stripPrefix, ["x/"]);
});

test("manual source drops inheritFrom; inherit source drops baseURL; apiKeyEnv removed", () => {
  const manual = save({ source: "manual", baseURL: "https://relay.test/v1/" }, { inheritFrom: "relay", apiKeyEnv: "X" });
  assert.deepEqual(manual.errors, []);
  assert.equal(manual.options.baseURL, "https://relay.test/v1");
  assert.equal(manual.options.inheritFrom, undefined);
  assert.equal(manual.options.apiKeyEnv, undefined);
  const inherit = save({ source: "inherit", inheritFrom: "relay" }, { baseURL: "https://x/v1" });
  assert.equal(inherit.options.inheritFrom, "relay");
  assert.equal(inherit.options.baseURL, undefined);
});

test("validation errors", () => {
  const { errors } = save({ source: "inherit", inheritFrom: "", context: "-1", baseURL: "" }, {});
  assert.ok(errors.some((e) => e.includes("复用")));
  assert.ok(errors.some((e) => e.includes("上下文")));
  assert.ok(save({ source: "inherit", inheritFrom: "codex-relay" }, {}).errors.some((e) => e.includes("自己")));
  assert.ok(save({ source: "manual", baseURL: "relay.test" }, {}).errors.some((e) => e.includes("http")));
  // 模型不在面板里填：没有 models 也能保存
  assert.deepEqual(save({}, { inheritFrom: "r" }).errors, []);
});

test("defaults are not written; empty fields fall back to plugin defaults", () => {
  const { options } = save({ source: "inherit", inheritFrom: "r", context: "", output: "", variants: "", image: true }, { modelDefaults: { context: 1, image: false } });
  assert.equal(options.modelDefaults, undefined);
  assert.equal(save({ image: false }, { inheritFrom: "r", models: ["m"] }).options.modelDefaults.image, false);
});

test("providerChoices filters the plugin itself and extra accounts", () => {
  const got = plain(S.providerChoices([{ id: "relay-a", name: "Relay A" }, { id: "codex-relay", name: "Codex Relay" }, { id: "relay-b#2", name: "b" }, { id: "relay-b" }]));
  assert.deepEqual(got, [{ id: "relay-a", name: "Relay A" }, { id: "relay-b", name: "relay-b" }]);
  assert.deepEqual(plain(S.providerChoices({ providers: [{ id: "a", name: "A" }] })), [{ id: "a", name: "A" }]);
  assert.deepEqual(plain(S.providerChoices(null)), []);
});
