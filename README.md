# GitHub Manager

多账号 GitHub 桌面管理工具（Electron + Vue 3），内置 **MCP 服务器**，让 AI 助手也能访问你的 GitHub。

![Electron](https://img.shields.io/badge/Electron-45-47848f) ![Vue](https://img.shields.io/badge/Vue-3-42b883) ![MCP](https://img.shields.io/badge/MCP-server-blue)

## 功能

- **多账号管理** —— Personal Access Token 登录，或浏览器设备授权登录（GitHub Device Flow）；token 经 OS 凭据加密（DPAPI / Keychain / kwallet）保存在本机
- **仓库总览** —— 聚合所有已登录账号可见的全部仓库，按最后推送时间从新到旧排序，支持按账号过滤、按名称搜索、仅看私有
- **Actions 实时状态** —— 列表上每个仓库直接看到最近一次 workflow 运行的状态（成功 / 失败 / 运行中 / 排队），60 秒自动刷新
- **Actions 构建详情** —— 点开仓库查看运行历史；每次运行的 job、每个 step 的实时进度（8 秒轮询）、运行日志（末尾 200 KB）
- **Release 管理** —— 查看仓库 Release 列表（Latest / 预发布 / 草稿标记）、Release 说明（Markdown 渲染）、附件下载
- **MCP 服务器** —— 内置 Model Context Protocol 服务（Streamable HTTP + stdio 桥接），AI 助手可查询你的账号、仓库、Actions 与 Release

## MCP

应用启动后默认在 `http://127.0.0.1:3745/mcp`（实际端口以设置页为准，占用时自动顺延）提供 Streamable HTTP 接入。

stdio 客户端（Claude Desktop 等）使用仓库自带桥接脚本（需先启动本应用）：

```json
{
  "mcpServers": {
    "github-manager": {
      "command": "node",
      "args": ["/path/to/github-manager/extras/mcp-bridge.cjs"]
    }
  }
}
```

提供的工具：

| 工具 | 说明 |
| --- | --- |
| `github_list_accounts` | 列出已登录账号及 token 权限 |
| `github_list_repos` | 全账号仓库列表（含最近 Actions 状态），支持过滤与搜索 |
| `github_list_workflow_runs` | 某仓库最近的 Actions 运行 |
| `github_get_workflow_run` | 某次运行的详情（job + 每步状态） |
| `github_list_releases` | 某仓库的 Release 列表 |
| `github_get_latest_release` | 某仓库最新正式 Release |
| `github_get_release_by_tag` | 按标签取 Release 详情 |

MCP 为只读设计，不会触发任何写操作。

## 开发

```bash
npm install
npm run dev        # 开发模式
npm run typecheck  # 类型检查
npm run dist:win   # Windows 打包（nsis + zip）
npm run dist:all   # 全平台打包
```

> Windows 本地若 electron 二进制未自动下载：`node node_modules/electron/install.js`

## 发布

- 推送到 `main` → GitHub Actions 自动构建 Windows / Linux / macOS 安装包并更新到 [Rolling Release](../../releases/tag/rolling)
- 推送 `v*` 标签 → 发布正式 Release
- 若本次推送忘记升版本号，CI 会自动 patch +1 并推回 main（版本号重复会干扰下游更新判断）

## 安全说明

- token 只保存在本机（Electron `safeStorage`，Windows 下为 DPAPI 加密），不经过任何第三方
- MCP 服务器只监听 `127.0.0.1`，且仅接受本机 Host 头
- 网页登录使用 GitHub 设备授权流程（Device Flow），应用不接触你的 GitHub 密码

## License

MIT
