# Freedom 安装包构建与安装说明

## 产物

| 文件 | 说明 |
|---|---|
| `release/Freedom Setup 1.1.29.exe` | Windows x64 安装程序（NSIS），约 244 MB |
| `release/win-unpacked/` | 免安装绿色版，整个目录拷走直接运行 `Freedom.exe` 即可 |

安装包为**自包含**：Electron 运行时、前后端代码、ffmpeg/ffprobe 均已内置，目标机器无需安装 Node.js 或 ffmpeg。

## 安装步骤

1. 双击 `Freedom Setup 1.1.29.exe`。
2. 若弹出「Windows 已保护你的电脑」（SmartScreen）：点 **更多信息 → 仍要运行**。
   安装包没有做代码签名，出现该提示属正常现象，不是文件损坏。
3. 按向导安装即可，可自选安装目录；默认装到当前用户目录，**不需要管理员权限**。
4. 安装完成后会创建桌面快捷方式和开始菜单项。

## 运行与数据位置

- 启动时主进程会在 `127.0.0.1` 的随机端口拉起内置后端服务，再加载主界面。
- 用户数据（`config.json`、项目、图片、视频、日志）默认写入**安装目录同级**的 `Freedom-Data` 文件夹；
  若该位置不可写（例如装在 `C:\Program Files`），自动回退到 `%APPDATA%\Freedom`。
- 想自定义数据目录：设置环境变量 `GG_STORAGE_ROOT` 指向目标文件夹后启动。
- 卸载程序默认**保留**用户数据，不会误删项目素材。

## 使用前配置

安装后首次使用需要在「设置」里填写模型渠道信息（模型网关地址 / 用户令牌 / 各渠道 API Key），
或通过卡密在网关充值后使用内置渠道；不配置只能打开界面、无法真正生成内容。

## 自行重新打包

```bat
npm install
set "ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/"
set "ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/"
npm run dist
```

注意事项：

- 需要 Node.js 18+。
- 打包前请**完全退出**正在运行的 Freedom / Electron，否则 `win-unpacked` 里的文件会被占用导致打包失败。
- 国内直连 GitHub 下载会卡住或超时，且要**两个镜像都设**才稳定：
  Electron 运行时包认 `ELECTRON_MIRROR`，electron-builder 的 winCodeSign / nsis 工具链认
  `ELECTRON_BUILDER_BINARIES_MIRROR`（实测漏设前者会 `connect ETIMEDOUT` 到 GitHub）。
- `vendor/ffmpeg`（约 434 MB）会作为 `extraResources` 打进 `resources/ffmpeg`，
  它决定了安装包体积；换成 ffmpeg 的 `essentials` 精简版可显著减小安装包。
- 本机 shell 若残留 `ELECTRON_RUN_AS_NODE`，启动 Electron 会进入纯 Node 模式（无窗口、立即退出），
  测试前需 `set "ELECTRON_RUN_AS_NODE="`。
