import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import plugin, { _internal as I } from "../index.js";

const shape = (headers, options = {}, body = "{}") => I.shapeHeaders(headers, I.settings(options), body);

test("models: upstream ids map to provider model names", () => {
  assert.deepEqual(I.modelEntries(I.settings({})), {});
  const m = I.modelEntries(I.settings({ stripPrefix: ["vendor/"], models: ["vendor/model-a", "codex-relay/model-b"] }));
  assert.deepEqual(Object.keys(m), ["model-a", "model-b"]);
  assert.equal(m["model-a"].id, "vendor/model-a");
  for (const field of ["limit", "reasoning", "variants"]) assert.equal(Object.hasOwn(m["model-a"], field), false);
  const custom = I.modelEntries(I.settings({ stripPrefix: [], models: [{ id: "x/y", key: "y2", variants: [] }, "z"] }));
  assert.deepEqual(Object.keys(custom), ["y2", "z"]);
  assert.equal(custom.y2.reasoning, false);
});

test("model capabilities are opt-in; per-model values override shared values", () => {
  const models = I.modelEntries(I.settings({
    modelDefaults: { context: 64000, output: 8000, variants: ["low", "high"] },
    models: ["a", { id: "b", context: 96000, variants: [] }],
  }));
  assert.deepEqual(models.a.limit, { context: 64000, output: 8000 });
  assert.deepEqual(Object.keys(models.a.variants), ["low", "high"]);
  assert.equal(models.a.reasoning, true);
  assert.deepEqual(models.b.limit, { context: 96000, output: 8000 });
  assert.equal(models.b.reasoning, false);
  const partial = I.modelEntries(I.settings({ models: [{ id: "c", output: 4096 }] })).c;
  assert.deepEqual(partial.limit, { output: 4096 });
  assert.equal(Object.hasOwn(partial, "reasoning"), false);
});

