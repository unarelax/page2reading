# Page2Reading 产品需求与技术设计

## 1. 项目目标

Page2Reading 用于把 Chrome 中正在阅读的英文技术文章，一键保存为适合纸质阅读的 Markdown 和 PDF，并将文章信息登记到飞书多维表格。

用户每周或每两周集中打印一次，装订后按天阅读。整个处理过程应在提交文章后自动完成，不需要用户等待翻译、手动复制内容或逐个导出文件。

## 2. 已确认需求

### 2.1 支持的导出模式

#### 原文模式

提取并清理网页正文，保留：

- 标题
- 作者
- 文章发布日期
- 原文链接
- 正文结构
- 代码、列表、表格和引用
- 文章中的远程图片

最终文件：

```text
or-article-title.md
or-article-title.pdf
```

#### 中英对照模式

在原文模式基础上，使用 DeepSeek V4.1 Flash（`deepseek-flash`，关闭 thinking）将英文文章翻译为段落级中英对照版本。

最终文件：

```text
or-article-title.md
tr-article-title.md
tr-article-title.pdf
```

`tr-article-title.pdf` 由对照 Markdown 生成。

### 2.2 图片策略

- 不在本地单独保存图片文件。
- Markdown 中保留图片远程 URL。
- 生成 PDF 时联网加载图片。
- PDF 生成后，已成功加载的图片会包含在 PDF 中，可离线打印。
- 图片加载失败时应重试并记录警告，不能静默生成缺图 PDF。



### 2.3 本地存储

所有文章保存在 Mac 本地。默认根目录为：

```text
~/Desktop/Page2Reading/
```

按收录日期（本地日历日）扁平归档，不再为每篇文章建子目录，也不写 `metadata.json`（台账只在飞书）：

```text
Page2Reading/
└── 20260909/
    ├── or-article-title.md
    ├── or-article-title.pdf
    ├── tr-article-title.md
    └── tr-article-title.pdf
```

- `or-*`：原文 Markdown / PDF
- `tr-*`：中英对照 Markdown / PDF（仅对照模式生成 `tr-*`；对照模式仍会同时留下 `or-*.md`）

PDF 的标题、作者、日期、原文链接和来源二维码放在文末，不放在开头。

### 2.4 飞书多维表格

飞书仅作为成功产物的台账，包含以下字段：

- 标题
- 原文链接
- 作者
- 文章发布日期
- 收录时间
- PDF 文件
- Markdown 文件

其中“PDF 文件”和“Markdown 文件”保存本地绝对路径文本，不上传文件。

Markdown 路径规则：

- 原文模式指向 `or-*.md`
- 中英对照模式指向 `tr-*.md`

由于飞书表中不设置任务状态字段，处理中的状态、失败原因和重试次数由本地任务数据库维护；文章成功生成后才写入飞书。

## 3. 用户流程



### 3.1 首次配置

1. 安装 Chrome 扩展。
2. 安装并启动 Mac 本地服务。
3. 配置 DeepSeek API Key。
4. 配置飞书应用凭证、多维表格 App Token 和 Table ID。
5. 选择本地文章保存根目录。
6. 本地服务测试 Chrome、DeepSeek 和飞书连接。



### 3.2 日常使用

1. 用户在 Chrome 打开一篇文章。
2. 点击 Page2Reading 扩展图标。
3. 选择“导出原文 PDF”或“导出中英对照 PDF”。
4. 扩展将 URL、页面 HTML、页面标题和导出模式提交给本地服务。
5. 扩展立即显示“已加入处理队列”，用户可以关闭网页。
6. 本地服务在后台完成正文提取、翻译、PDF 生成和飞书登记。
7. 扩展可显示最近任务的成功或失败状态。



### 3.3 重复文章

规范化 URL 后进行去重：

- 去除 `utm_*`、`ref` 等常见跟踪参数。
- 去除 URL fragment。
- 保留可能影响正文内容的业务参数。
- 计算规范化 URL 哈希。

如果相同 URL 和相同模式已经成功处理，默认提示用户已存在，并允许手动重新生成。

原文模式和中英对照模式属于两个不同任务，可以分别生成。

## 4. 系统架构

