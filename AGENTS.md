# 项目约定

这是 Codex、Pi 和 Claude Code 共用的项目指令。Codex/Pi 通过 AGENTS.md 加载；Claude Code 通过根 CLAUDE.md 导入本文件。公共规则只在这里维护。

## 开始工作

- 先读 README.md 和 CONTRIBUTING.md；三种 Agent 的入口与验证说明见 docs/agent-development.md。
- 确认当前项目或 worktree 的真实路径和已有改动，保留用户未提交的工作。默认只修改本仓库；其他 checkout、全局 Agent 配置和已安装插件需要用户明确要求。
- 默认使用中文说明结果，保留代码标识符和命令原文。
- 所需工具或技能不可用时，使用仓库文档和官方资料继续可完成的工作，并说明缺少的验证；不依赖某台机器上的全局技能绝对路径。

## 插件开发

- 这是单个 magpie 供应商插件仓库：仓库根目录就是插件包，入口是 package.json 的 main（index.js），运行在 Bun 插件宿主。
- 保持根目录可直接用 `magpie plugin add github:qsoyq/magpie-codex-relay` 安装：不改成 workspace，不依赖构建步骤或 postinstall。
- 优先保持简单：没有需求时不添加构建系统、第三方依赖或自动发布流水线。
- 修改前按功能核对 magpie 官方插件文档（供应商、登录、请求、chat.headers）。
- 完成改动后执行 `npm run check`；提交前按 CONTRIBUTING.md 运行适用的 pre-commit 检查。CI 的 check、pre-commit、gitleaks job 与 .github/settings.yml 中的状态检查名称保持一致。
- 不从入口导出辅助函数；宿主会把每个导出函数当作插件调用。测试需要的函数放在 `_internal` 对象上。
- 插件只改出站请求头，不记录请求头的值、请求体或密钥；debug 日志只记录头名。
- 测试优先使用 README 的临时沙箱和本地抓包服务。未经用户要求，不安装到真实 magpie 配置、不改登录信息、不对真实上游发请求、不发布。
- 新增行为按风险做相应验证；报告单元测试、沙箱加载、沙箱抓包与真实上游请求验证的区别。

## 跨 Agent 兼容与交付

- 本仓库支持用 Codex、Pi、Claude Code 开发；插件运行时对三者的兼容性须逐项验证。不要因公共指令已加载，就宣称插件兼容三种 Agent。
- 请求格式、会话头或客户端配置有变化时，更新 README 的运行时兼容性表：目标 Agent、版本、配置前提、验证步骤和结果；未测的明确标为未验证。
- 结束时说明改了哪些文件、完成哪些检查、还有哪些限制。不要把静态检查通过当成真实请求验证通过。
- 只有用户要求时才执行提交、推送、发布或真实 magpie 安装；已明确授权的操作无需重复询问。
- 不在 CLAUDE.md 或各 Agent 专属目录复制公共规则；如需专属配置，只添加对应工具确实需要的差异。
