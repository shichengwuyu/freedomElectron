# 贡献指南

## 提交流程

外部贡献者：

1. **Fork** 本仓库。
2. 从 `main` 切一个分支，名字说清来意：
   ```bat
   git checkout -b fix/canvas-drag-crash
   git checkout -b feature/novel-export
   ```
3. 改完先**自测**（见下）。
4. push 到你的 fork，然后在 GitHub 上向本仓库 `main` 发 **Pull Request**。
5. 维护者 review 后合并。

有写权限的协作者也一样：**切分支开 PR，不要直推 `main`**（便于 review 和回滚）。

> 维护者可在 Settings → Branches 给 `main` 加保护规则（Require a pull request before
> merging），从此任何人包括自己都只能走 PR。

## 本地开发

```bat
npm install
set GG_STORAGE_ROOT=D:\Freedom-Data
set ELECTRON_RUN_AS_NODE=
npx electron .
```

## 合并前必须自检

- `node --check <改动过的 .js>` —— 前端模板是模板字符串，语法错误会直接白屏。
- 如果改了页面，**在应用里点一遍那个页面**，确认没有整页滚动、面板内部能滚。
- `node scripts/build-installer.mjs --check-only` 会跑项目自带的语法自检。
- 改了打包相关文件（`package.json` / `scripts/` / `electron/`）时，本地跑一次 `npm run dist` 确认能出包。

## 约定（重要）

**千万不要提交这些**：

- 任何 API Key / 令牌 / 卡密 / Cookie / Session（`config.json` 里的密钥、`.workbuddy/`、
  `.commandcode/` 都已在 `.gitignore` 中，**不要用 `git add -f` 强推**）。
- 用户的项目数据（图片、视频、小说正文）。
- `node_modules/`、`release*/`、`vendor/ffmpeg/`。

提交前搜一遍，确认干净：

```bat
git grep -n -E "sk-[A-Za-z0-9]{16,}|SecretId|SecretKey|AKID|EpayKey"
```

**前端不要引入构建步骤或 CDN**：零构建（`frontend/vendor/` 本地库 + ES module 直载）
是这个项目的刻意设计，别加 webpack/vite/npm 依赖。

## 代码风格

- 前端模板集中在 `frontend/templates/*.js`，样式在 `frontend/styles/*.css`。
- 页面布局统一使用 `frontend/styles/layout.css` 里的骨架：
  `.page / .page-head / .page-head-copy / .page-body / .panel / .panel-head / .panel-body`。
- **除「项目内的分镜页」外，页面本身不允许滚动**；放不下的内容放进 `.panel-body` 内部滚。
- 统计数字用 `.stat-strip` + `.stat-tile`；分段切换用 `.seg-tabs` 那一套（见 `layout.css`）。
- 图标统一 `<AppIcon name="...">`（Lucide），基准尺寸 16px，不要跟随容器字号。
- 改动尽量小而聚焦：一个 PR 只做一件事。

## 提交信息

一句话说清「改了什么、为什么」，中文或英文都可以。
