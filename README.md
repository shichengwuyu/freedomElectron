# Freedom

> 小说 → 剧本 → 分镜 → 元素 → 出图 → 视频，一站式短剧流水线（Windows 桌面应用）

Electron 桌面应用 + 本地 Node 后端。前端是**零构建**的 Vue 3 + Element Plus ——
`frontend/vendor/` 里放着本地库，不依赖 CDN、不需要 webpack/vite。

## 功能

- **项目控制台**：项目库（卡片墙）、归档 / 回收站、版本快照、整库备份与项目包导入导出
- **小说工坊**：AI 起名 / 写简介 / 生成封面 / 黄金三章开局 / 逐章续写，伏笔全程记账
- **流水线**：智能分集 → 元素提取 → 批量出图 → 逐集剧本 → 分镜 → 视频（自动拉回）
- **画布**：无限画布，节点自由连接，带素材库 / 时间轴 / 历史
- **工具**：封面生成、一键切割、任务中心（可持久化、重启后继续）
- **助手**：本地聊天（SQLite 落盘）、Agent 全流程控制台
- **多渠道接入**：LibTV / 即梦（CLI、Agent）/ UpDream / Neo / 通用 API（文本、图片、视频）
- **多模型路由**：按任务指定主模型与备用模型，失败自动降级；成本中心按 token / 张 / 秒估算

## 环境要求

| 项 | 要求 |
|---|---|
| 系统 | Windows 10 / 11 x64 |
| Node.js | 18+（仅开发与打包需要；安装包自带运行时） |
| ffmpeg / ffprobe | **未随仓库分发**，见下方「打包」 |

## 开发运行

```bat
npm install

:: 数据目录：项目、图片、视频、config.json、日志都写在这里
set GG_STORAGE_ROOT=D:\Freedom-Data

:: 必须清掉，否则 Electron 会进入纯 Node 模式（无窗口、立刻退出）
set ELECTRON_RUN_AS_NODE=

npx electron .
```

也可以直接双击根目录的 `start-freedom.bat`——注意里面写死了作者本机的路径
（`GG_STORAGE_ROOT=F:\Freedom-Data`、`cd /d F:\Freedom\app_recovered`），先改成你自己的。

> 启动时主进程会在 `127.0.0.1` 的随机端口拉起内置后端服务，再加载界面。

## 打包安装包

完整说明见 [docs/INSTALL.md](docs/INSTALL.md)。简要：

```bat
npm install
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
set ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
npm run dist
```

打包前把 **ffmpeg 放到 `vendor/ffmpeg/`**（`ffmpeg.exe` + `ffprobe.exe`），
它作为 `extraResources` 打进 `resources/ffmpeg`（约 434 MB，直接决定安装包体积）。
该目录被 `.gitignore` 排除——体积超过 GitHub 单文件上限，不进仓库。

## 数据与配置

- 数据默认写到 `GG_STORAGE_ROOT`；未设置时是安装目录同级的 `Freedom-Data`，
  不可写则回退到 `%APPDATA%\Freedom`。
- **首次使用必须进「设置」填模型渠道**（网关地址 / 令牌 / 各渠道 API Key），
  否则只能打开界面、无法真正生成内容。

## 目录结构

| 目录 | 说明 |
|---|---|
| `frontend/` | 零构建前端（Vue 3 + Element Plus）；`vendor/` 为本地库 |
| `frontend/templates/` | 各页面 / 弹窗的模板字符串 |
| `frontend/styles/` | 样式，`layout.css` 是全站布局骨架 |
| `backend/` | 本地 Node 服务（HTTP，仅监听 127.0.0.1） |
| `electron/` | Electron 主进程与 preload |
| `scripts/` | 打包脚本 |
| `docs/` | 文档：安装、架构（画布 / 节点 / 连线 / Agent / 视频合成）、出片配置 |
| `assets/` | 应用图标与素材 |

## 贡献

请走 **fork + PR**，不要直接改 `main`。流程与规范见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

`package.json` 标注为 ISC，但仓库里暂无 `LICENSE` 文件；引入第三方贡献前建议先补上。
