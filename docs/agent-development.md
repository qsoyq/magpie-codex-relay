# Codex / Pi / Claude Code 开发说明

本仓库可由 Codex、Pi 或 Claude Code 协助开发。三者使用同一份项目约定、目录结构和检查命令。

## 指令入口

| Agent | 项目入口 | 本仓库的维护方式 |
| --- | --- | --- |
| Codex | 根目录 AGENTS.md | 直接维护公共约定 |
| Pi | 根目录 AGENTS.md | 使用项目上下文文件发现机制，无需额外 .pi 配置 |
| Claude Code | 根目录 CLAUDE.md | 通过 @AGENTS.md 导入公共约定 |

公共约定只修改 [AGENTS.md](../AGENTS.md)。[CLAUDE.md](../CLAUDE.md) 保持为普通文本导入入口，无需符号链接。贡献流程维护在 [CONTRIBUTING.md](../CONTRIBUTING.md)，插件的功能、选项和兼容性记录维护在根 [README](../README.md)。

用户级指令、父目录指令、同目录的 AGENTS.override.md 或自定义启动器可能影响加载结果。若规则没有生效，检查当前工作目录及上下文加载设置。Pi 不应使用禁用上下文发现的 --no-context-files 启动参数。

## 启动

先安装并完成所选 Agent 的认证，再从仓库根目录启动其中一个。以下路径对应本机位置，其他机器替换为实际克隆路径：

```bash
cd /path/to/magpie-codex-relay
codex
```

或：

```bash
cd /path/to/magpie-codex-relay
pi
```

或：

```bash
cd /path/to/magpie-codex-relay
claude
```

使用 worktree 时，从实际 worktree 根目录启动。三种工具不需要同时运行。经由 Paseo 或其他启动器使用时，也把工作目录指向该项目或目标 worktree。

更新指令后，Codex/Claude Code 建议启动新会话；Pi 可使用 /reload。可让 Agent 概述本项目检查命令和写入范围，核对它是否读到了预期规则；Claude Code 也可通过 /memory 查看加载的记忆文件。

## 共同开发流程

1. 阅读 README 和 CONTRIBUTING，确认改动涉及的钩子（config、auth/loader、chat.headers）与宿主环境（Bun 插件宿主）。
2. 修改 index.js，补充 test/ 中的单元测试，同步更新 README 的选项表。
3. 从根目录运行 npm run check；当前检查需要 Node.js 24 或更高版本，不需要安装第三方依赖。
4. 涉及运行行为时，按 README 使用独立 magpie 沙箱和本地抓包服务，并记录加载和出站请求头结果。
5. 汇报变更文件、验证结果及限制。提交、推送或安装到真实配置按用户授权执行。

AGENTS.md 中的约定适用于三种工具，不要求任何特定全局 Skill、MCP 服务或插件。若本机已有 magpie-plugins-manual，可作为补充资料；没有时直接参考 [magpie 官方插件文档](https://usemagpie.ai/docs/zh/plugins)。

模型、登录凭据、个人权限策略和全局 MCP 配置由各 Agent 自身管理。当前无需创建 .codex/、.pi/ 或 .claude/ 项目配置。以后确需增加工具专属设置时，记录用途并避免重复公共规则或提交本机密钥。

## 插件运行时兼容性

“能够使用三种 Agent 开发本仓库”不代表每个插件已在三种 Agent 中运行通过。magpie 插件由相应宿主加载，各客户端的请求协议、工具接入和配置前提可能不同。

README 的运行时兼容性表使用以下格式，并用实际结果替换“未验证”：

| Agent | 版本与配置前提 | 验证步骤 | 结果 |
| --- | --- | --- | --- |
| Codex | 待填写 | 待填写 | 未验证 |
| Pi | 待填写 | 待填写 | 未验证 |
| Claude Code | 待填写 | 待填写 | 未验证 |

结果可填写“通过”“失败”“未验证”或“不适用（附原因）”。供应商/请求插件记录实际协议和请求结果；工具插件记录客户端工具发现与调用结果；客户端专属功能明确支持范围。需要覆盖三者的需求，只有全部适用项验证通过后才能标记完成。

基础检查不会启动这三种 Agent，也不会验证 magpie 实际加载或模型请求；这些结果以 README 兼容性表的记录为准。

## 入口机制参考

- [Codex：AGENTS.md](https://developers.openai.com/codex/guides/agents-md)
- [Pi：项目上下文文件](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/configuration.md#context-files)（本次核对本机 Pi 1.3.0 随附文档）
- [Claude Code：记忆与文件导入](https://code.claude.com/docs/en/memory)
