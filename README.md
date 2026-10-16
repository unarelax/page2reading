# Page2Reading

**从浏览，到阅读。**

Page2Reading 是一个 Chrome 扩展：点一下图标，把当前正在看的那篇文章导出成可以带走的 Markdown；短文会再生成一份适合打印的 PDF；打开「中英对照」时，用 DeepSeek 把正文逐段翻成自然的中文。

- 形态：Chrome 扩展（本仓库）。另有 [Skill 版](https://github.com/unarelax/page2reading_skill)，给 Claude Code / Codex / Cursor 用
- 产物：`.md`（短文额外有 `.pdf`），按当天日期存进你自己选的本地目录
- 发布方式：为了用 `debugger` 权限生成 PDF，不上 Chrome 网上应用店，只在 GitHub Releases 分发
- 版本：0.2.0 ｜ 介绍页：<https://unarelax.github.io/page2reading_intro/>
- English: [README.en.md](README.en.md)

它只做一件事：把你已经在浏览器里打开的正文，完整、干净地搬进你的目录。除了「中英对照」会把正文发给 `https://api.deepseek.com` 翻译，其他环节不经过任何服务器。

## 快速安装使用

点这里下载最新版：[Page2Reading.zip](https://github.com/unarelax/page2reading/releases/latest/download/Page2Reading.zip)。或到 [Releases](../../releases) 

1. 解压到一个固定不变的文件夹。移动或删掉这个文件夹，已经加载的扩展会失效
2. 打开 `chrome://extensions`，打开右上角「开发者模式」
3. 点「加载已解压的扩展程序」，选中解压出来、里面有 `manifest.json` 的那个文件夹
4. 打开扩展的「设置」页，完成第一次配置

Chrome 可能会提示这个扩展正在调试浏览器。这是为了生成 PDF。扩展只对自己打开的隐藏渲染页调用打印，不会附到你正在看的那一篇上。

### 第一次配置

右键扩展图标选「选项」，或从弹窗点「设置」：

1. **DeepSeek API Key**：需去 [DeepSeek 开放平台](https://platform.deepseek.com/api_keys) 获取。无需翻译只要导出原文可以不填
2. **模型**：默认 `deepseek-flash`（快而省）
3. 点「选择目录」，导出的文件都放到这里
4. 点「保存」

重启浏览器后，如果目录权限失效，设置页会出现「重新授权」，点一下即可。

### 使用

打开一篇文章，等正文已经显示出来，点扩展图标，再点「导出原文」或「导出中英对照」。提示「已加入队列」之后就可以关掉这个页面。写出 Markdown 即完成；短文会再生成 PDF。

你自己在页面上看不到的内容，扩展也抽不出来。登录墙、会员文，先在浏览器里打开到能读，再导出。

## 和别的做法比

| 做法 | 能得到什么 | 局限 |
| --- | --- | --- |
| 浏览器自带的阅读模式 | 去掉广告和侧栏，读着安静一点 | 只负责「读」，不产出文件：不能存档、不能带走、带不去纸质阅读 |
| 把链接丢给 AI，让它翻译或总结 | 快，还能顺手挑重点 | 结果不总是稳定，容易漏段、只给摘要，得盯着它 |
| 微信读书 / 阅读器导入后翻译 | 在手机上、墨水屏上接着读 | 翻译偏机械；而且得先有文件 |
| Page2Reading | 完整正文落进你目录的 `.md` / `.pdf`，中英逐段对照，术语保留 | 要按上面的步骤走开发者模式安装；对照模式需自备 DeepSeek API Key |

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

如果你和我一样，也想打出来进行纸质阅读，短文导出时会带上 PDF。

- 第一页是封面：米色底、墨蓝小标（作者或来源域名 · 导出模式）、36pt 大标题，底部放作者、日期与原文链接
- 正文从第二页开始，页脚底部居中显示「当前页 · 文章标题」，打印机出错时，方便核对；封面页不印页脚
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

## 排版

导出的 PDF 参考了 [Kami](https://github.com/tw93/kami) 的排版设计。Kami（紙）是一套面向专业文档的排版设计系统：米色纸面（parchment `#f5f4ed`）、中日文衬线字体栈、pt 字号阶梯、带黄褐底调的暖灰配单一墨蓝，以及 A4 版心几何（本例取长文档规格：20/22/22/22mm）。感谢作者 [tw93](https://github.com/tw93) 把这套规则以 MIT 许可开源出来。

这里借用的是它的设计规则（米色底、配色、字号、行距、版心留白、封面版式、表格发丝线），并按 Chrome 自己的打印能力重新实现；没有引入 Kami 的 Python 排版脚本、模板文件或校验脚本。Chrome 不像 WeasyPrint 那样什么都支持，所以有几处按它的能力绕行：版心与米色底交给 `@page`，页脚用 `@page` 的边距盒画、并用 `@page:first` 让封面页不印页脚。

字体按「本机先找，找不到就退」的顺序取：`仓耳今楷02 → 思源宋体 → 宋体（Songti SC / STSong / SimSun）`，英文段落用 Charter / Georgia。**插件不打包任何字体文件**：仓耳今楷02 仅个人免费、商用需授权，只有你自己把它装进系统字体时才会被用上，否则正文落到系统宋体。许可与出处细节见 [NOTICE](NOTICE)。

想让导出的文章就是 Kami 那种楷体观感，把仓耳今楷02 装进系统字体即可（macOS：双击 `TsangerJinKai02-W04.ttf` 与 `-W05.ttf`，或复制到 `~/Library/Fonts`）。注意别只放在 `~/.local/share/fonts` 这类 fontconfig 目录里——WeasyPrint 认，Chrome 不认。装好之后正文用 W04、标题用 W05，和 Kami 模板的映射一致；没装的话一切照旧，只是字体退到系统宋体。

## License

[MIT](LICENSE)
