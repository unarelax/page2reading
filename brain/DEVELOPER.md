# Page2Reading 程序员接手手册

把 Chrome 里正在读的技术文章，变成可以打印的 Markdown / PDF，并记到飞书。提交后后台跑，人不用盯着。

先读这份，再翻 [PRODUCT_SPEC.md](../PRODUCT_SPEC.md)。翻译口吻在 [prompts/tech-translate.md](../prompts/tech-translate.md)。

---

## 五分钟跑起来

需要 Node 20+、本机已装 Google Chrome。

```bash
git clone <repo>
cd page2reading
cp .env.example .env          # 至少填 DEEPSEEK_API_KEY
npm install
npm run build:extension
npm run serve
```

另开终端：

```bash
npm run cli -- token          # 把令牌贴进扩展选项页
```

Chrome → `chrome://extensions` → 开发者模式 → 加载 `apps/extension/dist`。选项页填：

- 服务地址：`http://127.0.0.1:17321`
- 鉴权令牌：上一步打印的 token

文章页点扩展图标即可。产物默认写到 `~/Desktop/Page2Reading/`。

不要把 `.env` 提交进 git。

---

## 这是什么架构

三块，缺一不可：

```text
Chrome 扩展          只负责「当前页」
  取 URL / 标题 / 整页 HTML
  选 original | bilingual
        │  HTTP 127.0.0.1 + Bearer token
        ▼
Mac 本地服务         真正干活
  队列 → 抽取 → 翻译 → PDF → 飞书
        │
        ▼
桌面文件夹 + 飞书表    给人看的结果
```

扩展做不了这些事，所以必须有本地服务：

- 不能写到指定桌面目录
- 不能起 Puppeteer 调本机 Chrome 出打印 PDF
- 不能安全地长期存 DeepSeek / 飞书密钥
- MV3 后台随时会被杀掉，扛不住长文翻译

---

## 仓库地图

npm workspaces。

```text
page2reading/
├── apps/extension/          Manifest V3，Vite + @crxjs/vite-plugin
├── apps/local-service/      Fastify 服务 + CLI + 流水线
│   └── tests/               抽取、去重、飞书重试、inbox
├── packages/shared/         任务 / 元数据类型
├── prompts/tech-translate.md
├── scripts/install-launchagent.sh
├── tests/fixtures/sample.html
└── brain/                   你现在在这里
```

本地服务按职责拆：

| 文件 | 职责 |
| --- | --- |
| `src/index.ts` | 起服务 + worker |
| `src/cli.ts` | `serve` / `process` / `tasks` / `token` |
| `src/config.ts` | `.env` + `~/.page2reading/config.json` |
| `src/api/server.ts` | HTTP：提交、查询、重试 |
| `src/queue/worker.ts` | 800ms 轮询；启动时 `recoverInFlight` |
| `src/database/db.ts` | SQLite，`claimNext` 在事务里抢任务 |
| `src/extractor/extract.ts` | Readability + Turndown |
| `src/translator/translate.ts` | DeepSeek，关 thinking，长文按 `##` 切 |
| `src/pdf/buildPdf.ts` + `style.css` | markdown-it → puppeteer-core → PDF |
| `src/feishu/client.ts` | 按「原文链接」查重，没有就新建 |
| `src/pipeline/process.ts` | 串起上面全部，含飞书失败只补同步 |
| `src/storage/paths.ts` | 日期目录、`or-` / `tr-` 文件名、防穿越 |

扩展：

| 文件 | 职责 |
| --- | --- |
| `popup.ts` | 两个按钮，注入页面取 HTML |
| `background.ts` | `POST /api/tasks` |
| `options.ts` | 存 baseUrl + token |

---

## 任务状态机

```text
queued
  → extracting
  → translating      （仅 bilingual）
  → rendering
  → syncing          （配了飞书才走）
  → succeeded | succeeded_with_warnings | failed
```

`claimNext` 把 `queued` 原子更新成 `extracting`，避免两个 worker 抢同一条。默认 `maxConcurrentTasks = 1`。

服务重启时 `recoverInFlight` 把 `extracting|translating|rendering|syncing` 打回 `queued`：

- 若当时是 `syncing`，error 写成「飞书同步中断」
- 其他中断写成 `interrupted`

`process.ts` 开头有断点：

- `files_json` 在
- `error` 含「飞书」
- PDF 和对应 Markdown 文件都还在

则只跑 `syncFeishu`，不再抽取、翻译、渲染。

`POST /api/tasks/:id/retry` **不要清掉 error**，否则断点判断失效，会整篇重翻。

---

## 一篇文章怎么走完

