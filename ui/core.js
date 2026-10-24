// 设置面板的纯函数：选项 ⇄ 表单。普通脚本（面板的 CSP 只允许加载插件自己的文件），
// 在面板里挂到 globalThis.CodexRelaySettings，测试里用 node:vm 加载。
(function (root) {
  "use strict";

  const PROVIDER_ID = "codex-relay";
  const DEFAULTS = { image: true };

  const list = (text) =>
    String(text ?? "")
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean);

  function formFromOptions(options) {
    const o = options && typeof options === "object" ? options : {};
    const d = o.modelDefaults && typeof o.modelDefaults === "object" ? o.modelDefaults : {};
    return {
      source: o.inheritFrom ? "inherit" : "manual",
      inheritFrom: typeof o.inheritFrom === "string" ? o.inheritFrom : "",
      baseURL: typeof o.baseURL === "string" ? o.baseURL : "",
      hasApiKey: typeof o.apiKey === "string" && o.apiKey !== "",
      context: d.context === undefined ? "" : String(d.context),
      output: d.output === undefined ? "" : String(d.output),
      variants: Array.isArray(d.variants) ? d.variants.join(", ") : "",
      image: d.image === undefined ? DEFAULTS.image : d.image !== false,
      debug: o.debug === true,
    };
  }

  function positiveInt(value, label, errors) {
    const s = String(value ?? "").trim();
    if (!s) return undefined;
    if (!/^\d+$/.test(s) || Number(s) <= 0) {
      errors.push(label + " 必须是正整数");
      return undefined;
    }
    return Number(s);
  }

  // 按表单生成要保存的选项；表单没有的键（models、stripPrefix、identity、setHeaders 等）原样保留。
  function optionsFromForm(form, existing) {
    const errors = [];
    const out = existing && typeof existing === "object" ? JSON.parse(JSON.stringify(existing)) : {};
    delete out.apiKeyEnv; // 已不支持

    if (form.source === "inherit") {
      const id = String(form.inheritFrom ?? "").trim();
      if (!id) errors.push("请选择要复用的供应商");
      else if (id === PROVIDER_ID) errors.push("不能复用 codex-relay 自己");
      out.inheritFrom = id;
      delete out.baseURL;
    } else {
      delete out.inheritFrom;
      const url = String(form.baseURL ?? "").trim().replace(/\/+$/, "");
      if (url && !/^https?:\/\/[^\s/]+/.test(url)) errors.push("baseURL 必须以 http:// 或 https:// 开头");
      if (url) out.baseURL = url;
      else delete out.baseURL;
    }

    const d = out.modelDefaults && typeof out.modelDefaults === "object" ? out.modelDefaults : {};
    const context = positiveInt(form.context, "上下文长度", errors);
    const output = positiveInt(form.output, "最大输出", errors);
    const variants = list(form.variants);
    for (const [key, value] of [["context", context], ["output", output], ["variants", variants.length ? variants : undefined]]) {
      if (value === undefined) delete d[key];
      else d[key] = value;
    }
    if (form.image === DEFAULTS.image) delete d.image;
    else d.image = !!form.image;
    if (Object.keys(d).length) out.modelDefaults = d;
    else delete out.modelDefaults;

    if (form.debug) out.debug = true;
    else delete out.debug;

    return { options: out, errors };
  }

  // providers:list 的结果 → 可复用的供应商（去掉插件自己）。
  function providerChoices(result) {
    const items = Array.isArray(result) ? result : Array.isArray(result?.providers) ? result.providers : [];
    return items
      .filter((p) => p && typeof p.id === "string" && p.id && p.id !== PROVIDER_ID && !p.id.includes("#"))
      .map((p) => ({ id: p.id, name: typeof p.name === "string" && p.name ? p.name : p.id }));
  }

  root.CodexRelaySettings = { DEFAULTS, PROVIDER_ID, formFromOptions, optionsFromForm, providerChoices };
})(globalThis);