```text
Chrome Extension
    │
    │ HTTP: 127.0.0.1 + 本地鉴权令牌
    ▼
Local Service
    ├── API Server
    ├── Task Queue
    ├── Article Extractor
    ├── Markdown Normalizer
    ├── DeepSeek Translator
    ├── PDF Builder
    ├── Feishu Client
    └── SQLite + Local Files
```



### 4.1 为什么需要本地服务

Chrome 扩展本身不适合承担完整处理任务：

- 扩展不能任意写入用户指定的本地目录。
- DeepSeek 和飞书密钥不能安全地放在扩展代码中。
- 扩展后台可能被 Chrome 暂停，不适合长时间翻译。
- 长文翻译、重试和 PDF 生成需要持久任务队列。
- PDF 脚本需要调用本机 Chrome 可执行文件。

因此扩展只负责采集和提交，本地服务负责所有持久任务。

## 5. 技术选型



### 5.1 Chrome 扩展

- Manifest V3
- TypeScript
- 最小化 Popup UI
- Content Script 获取当前页面 HTML
- Service Worker 调用本地 API
- `host_permissions` 仅开放给 `http://127.0.0.1:<port>/`



### 5.2 本地服务

建议统一使用 Node.js + TypeScript，便于复用现有 `build_pdf.mjs`：

- HTTP：Fastify
- 数据库：SQLite
- 数据库访问：better-sqlite3 或 Drizzle ORM
- 正文提取：Mozilla Readability + JSDOM
- HTML 转 Markdown：Turndown
- Markdown 解析：markdown-it
- API 校验：Zod
- 日志：Pino
- DeepSeek：OpenAI 兼容 API

第一版不需要云服务器，也不需要用户系统。

### 5.3 PDF

参考并复用：

```text
/Users/yuri5/Documents/Obsidian Vault/Clippings/.claude/skills/tech-translate/scripts/build_pdf.mjs
/Users/yuri5/Documents/Obsidian Vault/Clippings/.claude/skills/tech-translate/scripts/style.css
```

现有实现具备：

- Markdown 转 HTML
- YAML frontmatter 中 `title`、`source` 的读取
- 中英文段落自动分色
- A4 打印样式
- 表格、代码、引用和图片样式
- 调用本机 Chrome Headless 生成 PDF



## 6. 模块设计



### 6.1 Chrome 扩展

扩展 Popup 包含：

- 当前页面标题
- “导出原文 PDF”按钮
- “导出中英对照 PDF”按钮
- 提交结果
- 最近任务状态入口

提交内容：

```json
{
  "url": "https://example.com/article",
  "pageTitle": "Article title",
  "html": "<!doctype html>...",
  "mode": "original",
  "capturedAt": "2026-09-10T14:30:00+08:00"
}
```

提交页面 HTML 而不是只提交 URL，可以处理：

- JavaScript 动态渲染文章
- 已登录后才能看到的内容
- 后台请求被反爬阻止的页面
- 用户当前看到的特定页面版本

第一版不处理 iframe 内正文和需要滚动后才加载的未渲染内容。

### 6.2 本地 API

建议接口：

```text
GET  /health
POST /api/tasks
GET  /api/tasks/:id
GET  /api/tasks?limit=20
POST /api/tasks/:id/retry
```

`POST /api/tasks` 成功后立即返回：

```json
{
  "taskId": "uuid",
  "status": "queued"
}
```

API 只监听 `127.0.0.1`，不监听局域网地址。

### 6.3 任务队列

任务状态：

```text
queued
extracting
translating
rendering
syncing
succeeded
succeeded_with_warnings
failed
```

任务至少保存：

- ID
- 原始 URL
- 规范化 URL
- 处理模式
- 页面 HTML
- 当前状态
- 重试次数
- 错误信息
- 输出目录
- 创建、开始和完成时间

第一版使用 SQLite 持久化队列并设置单个 Worker。后续可允许不同文章并发处理，但同一篇长文的分块翻译必须保持串行。

应用重启后：

- `queued` 任务继续执行。
- 非正常退出时停留在处理中状态的任务重新进入队列。
- 已成功任务不重复执行。



### 6.4 正文提取

处理顺序：

