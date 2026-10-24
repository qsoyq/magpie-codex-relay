// magpie / OpenCode 供应商插件：给发往"只允许 Codex 官方客户端"中转的请求补上 Codex 请求头。
// 入口只默认导出插件函数；宿主会把模块导出的每个函数都当作插件调用。
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const SESSION_HEADER = "x-magpie-codex-relay-session";

const DEFAULTS = {
  providerId: "codex-relay",
  name: "Codex Relay",
  stripPrefix: [],
  models: [],
  modelDefaults: {
    image: true,
  },
  identity: {
    userAgent: "codex_cli_rs/0.161.0",
    originator: "codex_cli_rs",
  },
  codexHeaders: {
    betaFeatures: "remote_compaction_v2",
    windowId: true,
  },
  session: "magpie",
  passthroughCodex: true,
  dropHeaders: ["x-stainless-*", "x-magpie-*"],
  setHeaders: {},
  debug: false,
};

function settings(options) {
  const o = options && typeof options === "object" ? options : {};
  return {
    ...DEFAULTS,
    ...o,
    modelDefaults: { ...DEFAULTS.modelDefaults, ...o.modelDefaults },
    identity: { ...DEFAULTS.identity, ...o.identity },
    codexHeaders: { ...DEFAULTS.codexHeaders, ...o.codexHeaders },
    setHeaders: { ...o.setHeaders },
  };
}

function modelEntries(s) {
  const prefixes = [s.providerId + "/", ...[].concat(s.stripPrefix ?? [])].filter((p) => typeof p === "string" && p);
  const entries = {};
  for (const item of s.models ?? []) {
    const m = typeof item === "string" ? { id: item } : item;
    if (!m || typeof m.id !== "string" || !m.id) continue;
    const prefix = prefixes.find((p) => m.id.startsWith(p));
    const key = m.key ?? (prefix ? m.id.slice(prefix.length) : m.id);
    const d = { ...s.modelDefaults, ...m };
    const limit = {};
    for (const field of ["context", "output"]) {
      if (Number.isSafeInteger(d[field]) && d[field] > 0) limit[field] = d[field];
    }
    const variants = Array.isArray(d.variants) ? d.variants : undefined;
    entries[key] = {
      name: d.name ?? key,
      id: m.id,
      ...(Object.keys(limit).length ? { limit } : {}),
      ...(variants ? {
        reasoning: variants.length > 0,
        variants: Object.fromEntries(variants.map((v) => [v, {}])),
      } : {}),
      tool_call: true,
      modalities: { input: d.image ? ["text", "image"] : ["text"], output: ["text"] },
    };
  }
  return entries;
}

function matches(name, pattern) {
  const p = String(pattern).toLowerCase();
  return p.endsWith("*") ? name.startsWith(p.slice(0, -1)) : name === p;
}

function setIfMissing(headers, name, value) {
  if (value === undefined || value === null || value === false || value === "") return;
  if (!headers.has(name)) headers.set(name, String(value));
}

function parseBody(body) {
  if (typeof body !== "string") return undefined;
  try {
    const value = JSON.parse(body);
    return value && typeof value === "object" ? value : undefined;
  } catch {
    return undefined;
  }
}

function text(value) {
  return typeof value === "string" && value ? value : undefined;
}

// Codex 把自己的会话头同时写进请求体的 client_metadata；magpie 不把 Agent 的原始头传给插件，
// 但会原样保留这个字段，所以用它识别 Codex 请求并还原请求头。
function codexMetadata(body) {
  const meta = body?.client_metadata;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return undefined;
  return Object.keys(meta).some((k) => k.startsWith("x-codex-")) ? meta : undefined;
}

const RESTORED_FROM_METADATA = [
  ["session-id", "session_id"],
  ["thread-id", "thread_id"],
  ["x-client-request-id", "session_id"],
  ["x-codex-window-id", "x-codex-window-id"],
  ["x-codex-turn-metadata", "x-codex-turn-metadata"],
];

function isCodexRequest(headers) {
  if (/codex/i.test(headers.get("originator") ?? "")) return true;
  for (const name of headers.keys()) if (name.startsWith("x-codex-")) return true;
  return false;
}

