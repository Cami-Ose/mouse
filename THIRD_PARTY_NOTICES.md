# 第三方素材与许可

本项目自己的代码按根目录的 [MIT License](LICENSE) 发布。仓库里还带着下面这些**别人的东西**，
各有各的许可，请一并遵守。

---

## 1. Material Design Icons (MDI) — 图标

**用在哪**：`frontend/img/mouse-logo.svg`（顶栏那个老鼠图形）是 MDI 的 `rodent` 图标，
只去掉了外层的 `<svg>` 属性、保留了原样的 `<path d="…">`。

**原始出处**：
- 图标集：Material Design Icons / Pictogrammers — <https://pictogrammers.com/library/mdi/>
- 图标名：`rodent`（`mdi:rodent`）
- 仓库：<https://github.com/Templarian/MaterialDesign-SVG>（npm：`@mdi/svg`，包元数据里 `license: Apache-2.0`）

**许可**：**Apache License 2.0** —— <https://www.apache.org/licenses/LICENSE-2.0>

Apache-2.0 要求保留版权与许可声明（第 4 条）。图标集上游对图标本身另有 SIL OFL 1.1 的说法，
两种许可下使用都没问题；**用了就得署名，所以这份文件就是那笔署名**。
Apache-2.0 不要求你把自己的代码也开源成 Apache —— 只要求保留声明并说明你改了什么
（这里只做了删减外层属性）。

```
Material Design Icons (Pictogrammers)
Copyright (c) Pictogrammers
Licensed under the Apache License, Version 2.0
http://www.apache.org/licenses/LICENSE-2.0
```

## 2. Noto Emoji — 字体

**用在哪**：`frontend/fonts/NotoEmoji.ttf`，`style.css` 里给 emoji 用的 `font-family: 'Noto Emoji'`。

**出处**：Google Noto Emoji — <https://github.com/googlefonts/noto-emoji>

**许可**：**SIL Open Font License 1.1 (OFL-1.1)** —— <https://scripts.sil.org/OFL>

OFL 允许随项目一起分发字体文件，保留字体名、不单独售卖字体即可。分发时建议把 OFL 全文
和版权行一起带上（上游仓库里的 `fonts/LICENSE`）。

## 3. Maple Mono — 字体

**用在哪**：`frontend/fonts/MapleMono-Regular.ttf.woff2`、`MapleMono-Bold.ttf.woff2`，
`style.css` 里代码块用的 `font-family: 'Maple Mono'`。

**出处**：Maple Mono — <https://github.com/subframe7536/maple-font>

**许可**：上游仓库声明为 **SIL Open Font License 1.1**。
⚠️ 这一条我是按上游仓库的公开说明写的，**没有在本机逐字核对过许可原文** ——
你要是要正式发布，去上游仓库把 `LICENSE` 抄一份下来放进 `frontend/fonts/` 更稳妥。

## 4. marked — Markdown 渲染

**用在哪**：`frontend/js/marked.min.js`（压缩后的单文件，版本注释在文件头）。

**出处**：marked — <https://github.com/markedjs/marked>

**许可**：**MIT**。压缩文件里保留了 `marked` 的许可头；正式发布时建议把 marked 的
`LICENSE.md` 全文也带上（现在只带了文件头那句）。

## 5. LXGW WenKai Screen — 字体（**没有随仓库分发**）

**用在哪**：`frontend/index.html` 里通过 bootcdn 的 CDN 引入
（`lxgw-wenkai-screen-web`），本地不放字体文件。

**许可**：**SIL Open Font License 1.1**。因为是链到 CDN，不属于本仓库分发的内容；
要改成自带字体的话，记得把 OFL 全文一起带上。

---

## 这几条要不要动？给你三个选择

1. **照现在这样**：`LICENSE`（MIT）+ 这份署名文件。够用，且合规 —— MDI 那句声明留着了。
2. **换掉那个老鼠图标**：如果不想带任何第三方图标，把 `frontend/img/mouse-logo.svg` 换成自绘的，
   这份文件第 1 节就能删掉（配图 `mouse-face.svg` 我没查出公开出处，你若知道来源请补上）。
3. **一行字节都不改上游**：把 `LICENSE` 从 MIT 换成 Apache-2.0 —— **没有必要**，
   用 Apache 的资源不要求你的项目也用 Apache。
