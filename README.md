# Page2Reading

Chrome extension that exports the current article as printable Markdown and PDF (original, or bilingual via DeepSeek). No backend and no local Node service — files are written to a folder you pick.

把 Chrome 当前文章一键导出为适合打印的 Markdown 和 PDF，支持原文模式和中英对照模式（对照模式用 DeepSeek 翻译）。**纯浏览器扩展，无需安装 Node.js 或本地服务**，文件直接写入你选定的本地目录。

## 功能

- **原文 PDF**：抽取正文，保存 `or-标题.md` + `or-标题.pdf`
- **中英对照 PDF**：保存 `tr-标题.md` + `tr-标题.pdf`
- 图片不单独存盘，生成 PDF 时联网加载；失败图片会标记为「完成（缺图）」
- 标题、作者、日期、链接和来源二维码印在 PDF 文末
- 重复提交同一篇文章会提示「已导出过」

## 安装

只从本仓库的 GitHub Releases 或自行从源码构建加载。不要安装来路不明的 zip。

Chrome 加载后可能会提示本扩展正在调试浏览器：这是生成 PDF 需要的 `debugger` 权限。扩展**只**对自己创建的隐藏渲染页调用 `Page.printToPDF`，不会附加到你正在阅读的标签页。

### 方式一：下载发行包（推荐，无需 Node）

1. 到 [Releases](../../releases) 下载最新 `Page2Reading-vX.Y.Z.zip`
2. 解压到一个**固定不变**的文件夹（移动/删除该文件夹会让已加载的扩展失效）
3. 打开 `chrome://extensions`，打开右上角「开发者模式」
4. 点「加载已解压的扩展程序」，选中解压出的文件夹（包含 `manifest.json` 的那个）
5. 打开扩展的「设置」页，完成首次配置

### 方式二：从源码构建

```bash
npm install
npm run build            # 产物在 apps/extension/dist/
```

然后用 `apps/extension/dist/` 目录执行上面的第 3、4 步。

## 首次配置

打开扩展设置页（右键扩展图标 →「选项」，或从扩展弹窗点「设置」）：

1. **DeepSeek API Key**：填入你的 key（去 [DeepSeek 开放平台](https://platform.deepseek.com/api_keys) 获取）
2. **模型**：默认 `deepseek-flash`（快而省），也可选 `deepseek-chat`
3. **本地保存目录**：点「选择目录」，选一个文件夹，导出的文件都写到这里
4. 点「保存」

保存目录按日期归档（原文模式产出 `or-*` 一对，对照模式产出 `tr-*` 一对）：

```text
你选的目录/
└── 20260919/
    ├── or-article-title.md   ┐ 原文模式
    ├── or-article-title.pdf  ┘
    ├── tr-article-title.md   ┐ 中英对照模式
    └── tr-article-title.pdf  ┘
```

> 重启浏览器后若目录权限失效，设置页会出现「重新授权」按钮，点一下即可。

## 使用

1. 打开一篇文章
2. 点扩展图标
3. 点「导出原文 PDF」或「导出中英对照 PDF」
4. 提示「已加入队列」后即可关闭页面，后台会自动完成抽取、翻译、生成 PDF 并写入目录

## 权限与隐私

- **没有后端**。DeepSeek API Key 只存在本机 `chrome.storage.local`（未加密）；目录句柄存在 IndexedDB。卸载扩展即失去 key 和目录授权。
- **对照模式**会把抽取后的正文发给 `https://api.deepseek.com`。原文模式不请求该接口。
- 导出时读取**当前标签页**的整页 HTML（仅 `http`/`https`）。请只导出你自己打开、且愿意交给本地磁盘（以及对照模式下交给 DeepSeek）的页面。
- 权限：`activeTab` + `scripting`（读当前页）、`storage`、`offscreen`、`debugger`（只打印扩展自己的渲染页）。主机权限仅 `https://api.deepseek.com/*`。
- 因此不上 Chrome 网上应用店，只通过 GitHub 分发。

## 开发

```bash
npm run dev         # 构建产物监听
npm run build       # 构建扩展到 apps/extension/dist/
npm run typecheck   # 类型检查
npm run package     # 构建并打成 releases/ 下的 zip
```

需要 Node 20+。

## 目录结构

```text
apps/extension/
├── manifest.json          # MV3 清单
├── vite.config.ts         # 纯 Vite 多入口构建
└── src/
    ├── background.ts      # Service Worker：编排、去重、PDF（chrome.debugger）
    ├── offscreen.ts       # 长任务：抽取→翻译→渲染→写盘
    ├── render.ts          # PDF 渲染页
    ├── popup.ts / settings.ts
    └── lib/               # 抽取/翻译/渲染/文件系统/存储等纯模块
```

## 技术说明

- PDF 通过 `chrome.debugger` 的 `Page.printToPDF` 生成（与 Chrome 打印引擎同源）
- 抽取用 Mozilla Readability + Turndown，翻译直接调 DeepSeek OpenAI 兼容接口

## License

[MIT](LICENSE)
