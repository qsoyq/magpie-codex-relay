# magpie-codex-relay

magpie 供应商插件，提供供应商 `codex-relay`：让 pi、Claude Code 等**非 Codex 的 Agent** 也能使用"只允许 Codex 官方客户端"的 Responses 中转。

> 这是在绕过上游的客户端限制，可能违反上游账号的使用条款，上游也可能随时收紧检查。是否使用由你自行判断。

## 概览

有些中转会拒绝非 Codex 客户端，返回 `422 This account only allows Codex official clients`。实测放行条件是请求头**同时**带有：Codex 身份（`Originator: codex_cli_rs` 或 Codex 的 `User-Agent`）、`Session-Id`、`Thread-Id`、至少一个 `X-Codex-*`。只改 UA 不够；供应商的固定请求头也不行，因为会话 id 要按会话变化。

插件在发出请求前按来源改写**请求头**，从不改请求体：

| 请求来源 | 插件的处理 |
| --- | --- |
| Codex | 请求体保持原样。magpie 不把 Codex 原来的请求头传给插件，插件从请求体的 `client_metadata` 还原 `Session-Id`、`Thread-Id`、`X-Client-Request-Id`、`X-Codex-Window-Id`、`X-Codex-Turn-Metadata` |
| 其他 Agent | 补上 Codex 身份，`Session-Id` 和 `Thread-Id` 用 magpie 会话 id（同一段对话不变），并补 `X-Codex-Window-Id` |
| 所有请求 | `User-Agent`、`Originator` 设为 Codex 身份；缺少时补 `X-Codex-Beta-Features`；删掉 `x-magpie-*`（含本机工作目录）和 `x-stainless-*` |

此外：

- **复用已有供应商**：直接读取一个 magpie 自定义供应商的地址和 key，不复制密钥，key 轮换后自动跟随。
- **模型来自上游**：从上游 `/models` 取模型列表（请求同样带 Codex 请求头），在供应商页面勾选要开放的模型。
- **模型能力交给 magpie**：插件不猜上下文长度、最大输出和推理档位，在供应商页面按上游实际能力填写。
- **两种配置方式**：应用里用插件自带的设置面板，终端里用 `magpie plugin options`。

## 使用

### 开始之前

在 magpie 里已经有一个指向该中转的**自定义供应商**（下文叫 `my-relay`），它的 Responses 地址和 key 可用。插件只复用它的地址和 key，不使用它的模型列表。

### 配置步骤

下面每一步都给出应用和终端两种做法，选一种即可。

**1. 安装插件**

```bash
magpie plugin add github:qsoyq/magpie-codex-relay
```

开发时可以安装本地克隆：`magpie plugin add /path/to/magpie-codex-relay`。

**2. 指定上游**

- 应用：**设置 → 插件 → Codex Relay 设置**，选「复用已有供应商」，在下拉框里选 `my-relay`，点「保存」。
- 终端：

  ```bash
  magpie plugin options magpie-codex-relay '{"inheritFrom":"my-relay"}'
  ```

  选项按插件名 `magpie-codex-relay` 设置，不是按供应商 id `codex-relay`。

保存后几秒内生效，不需要重启插件。

**3. 登录一次**

供应商至少要有一个登录的账号才会出现。这里的登录只是占位：

- 应用：**插件 → 已安装**，在 magpie-codex-relay 那一行点「登录」。
- 终端：`magpie plugin login codex-relay`

两种方式都是 baseURL 留空，key 填 `-`。

**4. 选择模型**

插件从上游 `/models` 取模型。第一次取到时**默认全部开放**，只留需要的：

- 应用：**供应商 → Codex Relay → 模型**，勾选后点「保存」。
- 终端：先用 `magpie provider codex-relay` 查看模型名，再执行：

  ```bash
  magpie provider models codex-relay vendor/model-a vendor/model-b
  ```

模型名保持上游 id：上游的 `vendor/model-a` 在 Agent 里写作 `codex-relay/vendor/model-a`，发给上游的仍是 `vendor/model-a`。选择会一直保留，之后刷新模型列表也不会改变。

**5. 设置模型能力**

在 **供应商 → Codex Relay** 里按上游的实际能力填写：