// 按选项改写出站请求头，从不改请求体。
// 返回改写后的 Headers、是否为 Codex 请求，以及是否从 client_metadata 还原了头。
function shapeHeaders(input, s, body) {
  const headers = new Headers(input);
  const session = headers.get(SESSION_HEADER) || undefined;
  headers.delete(SESSION_HEADER);
  const drop = Array.isArray(s.dropHeaders) ? s.dropHeaders : [];
  for (const name of [...headers.keys()]) if (drop.some((p) => matches(name, p))) headers.delete(name);

  const parsed = parseBody(body);
  const passthrough = s.passthroughCodex !== false;
  // Agent 自己的 Codex 头已经在（magpie 将来若转发原始头）：完全不动。
  const agentHeaders = passthrough && isCodexRequest(headers);
  // 请求体带 Codex 的 client_metadata：请求体不动，按其中的值还原 Codex 原来的请求头。
  const meta = passthrough && !agentHeaders ? codexMetadata(parsed) : undefined;
  if (meta) for (const [name, key] of RESTORED_FROM_METADATA) setIfMissing(headers, name, text(meta[key]));

  if (!agentHeaders) {
    if (s.identity.userAgent) headers.set("user-agent", s.identity.userAgent);
    if (s.identity.originator) headers.set("originator", s.identity.originator);
    if (s.session !== "off") {
      const id = (s.session === "magpie" && (session || text(parsed?.prompt_cache_key))) || crypto.randomUUID();
      setIfMissing(headers, "session-id", id);
      setIfMissing(headers, "thread-id", headers.get("session-id"));
      if (s.codexHeaders.windowId) setIfMissing(headers, "x-codex-window-id", headers.get("session-id") + ":0");
    }
    setIfMissing(headers, "x-codex-beta-features", s.codexHeaders.betaFeatures);
  }
  for (const [name, value] of Object.entries(s.setHeaders)) {
    if (value === null || value === false) headers.delete(name);
    else headers.set(name, String(value));
  }
  return { headers, codex: agentHeaders || Boolean(meta), restored: Boolean(meta) };
}

// 从 magpie 的 providers.json 读取另一个自定义供应商的地址和 key（magpie 内部格式，非公开接口）。
let inheritCache;
async function inherited(directory, id) {
  if (!id || !directory) return undefined;
  const file = path.join(directory, "providers.json");
  const mtime = (await stat(file)).mtimeMs;
  if (inheritCache?.file === file && inheritCache.mtime === mtime && inheritCache.id === id) return inheritCache.value;
  const provider = JSON.parse(await readFile(file, "utf8")).providers?.find((p) => p.id === id);
  if (!provider) throw new Error(`inheritFrom: provider ${id} not found in providers.json`);
  const value = { baseURL: provider.responses || provider.url, key: provider.key };
  inheritCache = { file, mtime, id, value };
  return value;
}

// 取值顺序：inheritFrom 复用的供应商 → 插件选项（设置面板或 magpie plugin options）→ 登录时填的值。
async function resolveTarget(s, auth, directory) {
  const login = auth && auth.type === "api" ? auth : undefined;
  const from = s.inheritFrom ? await inherited(directory, s.inheritFrom) : undefined;
  const loginKey = login?.key && login.key !== "-" ? login.key : undefined;
  const key = from?.key || text(s.apiKey) || loginKey;
  const baseURL = from?.baseURL || text(s.baseURL) || text(login?.metadata?.baseURL);
  return { key, baseURL: baseURL ? String(baseURL).replace(/\/+$/, "") : undefined };
}

// 从上游 /models 取模型 id（OpenAI 格式 {data:[{id}]} 或 id 数组）。失败返回 undefined。
async function fetchUpstreamIds(s, auth, directory) {
  const target = await resolveTarget(s, auth, directory).catch(() => ({}));
  if (!target.baseURL || !target.key) return undefined;
  try {
    const { headers } = shapeHeaders(undefined, s, undefined);
    headers.set("authorization", `Bearer ${target.key}`);
    headers.set("accept", "application/json");
    const res = await fetch(target.baseURL + "/models", { headers, signal: AbortSignal.timeout(15000) });
    if (!res.ok) return undefined;
    const body = await res.json();
    const items = Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : [];
    const ids = items.map((m) => (typeof m === "string" ? m : m?.id)).filter((id) => typeof id === "string" && id);
    return ids.length ? [...new Set(ids)] : undefined;
  } catch {
    return undefined;
  }
}