1. Popup 用 `chrome.scripting.executeScript` 抓 `document.documentElement.outerHTML`。
2. `POST /api/tasks`，body：`url, pageTitle, html, mode`。HTML 上限 8MB。
3. URL 会去掉 `utm_*`、`fbclid` 等跟踪参数。同一 `normalizedUrl + mode` 且已 `succeeded` → 返回 `duplicate: true`。要重跑带 `force: true`（扩展目前没有这个按钮，用 CLI 或改请求）。
4. Worker 抽取正文：Readability + 相对链接转绝对 + Turndown(GFM)。
5. 写入 `or-{slug}.md`（YAML frontmatter：title / author / published / source / collected）。
6. bilingual：DeepSeek `deepseek-flash`，`thinking: disabled`。>500 行且有 `##` 则按章节切，带风格锚点。
7. `buildPdf`：frontmatter 的元数据和来源二维码放在 **文末**，不放开头。图片不落盘，渲染时联网。有图加载失败时状态是 `succeeded_with_warnings`（不是普通 succeeded），warnings 里带失败 URL。该状态不参与同 URL 去重，方便重跑。
8. 飞书写入 7 个文本列。没配飞书：本地仍成功，warning「已跳过台账」。

目录：

```text
~/Desktop/Page2Reading/
└── 20260911/          # 本机日历日 YYYYMMDD
    ├── or-Title.md
    ├── or-Title.pdf
    ├── tr-Title.md    # 仅对照模式
    └── tr-Title.pdf
```

没有 `metadata.json`。任务元数据在 `~/.page2reading/page2reading.db`。

---

## 配置从哪来

优先级大致是环境变量 > `~/.page2reading/config.json` > 默认值。

| 项 | 默认 |
| --- | --- |
| `PAGE2READING_STORAGE_ROOT` | `~/Desktop/Page2Reading` |
| `PAGE2READING_PORT` | `17321` |
| `DEEPSEEK_MODEL` | `deepseek-flash`（V4.1 Flash） |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` |
| Chrome | `/Applications/Google Chrome.app/...` |

鉴权令牌首次启动生成 24 字节 hex，写入 `~/.page2reading/config.json`。服务只 bind `127.0.0.1`。CORS 只放行 `chrome-extension://` 和 `http://127.0.0.1`。`/health` 不鉴权。

写文件前 `assertInsideRoot`，禁止写出 `storageRoot`。

---

## 飞书

字段必须一字不差，类型全是**文本**（不要附件）：

标题、原文链接、作者、文章发布日期、收录时间、`PDF 文件`、`Markdown 文件`

后两个中间有空格。主键建议就是「标题」。

同一 URL 原文 / 对照会命中同一条「原文链接」，后写覆盖。搜索失败会打 warn 然后新建。

`FieldNameNotFound` = 列名对不上。可用开放接口 `GET .../tables/{table_id}/fields` 核对。

---

## 翻译实现要点

- 模型默认 `deepseek-flash`，请求带 `extra_body: { thinking: { type: "disabled" } }`。
- 提示词整份塞进 system，不要减料。
- 保护：代码围栏数量、图片 URL 集合、frontmatter。
- 失败重试 4 次，429/5xx 指数退避。4xx 其他直接抛。
- 改口吻：改 `prompts/tech-translate.md`，不必先动代码。

---

## 常见坑

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 扩展提示服务未启动 | 没 `npm run serve`，或端口不是 17321 | 先 curl `http://127.0.0.1:17321/health` |
| 401 | 选项页 token 和 `config.json` 不一致 | `npm run cli -- token` 重贴 |
| `FieldNameNotFound` | 飞书列名不对 | 按上一节建文本列 |
| 重试又整篇翻译 | retry 清了 error，断点失效 | 保持 error 含「飞书」 |
| PDF 缺图 | 远程图超时 / 防盗链 | 状态 `succeeded_with_warnings`，warnings 里有 URL；再点扩展会重新入队 |
| `找不到本机 Chrome` | 没装稳定版或路径不同 | `CHROME_PATH=` |
| `EPERM uv_cwd` | 终端 cwd 被删 | `cd` 回仓库再跑 npm |
| LaunchAgent 读不到 `.env` | plist 的 WorkingDirectory 必须是仓库根 | 看 `scripts/install-launchagent.sh` |
| HTML 把库撑大 | 旧版本把整页写进 SQLite | 已改为 `~/.page2reading/inbox/`，抽完正文即删；启动时会清掉库里残留的大字段。失败任务快照 **7 天后删除** |

---

## 常用命令

```bash
npm run serve
npm run dev
npm run build:extension
npm run cli -- token
npm run cli -- tasks
npm run cli -- process --url 'https://example.com/post' --mode original
npm run cli -- process --url 'https://example.com/post' --html ./page.html --mode bilingual
bash scripts/install-launchagent.sh
npm test
```

样例 HTML：`tests/fixtures/sample.html`。

---

## 建议的下一步（工程）

1. 补 git remote、CI。
2. 飞书 / DeepSeek 失败自动退避。
3. 扩展加「强制重跑」；翻译可换供应商。
4. 分发：打包扩展 + 一键安装，而不是菜单栏 App（产品决定不做 App）。

改行为前先在样例页跑原文 PDF，再跑一篇短对照，确认飞书七列还在。