| 能力 | 位置 | 写法 |
| --- | --- | --- |
| 上下文窗口 | 高级 → 上下文窗口 | `512k` 对所有模型生效；`vendor/model-a=512k` 只对单个模型生效 |
| 最大输出 | 高级 → 最大输出 | 写法同上，会作为 `max_output_tokens` 发给上游 |
| 推理档位 | 模型 → 名称与推理档位 | 按模型勾选，没勾选的模型不提供推理档位 |

不设置时，模型没有推理档位，上下文和最大输出由 magpie 自行决定。

**6. 检查**

```bash
magpie models | grep codex-relay
pi -p --provider magpie --model codex-relay/vendor/model-a "say ok"
```

### 加入路由分组

把插件模型加进分组，推理档位写在成员后面：

```bash
magpie group set plan models+=codex-relay/vendor/model-a:xhigh
```

所有 Agent（包括 Codex）都能用插件模型，不需要额外规则。下面两点要注意：

- **不要把原中转的同名模型放在插件后面。** 原中转会对非 Codex 请求返回 422，magpie 把它记为普通失败，**故障切换会停在这里**，不再尝试后面的成员（沙箱实测）。插件替代原中转后，建议在原中转上不再开放这些模型。
- **如果要保留原中转给 Codex 用**，就对除 Codex 以外的 Agent 暂停它：

  ```bash
  magpie group rule add plan pause=my-relay/vendor/model-a:xhigh agents=pi,claude,magpie
  ```

  `pause` 表示对列出的 Agent 不使用这个成员。`agents` 只能正向列出，不能写"除了 codex"。成员带推理档位时，pause 也要写同样的档位。Agent 名用路由日志里的 `agent` 字段（`~/.config/magpie/routing/*.jsonl`）。没列出的 Agent 不受影响。

### 多台机器

- 已安装的插件、插件选项和插件登录都**不随 magpie 同步**，每台机器要做第 1～3 步。这一点是根据 `sync-state.json` 推断的，未在第二台机器上验证。
- 分组和供应商页面的设置会随 magpie 同步。没装插件的机器会跳过 `codex-relay/...` 成员，不会报错（沙箱实测）。

其他机器完成 magpie 配置同步后，在终端执行：

```bash
# 1. 安装插件
magpie plugin add github:qsoyq/magpie-codex-relay

# 2. 指定上游。<relay-provider-id> 是占位符，换成这台机器上已有、指向同一上游的自定义供应商 ID
magpie providers
magpie plugin options magpie-codex-relay '{"inheritFrom":"<relay-provider-id>"}'

# 3. 登录一次：baseURL 留空，key 填 -
magpie plugin login codex-relay

# 4. 核对：模型已出现，分组里的插件成员不再是 not served
magpie models | grep codex-relay
magpie groups | grep codex-relay
```

如果模型没有出现，或分组成员仍显示 `not served`，按「配置步骤」第 4 步选择模型。

### 重新开始

清除插件和登录：

```bash
magpie plugin logout codex-relay
magpie plugin rm magpie-codex-relay
```

清除后，分组里的 `codex-relay/...` 成员仍然保留，显示为 `not served` 并被跳过，不会报错（沙箱实测）。重新安装后这些成员会恢复使用。

供应商页面里的设置（已选模型、上下文窗口、推理档位）在重新安装后是否保留，没有验证，重新安装后到供应商页面核对一下。然后从「配置步骤」第 1 步开始即可。

## 参考

### 上游地址和 key 的来源

地址和 key 分别按下面的顺序，取第一个非空值：

1. `inheritFrom` 指定的自定义供应商：地址用它的 `responses`，没有时用 `url`，key 用它的 key（推荐）；
2. 插件选项 `baseURL` / `apiKey`；
3. 登录时填的 baseURL 和 key。key 填 `-` 视为没填。

`inheritFrom` 读的是 magpie 的内部文件 `providers.json`，不是公开接口，magpie 改了文件格式就可能失效。

不用 `inheritFrom` 时，建议在登录时填 key：它存在 `plugin-auth.json` 里，权限 600。而选项里的 `apiKey` 是明文存在 `plugins.json` 里的，设置面板也能读到，不建议用。设置面板不显示、也不接收 key。

### 选项

