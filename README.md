**从浏览，到阅读**

## 为什么会有

有很多不错的技术博客，我真的很想阅读，但是打开网页之后，我遇到了这些烦恼：

- 有些文章网页的周围并没有很“整洁”，或者配色没有很“平静”
- 有些文章真的太长了，再回来不知道网页在哪，上次读到什么位置了
- 有些文章真是太棒了！我很怕它消失，我需要存档下来才安心
- 网页诱惑太多，这个文章虽然很不错，但是我想去其他标签页“逛”一下
- 使用翻译软件的结果过于机械生硬，有些文章本来就难读，翻译完了更是雪上加霜

我无法对着浏览器进行长时间和深度的阅读。一开始我是把文章链接发给我的 AI 助手，让它帮我提取并翻译的，但是它的结果并不是每次都很稳定，我需要像看“小孩”一样盯着它。我不断迭代这个产品，做出现在使用起来轻松简单、提示词风格也较为满意的版本，希望能帮到你。

这是它的 Chrome 扩展：打开一篇文章，点一下图标，把正文存成可以带走的 Markdown。短文还会导出 PDF。

## 快速安装使用

点这里下载最新版：[Page2Reading.zip](https://github.com/unarelax/page2reading/releases/latest/download/Page2Reading.zip)。打不开就到 [Releases](../../releases) 里点同一个文件。不要安装来路不明的 zip。

1. 解压到一个固定不变的文件夹。移动或删掉这个文件夹，已经加载的扩展会失效
2. 打开 `chrome://extensions`，打开右上角「开发者模式」
3. 点「加载已解压的扩展程序」，选中解压出来、里面有 `manifest.json` 的那个文件夹
4. 打开扩展的「设置」页，完成第一次配置

Chrome 可能会提示这个扩展正在调试浏览器。这是为了生成 PDF。扩展只对自己打开的隐藏渲染页调用打印，不会附到你正在看的那一篇上。

### 第一次配置

右键扩展图标选「选项」，或从弹窗点「设置」：

1. **DeepSeek API Key**：填你的 key（去 [DeepSeek 开放平台](https://platform.deepseek.com/api_keys) 获取）。只导出原文时可以先不填
2. **模型**：默认 `deepseek-flash`（快而省）
3. **本地保存目录**：点「选择目录」，导出的文件都写到这里
4. 点「保存」

重启浏览器后，如果目录权限失效，设置页会出现「重新授权」，点一下即可。

### 使用

打开一篇文章，等正文已经显示出来，点扩展图标，再点「导出原文」或「导出中英对照」。提示「已加入队列」之后就可以关掉这个页面。写出 Markdown 即完成；短文会再生成 PDF。

你自己在页面上看不到的内容，扩展也抽不出来。登录墙、会员文，先在浏览器里打开到能读，再导出。

## 导出的产物

`.md` 可以导入微信读书，或者放进 Obsidian 这类知识管理软件。
`.pdf` 可以导入微信读书、直接打开，或者纸质打印。

文件按当天日期放在你选的目录里。原文正文超过约 3 万字时不生成 PDF，对照也按原文长度判断，所以长文可能只有 Markdown：

```text
你选的目录/
└── 20260919/
    ├── or-article-title.md   ┐ 原文（短文才有 pdf）
    ├── or-article-title.pdf  ┘
    ├── tr-article-title.md   ┐ 中英对照（短文才有 pdf）
    └── tr-article-title.pdf  ┘
```

图片不单独存盘，生成 PDF 时再联网加载。有图没加载出来时，会标成「完成（缺图）」。对照里的表格只留中文表；长文按章节分段翻译，后面沿用第一段的语气。

## 我是如何使用导出的文章

因为我更喜欢进行纸质阅读，纸质阅读的稀缺让我专注，边读边写让我快乐。现在的信息真是太多了，每一个都想读都怕错过。我现在一般使用工具**一个月打印 1–2 次，然后每天取一小份文章带在身边“食用”**，这样有明确的输入和结束，我会踏实许多。

如果你和我一样，也想打出来进行纸质阅读，短文导出时会带上 PDF。我做了两个细节：

- 右下角是当前页和总页数，万一打印机出错，方便对一下
- 原文链接做成了二维码，放在文末，方便手机扫码打开，不用输入网址

标题、作者、日期和链接也会印在 PDF 上。

## 花费

对照模式会把抽出来的正文发给 `https://api.deepseek.com`，按你的 DeepSeek 账户计费。原文模式不请求这个接口。

## 更多玩法

- **调整打印格式**：想用 A5、B5 打印，可以用这个网址 [https://markdowntoword.io/zh](https://markdowntoword.io/zh)，把 Markdown 转成 Word 再排版。
- **不想充值、不想用 API Key**：可以只导出原文，再导入微信读书，使用微信读书自带的功能翻译。
- **自定义提示词**：目前这套提示词偏向技术文档翻译，你可以直接改 [apps/extension/src/lib/prompts/tech-translate.md](apps/extension/src/lib/prompts/tech-translate.md)。

## 权限与隐私

没有自己的服务器。API Key 存在本机 `chrome.storage.local`（没有加密），保存目录的授权存在 IndexedDB。卸载扩展之后，key 和目录授权都会消失。

导出时会读取当前标签页的整页 HTML，只处理 `http` / `https`。请只导出你自己打开、并且愿意留在本地的页面；对照模式下，这篇正文也会发给 DeepSeek。

用到的权限：`activeTab` 和 `scripting`（读当前页）、`storage`、`offscreen`、`debugger`（只打印扩展自己的渲染页）。能访问的网站只有 `https://api.deepseek.com/*`。

因为要用 `debugger` 权限，这个扩展不上 Chrome 网上应用店，只通过 GitHub 分发。

## 从源码构建

需要 Node.js 20+。

```bash
npm install
npm run build            # 产物在 apps/extension/dist/
```

然后用 `apps/extension/dist/` 按上面的方式加载。

```bash
npm run dev         # 改完自动重新构建
npm run typecheck   # 类型检查
npm run package     # 构建并打成 releases/ 下的 zip
```

PDF 用的是 Chrome 自己的打印。正文抽取用 Mozilla Readability 和 Turndown，翻译走 DeepSeek 的 OpenAI 兼容接口。

## License

[MIT](LICENSE)