1. 用 JSDOM 加载扩展提交的页面 HTML。
2. 将页面 URL 设置为 base URL，确保相对链接可以转为绝对链接。
3. 使用 Mozilla Readability 提取标题、作者、正文和站点信息。
4. 读取页面元数据作为补充：
  - Open Graph
  - Schema.org / JSON-LD
  - `<meta name="author">`
  - `<time datetime>`
5. 将正文 HTML 转换为 Markdown。
6. 清理导航、分享按钮、订阅提示和空节点。
7. 保留代码块、表格、引用、列表、链接和图片。
8. 为 Markdown 添加统一 YAML frontmatter。

frontmatter 建议格式：

```yaml
---
title: "Article title"
author: "Author"
published: "2026-09-08"
source: "https://example.com/article"
collected: "2026-09-10T14:30:00+08:00"
---
```

字段提取失败时：

- 标题优先使用页面标题。
- 作者和文章发布日期允许为空。
- URL 和收录时间不能为空。



### 6.5 原文 Markdown

`original.md` 是两个模式共同的基础产物，必须先成功落盘，再继续后续步骤。

基本要求：

- 正文完整。
- 不包含网站导航、广告和评论。
- 图片 URL 转为绝对 URL。
- 不下载图片。
- 代码内容不被修改。
- 链接地址不被修改。
- 保留合理的 Markdown 层级。



### 6.6 中英对照翻译

模型：

```text
deepseek-flash
```

对应 DeepSeek-V4.1-Flash。请求时关闭 thinking，保证批量翻译速度和费用。可用环境变量 `DEEPSEEK_MODEL` 覆盖。

接口使用 DeepSeek 官方 OpenAI 兼容 API。API Key 通过环境变量提供：

```text
DEEPSEEK_API_KEY
```

现有 `tech-translate` Skill 中的“翻译提示词”作为翻译规范来源，但应用不能依赖 Agent 的 Read、Write 和 Edit 操作。需要将其实现为确定性的程序流程：

1. 解析 Markdown 结构。
2. 保护 frontmatter、代码块、行内代码、链接 URL 和图片标签。
3. 短文一次翻译。
4. 长文按 `##` 章节切分，每段包含 1～3 个完整章节。
5. 第一段完成后提取三个风格锚点。
6. 后续分段携带完整翻译规范和风格锚点，顺序翻译。
7. 对 API 超时、限流和临时错误进行指数退避重试。
8. 校验段落结构和受保护内容。
9. 合并并写入 `bilingual.md`。

必须保留现有翻译规则：

- 一段英文紧跟一段中文。
- 不按句子拆分对照。
- 图片原样保留在对应译文下方。
- 链接只翻译显示文本。
- 代码、命令和路径保持不变。
- 表格只输出一张中文表格。
- YAML frontmatter 保留。
- 翻译使用面向普通技术学习者的口语讲解风。

翻译结果校验至少包括：

- 输出非空且长度合理。
- frontmatter 存在。
- 代码块数量与原文一致。
- 图片 URL 集合与原文一致。
- 外部链接 URL 未被修改。
- 不存在截断标记或未闭合代码块。

若翻译失败，不生成双语 PDF，也不写飞书；保留 `or-*.md` 和本地错误记录，允许重试。

### 6.7 PDF 生成

原文模式：

```text
or-article-title.md → or-article-title.pdf
```

中英对照模式：

```text
tr-article-title.md → tr-article-title.pdf
```

复用现有脚本时需要进行以下改造：

1. 不硬编码唯一 Chrome 路径，增加自动检测和配置项。
2. 在写 PDF 前确保输出目录存在。
3. 增加原文和中英对照两种样式模式。
4. 扩展 frontmatter 读取，支持作者和发布日期。
5. 不只依赖固定的 8 秒虚拟时间，增加图片加载完成检测。
6. 记录加载失败的图片 URL。
7. 生成后校验 PDF 文件存在且大小大于最低阈值。
8. 使用临时文件生成，成功后原子重命名为正式 PDF。

打印要求：

- A4。
- 正文清晰、适合长时间纸质阅读。
- 标题避免与下一段跨页分离。
- 代码块和图片尽量避免内部跨页。
- 图片最大宽度不超过正文。
- 链接不显示网页蓝色。
- 文末展示标题、作者、发布日期、原文 URL，以及指向原文的二维码。



### 6.8 图片加载