function errorResponse(status, message) {
  const body = JSON.stringify({ error: { message, type: "invalid_request_error", code: "codex_relay_plugin" } });
  return new Response(body, { status, headers: { "content-type": "application/json" } });
}

export default async function CodexRelay(input, options) {
  const s = settings(options);
  const id = s.providerId;
  const directory = input?.directory;

  return {
    config: async (cfg) => {
      cfg.provider ??= {};
      cfg.provider[id] ??= {
        name: s.name,
        npm: "@ai-sdk/openai",
        api: s.baseURL,
        models: modelEntries(s),
      };
    },

    auth: {
      provider: id,
      methods: [
        {
          type: "api",
          label: "API key",
          placeholder: "sk-…（已在插件选项里配置 key 时填 -）",
          prompts: [
            {
              type: "text",
              key: "baseURL",
              message: "Responses base URL（留空使用插件选项）",
              placeholder: "https://relay.example.com/v1",
            },
          ],
        },
      ],
      loader: async (getAuth) => {
        const auth = await getAuth().catch(() => undefined);
        const first = await resolveTarget(s, auth, directory).catch(() => ({}));
        const loaderBase = first.baseURL ?? "http://codex-relay.invalid";
        return {
          baseURL: loaderBase,
          apiKey: first.key ?? "-",
          fetch: async (url, init = {}) => {
            const target = await resolveTarget(s, auth, directory).catch((e) => ({ error: e }));
            if (target.error) return errorResponse(500, `codex-relay: ${target.error.message}`);
            if (!target.baseURL) return errorResponse(400, "codex-relay: baseURL is not configured");
            if (!target.key) return errorResponse(400, "codex-relay: API key is not configured");
            const href = String(url instanceof Request ? url.url : url);
            const next = href.startsWith(loaderBase) ? target.baseURL + href.slice(loaderBase.length) : href;
            const { headers, codex, restored } = shapeHeaders(init.headers, s, init.body);
            headers.set("authorization", `Bearer ${target.key}`);
            if (s.debug) {
              const names = [...headers.keys()].filter((n) => n !== "authorization").sort().join(",");
              const mode = restored ? "codex (headers from client_metadata)" : codex ? "codex passthrough" : "shaped";
              console.log(`codex-relay: ${mode} headers=${names}`);
            }
            return fetch(next, { ...init, headers });
          },
        };
      },
    },

    // 每个账号调用一次：上游列出的模型并入声明；选开放哪些由供应商页面决定。
    // 取不到时原样返回，magpie 保留原来的列表。模型名默认保持上游 id（可用 stripPrefix 去前缀）。
    provider: {
      id,
      models: async (provider, { auth } = {}) => {
        const declared = provider?.models ?? {};
        const ids = await fetchUpstreamIds(s, auth, directory);
        if (!ids) return declared;
        // 名字统一由插件按选项计算（magpie 传入的已声明模型以上游 id 为键，会丢掉 stripPrefix 的命名）。
        const own = (s.models ?? []).map((m) => (typeof m === "string" ? { id: m } : m)).filter((m) => m && typeof m.id === "string");
        const known = new Set(own.map((m) => m.id));
        const merged = modelEntries({ ...s, models: [...own, ...ids.filter((id) => !known.has(id)).map((id) => ({ id }))] });
        const have = new Set(Object.values(merged).map((m) => m.id));
        // 用户在 config 里自己声明、插件选项里没有的模型继续保留
        const extra = Object.fromEntries(Object.entries(declared).filter(([, m]) => m && !have.has(m.id)));
        return { ...merged, ...extra };
      },
    },

    "chat.headers": async (hookInput, output) => {
      if (hookInput?.model?.providerID !== id || !hookInput.sessionID) return;
      output.headers ??= {};
      output.headers[SESSION_HEADER] = hookInput.sessionID;
    },
  };
}

// 供测试使用的内部函数；对象不是函数，宿主不会把它当作插件。
export const _internal = { settings, modelEntries, shapeHeaders, resolveTarget, fetchUpstreamIds, SESSION_HEADER };
