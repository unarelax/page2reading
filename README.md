# Page2Reading

把 Chrome 当前文章一键导出为适合打印的 Markdown 和 PDF，并登记到飞书多维表格。

提交后本地服务在后台处理，不必盯着翻译或导出。

## 功能

- **原文 PDF**：提取正文，保存 `or-标题.md` + `or-标题.pdf`
- **中英对照 PDF**：保存 `or-标题.md` + `tr-标题.md` + `tr-标题.pdf`
- 图片不单独存盘，生成 PDF 时联网加载
- 标题、作者、日期、链接和来源二维码印在 PDF **文末**
- 成功后把标题、链接、作者、日期、本地路径写入飞书（不写 metadata.json）

## 目录约定

默认写到 `~/Desktop/Page2Reading/`（可用 `.env` 的 `PAGE2READING_STORAGE_ROOT` 覆盖）：

```text
Page2Reading/
└── 20260909/
    ├── or-article-title.md
    ├── or-article-title.pdf
    ├── tr-article-title.md
    └── tr-article-title.pdf
```

## 1. 安装

需要 Node.js 20+，以及本机已安装 Chrome。

```bash
cd /Users/yuri5/Documents/C-Coding/page2reading
cp .env.example .env
npm install
node apps/extension/icons/generate.mjs
npm run build:extension
```

编辑仓库根目录的 `.env`：

```bash
DEEPSEEK_API_KEY=sk-...

FEISHU_APP_ID=
FEISHU_APP_SECRET=
FEISHU_BITABLE_APP_TOKEN=
FEISHU_BITABLE_TABLE_ID=
```

飞书多维表格请把以下字段建成**文本**（不要用附件）：

- 标题
- 原文链接
- 作者
- 文章发布日期
- 收录时间
- PDF 文件
- Markdown 文件

未配置飞书时，本地文件仍会生成，只是跳过台账。同一篇文章的原文模式和对照模式会写入同一条飞书记录（后写覆盖）。

## 2. 启动本地服务

日常用扩展前，本机要有一个 Page2Reading 服务在跑。两种方式：

**临时用（每次开电脑后手动开一次）：**

```bash
npm run serve
```

服务只监听 `127.0.0.1:17321`。鉴权令牌在：

```bash
npm run cli -- token
# 或
cat ~/.page2reading/config.json
```

**开机自启（装一次即可，之后不用每次手动开）：**

```bash
bash scripts/install-launchagent.sh
```

Mac 登录后会自动拉起服务；电脑关机或服务崩溃时 launchd 会再拉起来。日志在 `~/.page2reading/launchd.out.log`。

## 3. 安装 Chrome 扩展

1. 打开 `chrome://extensions`
2. 打开「开发者模式」
3. 「加载已解压的扩展程序」，选 `apps/extension/dist`
4. 扩展选项页填入服务地址和鉴权令牌

文章页点击图标：

- 导出原文 PDF
- 导出中英对照 PDF

提交后即可关闭页面。

## 4. 命令行（不经过扩展）

```bash
# 原文
npm run cli -- process --url 'https://example.com/post' --mode original

# 对照（会调用 DeepSeek）
npm run cli -- process --url 'https://example.com/post' --mode bilingual

# 已保存的 HTML
npm run cli -- process --url 'https://example.com/post' --html ./page.html --mode original

npm run cli -- tasks
```

## 开发

```bash
npm run dev              # 本地服务 watch
npm run build:extension  # 扩展
npm test                 # 抽取 / 去重 / 飞书重试 / inbox 清理
```

设计说明见 [PRODUCT_SPEC.md](PRODUCT_SPEC.md)。翻译规范见 [prompts/tech-translate.md](prompts/tech-translate.md)。PDF 排版复用已验证的 tech-translate 打印样式。

交接材料在 [brain/](brain/)：产品经理看 `pm.html`，使用者看 `user.html`，下一位程序员看 `DEVELOPER.md`。用浏览器直接打开那两个 HTML 即可。