除 `inheritFrom` 外通常不需要设置其他选项。设置面板只管上游、模型能力默认值、图片输入和调试日志，其余选项保存时原样保留，要改用终端。

| 选项 | 默认 | 作用 |
| --- | --- | --- |
| `inheritFrom` | 无 | 复用哪个自定义供应商的地址和 key |
| `baseURL` / `apiKey` | 无 | 手动指定上游；`apiKey` 是明文，不推荐 |
| `providerId` / `name` | `codex-relay` / `Codex Relay` | 供应商 id 和显示名 |
| `models` | `[]` | 固定的上游模型 id，也可以写成对象 `{ "id", "key", "name", "context", "output", "variants", "image" }`。会和上游 `/models` 合并，同一 id 以这里为准 |
| `stripPrefix` | `[]` | 从模型名去掉的前缀，例如 `["vendor/"]` 让模型名变成 `codex-relay/model-a` |
| `modelDefaults` | `{ "image": true }` | 所有模型的 `context`、`output`、`variants`、`image`。默认不声明前三项，交给供应商页面 |
| `identity.userAgent` / `identity.originator` | `codex_cli_rs/0.161.0` / `codex_cli_rs` | 发出的 Codex 身份；设为空字符串则不改 |
| `session` | `magpie` | 非 Codex 请求的会话 id 来源：`magpie` 依次用 magpie 会话 id、`prompt_cache_key`、随机值；`request` 每个请求随机生成；`off` 不补 |
| `codexHeaders.betaFeatures` | `remote_compaction_v2` | `X-Codex-Beta-Features` 的值；设为空字符串则不补 |
| `codexHeaders.windowId` | `true` | 非 Codex 请求是否补 `X-Codex-Window-Id: <会话>:0` |
| `passthroughCodex` | `true` | 识别 Codex 请求并从 `client_metadata` 还原请求头；设为 `false` 时所有请求都按非 Codex 处理 |
| `dropHeaders` | `["x-stainless-*", "x-magpie-*"]` | 要删除的请求头，支持 `*` 后缀 |
| `setHeaders` | `{}` | 最后应用的固定头；值为 `null` 表示删除这个头 |
| `debug` | `false` | 在 magpie 日志里记录发出的请求头**名**，不记录值 |

上游要求的四类请求头缺一类就会返回 422，所以对这类中转，不要关掉身份、会话头和 `X-Codex-*`。

### 已知限制

- 识别 Codex 依赖请求体 `client_metadata` 里的 `x-codex-*` 字段，Codex 改了这个格式就会被当成普通请求处理。这时仍能通过上游，但会话头会改用 magpie 的值。
- Codex 原来的 `User-Agent` 和 `Originator` 在进入插件前已被 magpie 丢弃，插件只能填配置里的 Codex 身份。
- 远程压缩等 Codex 专有行为、Claude Code 都没有验证。
- 上游返回 200 后，流中途报 `Response API in-stream error`，是上游自身的偶发问题，magpie 会重试，插件不处理。
- 插件和原中转用同一把 key，但 magpie 把它们当作两个供应商，额度、并发和限流冷却分开计算。

### 运行时兼容性

