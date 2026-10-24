// 设置面板：读写插件自己的选项（magpie.options），供应商列表来自 providers:list。
(async () => {
  const S = globalThis.CodexRelaySettings;
  const $ = (id) => document.getElementById(id);
  const status = (text, kind) => {
    $("status").textContent = text;
    $("status").className = kind || "";
  };

  await magpie.ready;
  let current = (await magpie.options.get()) || {};
  const choices = S.providerChoices(await magpie.read("providers:list").catch(() => []));

  function fillProviders(selected) {
    const select = $("inheritFrom");
    select.replaceChildren();
    const ids = choices.map((p) => p.id);
    const all = selected && !ids.includes(selected) ? [{ id: selected, name: selected + "（未找到）" }, ...choices] : choices;
    select.append(new Option(all.length ? "选择供应商…" : "没有可选的供应商", ""));
    for (const p of all) select.append(new Option(p.name === p.id ? p.id : `${p.name}（${p.id}）`, p.id));
    select.value = selected || "";
  }

  function syncSource() {
    const source = document.querySelector('input[name="source"]:checked')?.value || "inherit";
    for (const box of document.querySelectorAll(".indent[data-for]")) {
      const on = box.dataset.for === source;
      box.setAttribute("aria-disabled", on ? "false" : "true");
      for (const el of box.querySelectorAll("input, select")) el.disabled = !on;
    }
  }

  function render(options) {
    const f = S.formFromOptions(options);
    for (const r of document.querySelectorAll('input[name="source"]')) r.checked = r.value === f.source;
    fillProviders(f.inheritFrom);
    $("baseURL").value = f.baseURL;
    $("context").value = f.context;
    $("output").value = f.output;
    $("variants").value = f.variants;
    $("image").checked = f.image;
    $("debug").checked = f.debug;
    $("apiKeyWarn").hidden = !f.hasApiKey;
    syncSource();
  }

  function readForm() {
    return {
      source: document.querySelector('input[name="source"]:checked')?.value || "inherit",
      inheritFrom: $("inheritFrom").value,
      baseURL: $("baseURL").value,
      context: $("context").value,
      output: $("output").value,
      variants: $("variants").value,
      image: $("image").checked,
      debug: $("debug").checked,
    };
  }

  for (const r of document.querySelectorAll('input[name="source"]')) r.addEventListener("change", syncSource);

  $("save").addEventListener("click", async () => {
    const { options, errors } = S.optionsFromForm(readForm(), current);
    const list = $("errors");
    list.replaceChildren(...errors.map((e) => Object.assign(document.createElement("li"), { textContent: e })));
    list.hidden = errors.length === 0;
    if (errors.length) return status("没有保存", "err");
    $("save").disabled = true;
    try {
      current = (await magpie.options.set(options)) || options;
      render(current);
      status("已保存，几秒内生效", "ok");
    } catch (e) {
      status("保存失败：" + (e?.message || e), "err");
    } finally {
      $("save").disabled = false;
    }
  });

  render(current);
})();