test("non-Codex request: adds Codex identity, session and X-Codex headers", () => {
  const { headers: h, codex } = shape({
    [I.SESSION_HEADER]: "S1",
    "user-agent": "pi (darwin)",
    "x-stainless-os": "MacOS",
    "x-magpie-work-dir": "/private/path",
  });
  assert.equal(codex, false);
  assert.match(h.get("user-agent"), /^codex_cli_rs\//);
  assert.equal(h.get("originator"), "codex_cli_rs");
  assert.equal(h.get("session-id"), "S1");
  assert.equal(h.get("thread-id"), "S1");
  assert.equal(h.get("x-codex-window-id"), "S1:0");
  assert.equal(h.get("x-codex-beta-features"), "remote_compaction_v2");
  assert.ok(!h.has(I.SESSION_HEADER));
  assert.ok(!h.has("x-stainless-os"));
  assert.ok(!h.has("x-magpie-work-dir"));
});

test("session fallbacks: prompt_cache_key, then random", () => {
  assert.equal(shape({}, {}, JSON.stringify({ prompt_cache_key: "P" })).headers.get("session-id"), "P");
  const a = shape({}).headers.get("session-id");
  const b = shape({}).headers.get("session-id");
  assert.ok(a && b && a !== b);
  assert.notEqual(shape({ [I.SESSION_HEADER]: "S" }, { session: "request" }).headers.get("session-id"), "S");
});

test("options can disable or override headers", () => {
  const { headers: h } = shape({}, {
    session: "off",
    codexHeaders: { betaFeatures: "" },
    setHeaders: { "x-extra": "1", originator: null },
  });
  assert.ok(!h.has("session-id"));
  assert.ok(!h.has("x-codex-beta-features"));
  assert.ok(!h.has("originator"));
  assert.equal(h.get("x-extra"), "1");
});

test("Codex request headers are passed through unchanged", () => {
  const { headers: h, codex } = shape({ originator: "codex_cli_rs", "session-id": "C", "user-agent": "codex_cli_rs/1" });
  assert.equal(codex, true);
  assert.equal(h.get("session-id"), "C");
  assert.equal(h.get("user-agent"), "codex_cli_rs/1");
  assert.ok(!h.has("x-codex-beta-features"));
});

test("Codex body: headers restored from client_metadata, body untouched", () => {
  const body = JSON.stringify({
    prompt_cache_key: "P",
    client_metadata: {
      session_id: "CS",
      thread_id: "CT",
      "x-codex-window-id": "CS:0",
      "x-codex-turn-metadata": '{"turn_id":"t1"}',
      "x-codex-installation-id": "I",
    },
  });
  const { headers: h, codex, restored } = shape({ [I.SESSION_HEADER]: "M", "user-agent": "magpie/0.1" }, {}, body);
  assert.equal(codex, true);
  assert.equal(restored, true);
  assert.equal(h.get("session-id"), "CS");
  assert.equal(h.get("thread-id"), "CT");
  assert.equal(h.get("x-client-request-id"), "CS");
  assert.equal(h.get("x-codex-window-id"), "CS:0");
  assert.equal(h.get("x-codex-turn-metadata"), '{"turn_id":"t1"}');
  assert.ok(!h.has("x-codex-installation-id"));
  assert.match(h.get("user-agent"), /^codex_cli_rs\//);
  assert.equal(h.get("originator"), "codex_cli_rs");
  assert.equal(h.get("x-codex-beta-features"), "remote_compaction_v2");
  // client_metadata 没有 Codex 字段时按普通请求处理
  const plain = shape({ [I.SESSION_HEADER]: "M" }, {}, JSON.stringify({ client_metadata: { user: "u" } }));
  assert.equal(plain.restored, false);
  assert.equal(plain.headers.get("session-id"), "M");
  // passthroughCodex: false 时不还原
  assert.equal(shape({ [I.SESSION_HEADER]: "M" }, { passthroughCodex: false }, body).headers.get("session-id"), "M");
});

test("precedence: options before login; '-' login key means unset; apiKeyEnv ignored", async () => {
  const placeholder = { type: "api", key: "-", metadata: { baseURL: "" } };
  assert.deepEqual(await I.resolveTarget(I.settings({ apiKey: "k", baseURL: "https://a/v1/" }), placeholder), { key: "k", baseURL: "https://a/v1" });
  const real = { type: "api", key: "login-key", metadata: { baseURL: "https://b/v1" } };
  assert.deepEqual(await I.resolveTarget(I.settings({ apiKey: "k", baseURL: "https://a/v1" }), real), { key: "k", baseURL: "https://a/v1" });
  assert.deepEqual(await I.resolveTarget(I.settings({}), real), { key: "login-key", baseURL: "https://b/v1" });
  process.env.CODEX_RELAY_TEST_KEY = "env-key";
  assert.equal((await I.resolveTarget(I.settings({ apiKeyEnv: "CODEX_RELAY_TEST_KEY" }), placeholder)).key, undefined);
  delete process.env.CODEX_RELAY_TEST_KEY;
});

test("inheritFrom reads another provider from providers.json", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "codex-relay-"));
  try {
    const providers = { providers: [{ id: "relay", responses: "https://relay.test/v1", key: "test-placeholder" }] };
    await writeFile(path.join(dir, "providers.json"), JSON.stringify(providers));
    assert.deepEqual(await I.resolveTarget(I.settings({ inheritFrom: "relay" }), undefined, dir), { key: "test-placeholder", baseURL: "https://relay.test/v1" });
    // inheritFrom 优先于选项和登录
    const login = { type: "api", key: "login-key", metadata: { baseURL: "https://b/v1" } };
    assert.deepEqual(await I.resolveTarget(I.settings({ inheritFrom: "relay", apiKey: "k", baseURL: "https://a/v1" }), login, dir), { key: "test-placeholder", baseURL: "https://relay.test/v1" });
    await assert.rejects(I.resolveTarget(I.settings({ inheritFrom: "missing" }), undefined, dir), /not found/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("chat.headers passes the magpie session id only for this provider", async () => {
  const hooks = await plugin({}, {});
  const mine = { headers: {} };
  await hooks["chat.headers"]({ model: { providerID: "codex-relay" }, sessionID: "Z" }, mine);
  assert.equal(mine.headers[I.SESSION_HEADER], "Z");
  const other = { headers: {} };
  await hooks["chat.headers"]({ model: { providerID: "other-provider" }, sessionID: "Z" }, other);
  assert.deepEqual(other.headers, {});
});

test("provider.models merges upstream /models with declared models, upstream ids kept", async () => {
  const realFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push({ url: String(url), auth: new Headers(init.headers).get("authorization"), originator: new Headers(init.headers).get("originator") });
    return Response.json({ data: [{ id: "vendor/model-a" }, { id: "vendor/model-b" }, { id: "vendor/model-a" }, {}] });
  };
  try {
    const hooks = await plugin({}, { baseURL: "https://relay.test/v1/", apiKey: "k", models: ["vendor/model-a"], stripPrefix: ["vendor/"] });
    // magpie 传入的已声明模型以上游 id 为键；输出的名字仍按 stripPrefix 计算，选项里的单模型覆盖保留
    const declared = { "vendor/model-a": { id: "vendor/model-a", name: "custom" }, "mine": { id: "mine/x", name: "user entry" } };
    const got = await hooks.provider.models({ models: declared }, { auth: undefined });
    assert.deepEqual(seen, [{ url: "https://relay.test/v1/models", auth: "Bearer k", originator: "codex_cli_rs" }]);
    assert.deepEqual(Object.keys(got).sort(), ["mine", "model-a", "model-b"]);
    assert.equal(got["model-a"].id, "vendor/model-a");
    assert.equal(got.mine.name, "user entry");
    const withObject = await (await plugin({}, { baseURL: "https://relay.test/v1", apiKey: "k", stripPrefix: ["vendor/"], models: [{ id: "vendor/model-a", context: 1000 }] })).provider.models({ models: {} }, {});
    assert.deepEqual(withObject["model-a"].limit, { context: 1000 });
    assert.deepEqual(Object.keys(withObject).sort(), ["model-a", "model-b"]);
    // 不配 stripPrefix 时保持上游 id
    const plain = await (await plugin({}, { baseURL: "https://relay.test/v1", apiKey: "k" })).provider.models({ models: {} }, {});
    assert.deepEqual(Object.keys(plain).sort(), ["vendor/model-a", "vendor/model-b"]);
    assert.equal(plain["vendor/model-a"].id, "vendor/model-a");
    // 取不到时原样返回已声明的模型
    globalThis.fetch = async () => new Response("no", { status: 500 });
    assert.equal(await hooks.provider.models({ models: declared }, {}), declared);
    globalThis.fetch = async () => { throw new Error("network"); };
    assert.equal(await hooks.provider.models({ models: declared }, {}), declared);
    // 没有地址或 key：不请求
    let called = false;
    globalThis.fetch = async () => { called = true; return Response.json({}); };
    assert.equal(await (await plugin({}, {})).provider.models({ models: declared }, {}), declared);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("config declares the provider without overwriting a user entry", async () => {
  const hooks = await plugin({}, { baseURL: "https://relay.test/v1" });
  const cfg = {};
  await hooks.config(cfg);
  assert.equal(cfg.provider["codex-relay"].npm, "@ai-sdk/openai");
  assert.equal(cfg.provider["codex-relay"].api, "https://relay.test/v1");
  const user = { provider: { "codex-relay": { name: "mine" } } };
  await hooks.config(user);
  assert.deepEqual(user.provider["codex-relay"], { name: "mine" });
});
