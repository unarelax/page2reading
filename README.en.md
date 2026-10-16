# Page2Reading

**From browsing to reading.**

Page2Reading is a Chrome extension: click the icon and the article you are reading is exported as a Markdown file you can keep, take to an e-reader, or print. Short articles also get a print-ready PDF. In bilingual mode, the body text is translated paragraph by paragraph into natural Chinese through DeepSeek.

Chinese version: [README.md](README.md) ｜ Landing page: <https://unarelax.github.io/page2reading_intro/> ｜ Version: 0.2.0

It does exactly one thing: take the article body already open in your browser and move it, complete and clean, into your own folder. Nothing goes through a server of ours — the only outbound request is the article body sent to `https://api.deepseek.com` when you use bilingual mode.

## Install

Download the latest build: [Page2Reading.zip](https://github.com/unarelax/page2reading/releases/latest/download/Page2Reading.zip) (or pick the same file under [Releases](../../releases)). Do not install zips from unknown sources.

1. Unzip into a folder you will keep. If you move or delete that folder, the loaded extension stops working
2. Open `chrome://extensions` and turn on **Developer mode**
3. Click **Load unpacked** and select the unzipped folder that contains `manifest.json`
4. Open the extension's settings page and finish the first-time setup

Chrome may warn that the extension is debugging your browser. That is how PDF export works: the extension only prints its own hidden render page, never the tab you are reading.

### First-time setup

Right-click the extension icon and choose **Options**, or click **Settings** in the popup:

1. **DeepSeek API key** — needed for bilingual mode only; get one from the [DeepSeek platform](https://platform.deepseek.com/api_keys)
2. **Model** — defaults to `deepseek-flash` (fast and cheap)
3. **Local save folder** — pick the folder where exported files are written
4. Click **Save**

If the folder permission lapses after you restart the browser, the settings page shows a **Re-authorize** button.

### Usage

Open an article, wait until the body text is visible, click the extension icon, then click **Export original** or **Export bilingual**. Once you see "queued", you can close the tab. The export is done when the Markdown file appears; short articles also produce a PDF.

Anything you cannot see on the page cannot be extracted either. For paywalls and member-only articles, open them in the browser until the text is readable, then export.

## How it compares

| Approach | What you get | Where it stops |
| --- | --- | --- |
| The browser's built-in reader mode | A quieter page: ads and sidebars removed | It only helps you *read*; no file is produced, so nothing is archived, carried elsewhere, or printed |
| Pasting the link into a chat AI and asking it to translate or summarize | Fast, and it can pick out the highlights | Results vary from run to run, paragraphs get dropped, and you often get a summary instead of the whole article — you have to watch it |
| Importing into an e-reader app (WeChat Reading and similar) and translating there | Reading continues on a phone or e-ink screen | The translation reads mechanically, and you need a file to import in the first place |
| Page2Reading | The complete body lands in your folder as `.md` / `.pdf`, with paragraph-by-paragraph bilingual text and technical terms kept in English | Installation goes through Developer mode, and bilingual mode needs your own DeepSeek API key |

## What you get

`.md` imports into WeChat Reading or knowledge tools such as Obsidian. `.pdf` opens directly, prints on paper, or imports into an e-reader.

Files are grouped by the day you exported them. Bodies longer than roughly 30,000 characters skip the PDF step, so very long articles may produce Markdown only:

```text
your-folder/
└── 20260919/
    ├── or-article-title.md   ┐ original (PDF for short articles)
    ├── or-article-title.pdf  ┘
    ├── tr-article-title.md   ┐ bilingual (PDF for short articles)
    └── tr-article-title.pdf  ┘
```

Images are not saved to disk; they are fetched over the network when the PDF is generated. If an image fails to load, the file is marked "done (missing images)". Tables in bilingual mode keep only the Chinese table. Long articles are translated section by section, and later sections follow the tone of the first.

## Cost

Bilingual mode sends the extracted body to `https://api.deepseek.com`, billed to your own DeepSeek account. Original-only mode never calls that API.

## Permissions and privacy

There is no server of ours. The API key lives in your local `chrome.storage.local` (unencrypted) and the folder grant lives in IndexedDB; both disappear when you uninstall the extension.

Export reads the full HTML of the current tab, and only handles `http` / `https` pages. Export only pages you opened yourself and are comfortable keeping locally. In bilingual mode the body is also sent to DeepSeek.

Permissions used: `activeTab` and `scripting` (read the current page), `storage`, `offscreen`, `debugger` (prints the extension's own render page only). The only host it can reach is `https://api.deepseek.com/*`.

Because of the `debugger` permission the extension is not published to the Chrome Web Store; it is distributed through GitHub only.

## Build from source

Node.js 20+ required.

```bash
npm install
npm run build            # output in apps/extension/dist/
npm run dev              # rebuild on change
npm run typecheck        # type check
npm run package          # build and zip into releases/
```

Load `apps/extension/dist/` the same way as the released zip. PDF export uses Chrome's own printing; body extraction uses Mozilla Readability and Turndown; translation goes through DeepSeek's OpenAI-compatible endpoint.

## Typography

The exported PDF follows the typesetting design of [Kami](https://github.com/tw93/kami). Kami (紙) is a design system for professional documents: a CJK serif stack, a pt type scale, warm grays with a yellow-brown undertone and a single ink-blue accent, plus A4 page geometry. Thanks to [tw93](https://github.com/tw93) for open-sourcing it under the MIT license.

What this extension borrows are those design rules (palette, type sizes, line height, page margins, hairline table rules), reimplemented against Chrome's own print engine. Kami's Python layout scripts, templates, and verification scripts are not included.

Fonts resolve from your own machine, first match wins: `TsangerJinKai02 → Source Han Serif → Songti SC / STSong / SimSun`, with Charter / Georgia for English runs. **No font files are bundled**: TsangerJinKai02 is free for personal use only and needs a commercial license, so it is used only when you installed it into your system fonts yourself; otherwise the body falls back to your system serif. See [NOTICE](NOTICE) for licensing details.

To get the Kami look — the kai-style serif — install TsangerJinKai02 as a system font (on macOS: double-click `TsangerJinKai02-W04.ttf` and `-W05.ttf`, or copy them into `~/Library/Fonts`). Do not leave them in a fontconfig-only directory such as `~/.local/share/fonts`: WeasyPrint reads it, Chrome does not. Once installed, body text uses W04 and headings W05, matching Kami's own mapping; without it nothing breaks, the text just falls back to your system serif.

## License

[MIT](LICENSE)