| Agent | 版本与配置前提 | 验证步骤 | 结果 |
| --- | --- | --- | --- |
| Pi | Pi 1.3.0，`openai-completions` 接 magpie 网关，`sendSessionAffinityHeaders: true`；magpie 0.1.1348–0.1.1418 | 沙箱抓包：直选模型，`-c` 续接第二轮。真实上游：单轮请求，带 `read` 工具读文件后续接第二轮，经分组请求 | 通过：请求头齐全，两轮 `Session-Id` 相同，不带 `x-magpie-*`、`x-stainless-*`。真实上游全部 200、没有 422，工具调用和跨轮上下文正常 |
| Codex | codex-cli 0.161.0，`wire_api = "responses"` 接 magpie 网关；magpie 0.1.1364–0.1.1418 | 沙箱抓包：同一个 Codex 分别直选普通自定义供应商和插件模型，对比上游收到的内容。真实上游：单轮请求，一轮内读文件再写文件，经分组请求 | 通过：请求体除每次会话的 id 外完全一致；会话头和 `X-Codex-*` 与原样一致；只有 UA、Originator 换成配置的 Codex 身份。真实上游全部 200，工具调用结果正确 |
| Claude Code | — | — | 未验证 |
| 模型列表与能力 | magpie 0.1.1413，Pi 1.3.0，codex-cli 0.161.0 | 沙箱：本地服务提供 `/models`，不配 `models`；挑选模型；用 `magpie web` 的供应商页面填上下文、最大输出、推理档位；pi、Codex 读取模型配置并各发一次请求 | 通过：模型默认全部开放，挑选后只开放所选，刷新后保持；pi 配置和 Codex 模型目录拿到供应商页面的值；请求带 `max_output_tokens` 和 `reasoning.effort`。应用桌面窗口未验证 |
| 设置面板 | magpie 0.1.1364 | 用无头 Chrome 加模拟的 `magpie` 桥接测试读取、校验、保存；在真实应用里确认面板显示，并保存一次 | 通过：读取、校验、保存正常；真实应用里显示正常，保存后几秒内生效 |
| 路由与同步 | magpie 0.1.1352–0.1.1418 | 真实分组中 pi、Codex 分别经插件成员请求；用 pause 规则模拟前面的成员不可用；沙箱模拟没装插件的机器收到含插件成员的分组；沙箱 `plugin logout`、`plugin rm` 后查看分组 | 通过：pause 对带档位的成员有效；没装插件或删除插件后，插件成员被跳过、请求切到下一个成员；原中转返回 422 时故障切换停止 |

### 相关文档

[magpie 插件文档](https://usemagpie.ai/docs/zh/plugins)：[供应商与模型](https://usemagpie.ai/docs/zh/plugins#provider)、[登录](https://usemagpie.ai/docs/zh/plugins#signin)、[请求](https://usemagpie.ai/docs/zh/plugins#requests)、[面板](https://usemagpie.ai/docs/zh/plugins#panels)、[测试](https://usemagpie.ai/docs/zh/plugins#test)

## 开发

### 目录与检查

```text
magpie-codex-relay/
├── index.js            # 插件入口：config、auth/loader、provider.models、chat.headers
├── ui/                 # 设置面板（settings 位置）：settings.html/.css/.js，core.js 为可测试的纯函数
├── test/               # node:test 单元测试
├── scripts/check.mjs   # npm run check：清单、入口导出、面板文件、语法、单元测试
├── AGENTS.md / CLAUDE.md / CONTRIBUTING.md / SECURITY.md / docs/
└── .github/、.pre-commit-config.yaml、.gitleaks.toml 等
```

仓库根目录就是插件包，不需要构建步骤，也没有第三方依赖。

- 使用 Node.js 24 或更高版本，执行 `npm run check`。
- 提交前检查见 [CONTRIBUTING.md](CONTRIBUTING.md#提交前检查)，凭据处理见 [SECURITY.md](SECURITY.md)。
- 三种 Agent 共用 [AGENTS.md](AGENTS.md)，说明见 [docs/agent-development.md](docs/agent-development.md)。

`npm run check` 通过，不代表 magpie 能正常加载插件或请求能成功，这两项要在沙箱里验证。

### 沙箱验证

在仓库根目录执行以下命令，配置隔离到临时目录，不影响真实 magpie：

```bash
sandbox_dir=$(mktemp -d)
magpie_sandbox() {
  env HOME="$sandbox_dir" XDG_CONFIG_HOME="$sandbox_dir/.config" XDG_CACHE_HOME="$sandbox_dir/.cache" \
    MAGPIE_ADDR=127.0.0.1:3499 magpie "$@"
}
magpie_sandbox plugin add "$PWD" </dev/null
magpie_sandbox plugin options magpie-codex-relay '{"baseURL":"http://127.0.0.1:18080/v1","apiKey":"sk-test","debug":true}' </dev/null
printf '\n-\n' | magpie_sandbox plugin login codex-relay
magpie_sandbox serve   # 让 pi / codex 连 127.0.0.1:3499，在 18080 用本地抓包服务查看请求头
```

本地抓包服务需要提供 `GET /v1/models`（OpenAI 格式），并对 `POST /v1/responses` 返回一个最小的 Responses SSE 流。

注意：不要在沙箱里设置 `MAGPIE_NO_ACCOUNTS`，否则插件模型不会出现在网关里。