图片不保存为独立文件，但 PDF 渲染必须执行：

1. 打开临时 HTML。
2. 等待页面基础加载完成。
3. 检查所有 `<img>` 的 `complete` 和 `naturalWidth`。
4. 对失败图片等待并重试。
5. 达到超时时间后继续生成 PDF，但把失败图片记录为任务警告。

如果存在失败图片，任务标记为 `succeeded_with_warnings`（不是普通 `succeeded`），详情里展示失败 URL。该状态不参与同 URL 去重，便于打印前发现并重跑。

### 6.9 飞书同步

处理成功后创建或更新飞书记录。

字段映射：


| 飞书字段        | 数据来源                              |
| ----------- | --------------------------------- |
| 标题          | `metadata.title`                  |
| 原文链接        | `metadata.sourceUrl`              |
| 作者          | `metadata.author`                 |
| 文章发布日期      | `metadata.publishedAt`            |
| 收录时间        | `metadata.collectedAt`            |
| PDF 文件      | `metadata.files.pdf`              |
| Markdown 文件 | 原文模式使用 `or-*.md`，翻译模式使用 `tr-*.md` |


飞书凭证仅保存在本地服务环境变量或本地配置中：

```text
FEISHU_APP_ID
FEISHU_APP_SECRET
FEISHU_BITABLE_APP_TOKEN
FEISHU_BITABLE_TABLE_ID
```

同步失败时：

- 不删除已经生成的本地文件。
- 任务进入失败或“待同步”状态。
- 重试时只执行飞书同步，不重复翻译和生成 PDF。



## 7. 元数据设计

不再写本地 `metadata.json`。任务元数据存在 SQLite；成功后的台账只写飞书。Markdown YAML frontmatter 仍保留 title/author/published/source/collected，供 PDF 文末和飞书重试用。

飞书「PDF 文件」「Markdown 文件」示例：

```text
/Users/yuri5/Desktop/Page2Reading/20260909/tr-article-title.pdf
/Users/yuri5/Desktop/Page2Reading/20260909/tr-article-title.md
```

原文模式下 Markdown 路径为 `or-*.md`。

所有时间使用带时区的 ISO 8601 格式。文章发布日期若只能提取到日期，则保存 `YYYY-MM-DD`。

## 8. 安全设计

