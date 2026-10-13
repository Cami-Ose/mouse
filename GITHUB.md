# GitHub 仓库信息（About / Topics）

这份文件是给你填 GitHub 仓库设置用的，不是项目文档。
位置：仓库页右上 **⚙ Settings**（或仓库名旁边 **About** 那块铅笔图标）。

---

## About（简介）

**推荐用这句**（60 字符，GitHub 上显示最舒服）：

```
Self-hosted AI chat front end — world-book injection, SSE streaming, SQLite, PWA + Tauri shell
```

备选（更短）：

```
Self-hosted AI chat UI for any OpenAI-compatible API — world book, SSE, PWA
```

备选（中文，如果仓库主要给中文读者看）：

```
自建的 AI 聊天前端：世界书关键词注入、SSE 流式、SQLite 存档，带 PWA 和 Tauri 桌面壳
```

> **Website** 那栏留空就行（没有在跑的演示站）。要填的话填你自己的部署地址。

---

## Topics（标签）

GitHub 的标签规则：全部小写，只能有字母、数字和连字符（`-`），必须以字母或数字开头，每个不超过 50 字符，最多 20 个（见
[GitHub 文档](https://docs.github.com/zh/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/classifying-your-repository-with-topics)）。
下面这 18 个都合规，复制整段贴进 Topics 框（回车分隔）：

```
ai-chat
chat-ui
self-hosted
fastapi
python
sqlite
sse
openai-api
llm
worldbook
roleplay
pwa
tauri
vanilla-js
no-framework
single-user
streaming
prompt-engineering
```

想再加两个的话这几条也贴切：`local-first`、`web-app`、`world-info`、`nostr`（**不**要，跟本项目无关）。

---

## 顺手可做的几个开关

| 位置 | 建议 |
|------|------|
| Settings → General → **Description** | 上面那句 About |
| Settings → General → **Topics** | 上面那 18 个 |
| Settings → General → **Social preview** | 传一张 `frontend/img/mouse-icon-512.png` 或界面截图 |
| Settings → General → **Features → Wikis / Discussions** | 用不上，可以关 |
| Settings → General → **Danger Zone → Change visibility** | 推上去之前是 private 的话，记得切成 public |
| 根目录 **LICENSE** | 还没有。不想费心想就 MIT；想保留权利就「All rights reserved」（不放 LICENSE 文件即是） |