- DeepSeek 和飞书密钥不进入 Chrome 扩展。
- 本地 API 仅监听 `127.0.0.1`。
- 扩展与本地服务共享安装时生成的随机鉴权令牌。
- 本地服务只接受指定 Chrome 扩展 Origin 的请求。
- 提交 HTML 设置合理的大小上限。
- 文件名必须清理 `/`、`\`、`..` 和控制字符，防止路径穿越。
- 所有文件只能写入配置的 Page2Reading 根目录。
- 日志不得输出 API Key、飞书 Secret 或完整鉴权令牌。
- 渲染文章 HTML 时不执行原网页脚本。



## 9. 配置设计

本地配置至少包括：

```json
{
  "storageRoot": "/Users/yuri5/Desktop/Page2Reading",
  "serverPort": 17321,
  "chromePath": "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "maxConcurrentTasks": 1,
  "imageLoadTimeoutMs": 15000
}
```

密钥不写入可提交到 Git 的普通配置文件，优先使用 macOS Keychain；MVP 可使用权限受限且被 Git 忽略的 `.env`。

## 10. 建议项目结构

```text
page2reading/
├── apps/
│   ├── extension/
│   │   ├── src/
│   │   │   ├── popup/
│   │   │   ├── background/
│   │   │   └── content/
│   │   └── manifest.json
│   └── local-service/
│       └── src/
│           ├── api/
│           ├── queue/
│           ├── extractor/
│           ├── translator/
│           ├── pdf/
│           ├── feishu/
│           ├── storage/
│           └── database/
├── packages/
│   └── shared/
├── prompts/
│   └── tech-translate.md
├── tests/
│   ├── fixtures/
│   └── integration/
├── docs/
├── package.json
└── PRODUCT_SPEC.md
```



## 11. 实现计划



### 阶段一：本地流水线程序化

目标：将已验证的 Skill 流程改造成无需 Agent 参与的命令行程序。

工作项：

- 初始化 Node.js + TypeScript 项目。
- 引入并整理现有 PDF 脚本和 CSS。
- 实现 HTML 正文提取。
- 生成标准化 `original.md` 和 `metadata.json`。
- 实现原文 PDF。
- 接入 `deepseek-flash`（DeepSeek-V4.1-Flash，关闭 thinking）。
- 实现短文翻译和 `bilingual.md`。
- 实现双语 PDF。
- 实现长文按章节串行翻译和重试。

验收：

- 对已验证过的样例文章，原文和双语 PDF 效果不低于现有 Skill。
- 两种模式均保留原文 Markdown。
- 远程图片正常进入 PDF。
- 关闭终端前的单次命令可完整处理一篇文章。



### 阶段二：本地任务服务

目标：提交后无人值守执行。

工作项：

- Fastify 本地 API。
- SQLite 任务表。
- 持久任务 Worker。
- 去重、失败重试和断点恢复。
- 配置管理和结构化日志。
- macOS LaunchAgent 开机启动。

验收：

- API 提交后立即返回任务 ID。
- 页面关闭后任务继续运行。
- 服务重启后未完成任务能够恢复。
- 重复 URL 不会被无提示地重复处理。



### 阶段三：Chrome 扩展

目标：文章页面一键提交。

工作项：

- Manifest V3 扩展。
- Popup 两个导出按钮。
- 采集当前 URL、标题和页面 HTML。
- 调用本地 API。
- 展示提交结果和最近任务状态。
- 处理本地服务未启动的情况。

验收：

- 在普通博客、动态渲染博客上均能提交。
- 点击后不需要保持 Popup 或文章页面打开。
- 密钥不出现在扩展存储和网络请求中。



### 阶段四：飞书台账

目标：自动登记成功产物。

工作项：

- 飞书应用鉴权。
- 多维表格字段映射。
- 根据规范化 URL 和模式创建或更新记录。
- 飞书失败单独重试。

验收：

- 本地文件全部成功后，飞书出现完整记录。
- 路径与实际文件一致。
- 飞书故障不会导致重复翻译。



### 阶段五：质量与长期使用

工作项：

- 增加正文提取样例库。
- 增加 Markdown 结构保护测试。
- 增加 PDF 图片加载检测。
- 增加日志清理策略。
- 增加本地服务状态页或扩展任务列表。
- 为每周批量打印预留按收录时间筛选的能力。



## 12. 测试计划



### 正文提取

- 传统静态博客。
- JavaScript 渲染博客。
- 含代码块、表格、引用和多级列表的文章。
- 含相对图片 URL 的文章。
- 缺少作者或发布日期的文章。



### 翻译

- 短文章。
- 超过 500 行的长文章。
- 含大量代码和行内代码的文章。
- 含 Markdown 表格和 HTML 表格的文章。
- 含特殊 Unicode 字符的标题。
- API 超时、限流和输出截断。



### PDF

- 原文 PDF。
- 中英对照 PDF。
- 多张远程图片。
- 图片加载失败。
- 超宽代码块和表格。
- 中英文混合标题。



### 飞书

- 新建记录。
- 重试同步。
- 相同 URL 的两种模式。
- 本地路径含空格和 Unicode 字符。



## 13. MVP 范围外

第一版不包含：

- 云端部署。
- 多用户账号。
- 手机端。
- 自动 RSS 订阅。
- PDF 合并和自动打印。
- 图片本地归档。
- OCR 和扫描件处理。
- 在线文章编辑器。
- 飞书文件上传和在线预览。
- Safari 扩展。



## 14. 完成标准

MVP 完成需同时满足：

1. 在 Chrome 文章页面最多点击两次即可提交指定模式。
2. 用户提交后不需要等待在页面上。
3. 原文模式生成 `or-*.md` 和 `or-*.pdf`。
4. 翻译模式生成 `or-*.md`、`tr-*.md` 和 `tr-*.pdf`。
5. 图片不单独保存，但正常显示在 PDF 中。
6. DeepSeek V4.1 Flash 翻译符合现有 `tech-translate` 风格要求。
7. 所有文件保存在配置的 Mac 本地目录。
8. 成功后自动写入飞书多维表格。
9. 任务失败可查看原因并重试，不需要重新手动复制文章。

