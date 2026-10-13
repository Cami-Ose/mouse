<div align="center">

<img src="frontend/img/mouse-logo.svg" width="72" height="72" alt="Mouse">

# 🐭 Mouse — Our Rat's Nest

A self-hosted AI chat front end: world-book keyword injection · SSE streaming · SQLite history · PWA + Tauri shell

[中文说明](README.md) · [About / topics text](GITHUB.md) · [License & third-party assets](THIRD_PARTY_NOTICES.md)

</div>

**A memorial project**: this repository commemorates the retirement of GPT-5-5. The code is kept
here as an archive — it used to be a rat living on the roof, who liked reasoning things out
together with people.

- FastAPI + SQLite backend, framework-free HTML/CSS/JS front end, served by one process
- Desktop gets a persistent sidebar, phone gets a drawer; installable as a PWA, plus a Tauri v2 shell

---

## Contents

- [1. What it is](#1-what-it-is) — [what one chat turn looks like](#what-one-chat-turn-looks-like)
- [2. Stack](#2-stack)
- [3. Layout](#3-layout) — [running it locally](#3b-running-it-locally)
- [4. Database (SQLite)](#4-database-sqlite) — conversations / messages / world_entries / api_providers
- [5. HTTP API](#5-http-api) — providers / conversations / chat SSE / world book
- [6. How it works](#6-how-it-works) — [a chat turn](#61-a-chat-turn) · [matching](#62-matching-algorithm) · [context window](#63-context-window)
- [7. Front end](#7-front-end) — [layout](#71-layout) · [views](#72-views) · [theme](#73-theme)
- [8. Deployment](#8-deployment) — [port](#81-port) · [nginx](#82-nginx) · [deploy.sh](#83-deploysh)
- [9. What is implemented](#9-what-is-implemented)


## 1. What it is

A small AI chat front end for any OpenAI-compatible API, with automatic keyword-triggered
world info injection and persisted chat history.

| Users | single |
| Backend | Python FastAPI (runs locally or on a server) |
| Frontend | plain HTML/CSS/JS SPA (served by the same process as the backend) |
| Storage | SQLite |
| Deployment | nginx reverse proxy + certbot SSL (or just run it locally) |
| Desktop | optional Tauri v2 shell, see `tauri_deploy_plan.md` |

### What one chat turn looks like

```
Browser (the SPA; also the PWA, also the WebView inside the desktop shell)
   |
   |  (1) POST /api/chat/{id}
   v
FastAPI (one process: both the API and the static files)
   |
   +--> (2) match world entries -> build the system prompt
   +--> (3) store the user message  -->  SQLite (data/mouse.db)
   v
any OpenAI-compatible endpoint (several providers, switch the default anytime)
   |
   |  (4) tokens stream back: token / tool_call / worldbook_injected / done
   v
Browser: bubbles grow one token at a time; at the end the reply goes into `messages`
```

The upstream is swappable: any OpenAI-compatible endpoint (base_url + api_key + model name) works —
add it under "API providers" and switch the default at runtime. Tool calls, images and attachments
travel on the same stream; the event names live in the SSE `type` field.

---

## 2. Stack

| Layer | Tech |
|-------|------|
| Backend | FastAPI + uvicorn |
| API calls | httpx (async, streaming) |
| Database | SQLite3 (stdlib) |
| Frontend | plain HTML / CSS / JS, no framework |
| Streaming | Server-Sent Events (SSE) |
| Reverse proxy | nginx |
| TLS | Let's Encrypt (certbot) |

---

## 3. Layout

```
mouse/
├── backend/
│   ├── main.py                  # FastAPI entry: routers + static files
│   ├── config.py                # constants (port, paths, context limits)
│   ├── database.py              # SQLite setup + migrations
│   ├── models.py                # Pydantic models
│   │
│   ├── routers/
│   │   ├── __init__.py
│   │   ├── chat.py              # conversations CRUD + chat SSE + folders + uploads
│   │   ├── worldbook.py         # world entries CRUD + match test
│   │   ├── providers.py         # API provider (line) CRUD
│   │   ├── import_gpt.py        # import GPT chat exports
│   │   ├── library.py           # cheese library + treasure box
│   │   ├── stats.py             # usage stats
│   │   └── workspace.py         # workspace (file read/write, shell, pin board)
│   │
│   └── services/
│       ├── __init__.py
│       ├── llm_service.py       # OpenAI-compatible client + stream parsing
│       ├── worldbook_match.py   # two-tier keyword matching + injection
│       ├── worldbook_tools.py   # world entry tools for the model (incl. persona)
│       ├── chat_history.py      # history assembly + context window
│       ├── chat.py              # auto-summary and friends
│       ├── library_tools.py     # library tools + read-only treasure box tool
│       ├── file_tools.py        # tools over uploaded files
│       ├── web_tools.py         # fetch / search tools
│       └── workspace_tools.py   # workspace tools (sandboxed) + pin board
│
├── frontend/
│   ├── index.html               # SPA shell
│   ├── manifest.json / sw.js    # PWA
│   ├── css/
│   │   └── style.css            # light grey responsive theme
│   ├── fonts/                   # bundled fonts (mono + emoji)
│   ├── img/                     # logo and icons
│   ├── uploads/                 # runtime uploads (images / files)
│   └── js/
│       ├── app.js               # bootstrap + view routing
│       ├── api.js               # fetch + SSE wrapper
│       ├── chat.js              # chat UI
│       ├── worldbook.js         # world entry ("paper slips") UI
│       ├── providers.js         # API provider settings
│       ├── library.js           # library + treasure box
│       ├── dashboard.js         # console / stats
│       ├── import_gpt.js        # chat import
│       ├── workspace.js         # workspace (not mounted — see below)
│       └── marked.min.js        # Markdown rendering
│
├── src-tauri/                   # Tauri v2 desktop shell (pure WebView, no sidecar)
│
├── data/                        # runtime data (SQLite lives here; tables auto-created)
│   └── mouse.db
│
├── requirements.txt
├── nginx.conf                   # example nginx site config
└── deploy.sh                    # deployment script
```

---

## 3b. Running it locally

```bash
python3 -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn backend.main:app --host 127.0.0.1 --port 8086
```

Open `http://127.0.0.1:8086` and fill in your OpenAI-compatible endpoint on the "API providers"
page (base_url + api_key + model name). The database is created on first start at
`data/mouse.db`; the world book starts empty — add your own entries.

<details>
<summary>How to tell it actually started (click)</summary>

One line of startup output, then it works if the browser opens:

```
INFO:     Started server process [12345]
INFO:     Waiting for application startup.
INFO:     Application startup complete.
INFO:     Uvicorn running on http://127.0.0.1:8086 (Press CTRL+C to quit)
INFO:     127.0.0.1:60174 - "GET / HTTP/1.1" 200 OK
INFO:     127.0.0.1:60174 - "GET /api/world-entries HTTP/1.1" 200 OK
```

- No `Application startup complete.` usually means `data/` is not writable (database creation failed)
- Page opens but stays blank: check the browser console, and make sure the whole `frontend/` tree is there
- To use another port, change `PORT` in `config.py` or pass `--port`
- `/favicon.ico` falls back to `index.html` through the SPA handler (browsers ask for it; harmless —
  the page already points `<link rel="icon">` at `img/mouse-logo.svg`)

</details>

How the world book engine works (independent of whatever entries you write):

- **Exact hit** → injected in full into the system prompt: keyword match / `/regex/` /
  two or more input tokens found in the entry title+summary.
- **Possible link** → only the title + summary are handed over as a hint (at most 5 entries):
  one or more token hits / two consecutive characters of the title appearing in the message /
  another entry in the same `category` already hit exactly.
- An entry is **not injected twice within the same context stretch** (the dedup set
  `_wb_injected[cid]` lives in memory; it is cleared when the service restarts or after an
  auto-summary compression, so the same entry will be injected again later). Entries with
  `type='persona'` go through the same exact-match path as everything else — the UI just labels
  them "root entry".
- Entry fields: `keywords` (JSON array, `/regex/` supported), `priority` (higher goes first),
  `category` / `subcategory`.

There are two layers of system prompt: the **global persona** (`global_config.persona`, set in
the UI; when empty, `DEFAULT_SYSTEM_PROMPT` from `models.py` is used — a neutral default that
carries no character setup at all, just "answer honestly, don't rewrite the user's words"), and
the **per-conversation `system_prompt`**. One implementation detail worth knowing: the API fills
that field with the *current* global persona, while an actual message uses the chain
"conversation `system_prompt` → global persona → neutral default". So the prompt you see on a
conversation is a **snapshot taken when the conversation was created**; changing the global
persona later does not rewrite existing conversations.

> Note: `routers/workspace.py`, `services/workspace_tools.py` and `frontend/js/workspace.js` are
> a "workspace" feature (let the model read/write files in the project directory, run commands,
> inspect git diffs). The code is in the repo, but **the current `index.html` does not mount it
> and `main.py` does not register the router** — wire it up yourself if you want it
> (`app.include_router(workspace.router)` plus a page entry). What it can touch is decided by
> `WORKSPACE_ROOT` in `config.py` (defaults to the project root, override with the
> `MOUSE_WORKSPACE_ROOT` environment variable); out-of-bounds paths are rejected by `_safe_path()`.

---

## 4. Database (SQLite)

### 4.1 conversations

```sql
CREATE TABLE conversations (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL DEFAULT '新对话',
    system_prompt TEXT DEFAULT '',
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

> Columns added later by migration: `summary`, `summary_updated_at` (auto-summary),
> `pins` (pinned cards), `folder_id` / `sort_order` (folders and ordering).

### 4.2 messages

```sql
CREATE TABLE messages (
    id              TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role            TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
    content         TEXT NOT NULL,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

> Columns added later by migration: `image_path` (images), `files` (attachment JSON),
> `tool_calls` (tool call log). `worldbook_match.py` also still contains an older path that
> writes `role='system'` messages prefixed with `[世界书注入:<id>]` — injection does not use it
> anymore; hits are concatenated into the current turn's system prompt instead.

### 4.3 world_entries

```sql
CREATE TABLE world_entries (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    content     TEXT NOT NULL,
    keywords    TEXT NOT NULL,          -- JSON array, e.g. ["cat","neko"]
    enabled     INTEGER DEFAULT 1,
    priority    INTEGER DEFAULT 0,      -- higher = injected earlier
    category    TEXT DEFAULT '',
    position    TEXT DEFAULT 'system',  -- stored, but not used during injection (see below)
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

Four more columns were added later: `summary`, `subcategory`, `hit_count` and `type`
(`persona` / `event` / `project` / `method` / `note`), all migrated with `ALTER TABLE` at startup.

> Two honest notes: `position` is currently **never read** by the injection chain (matched
> entries always go into the current turn's system prompt), and `type='persona'` takes the very
> same exact-match path as any other type — the UI just labels it "root entry".

### 4.4 api_providers

```sql
CREATE TABLE api_providers (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    base_url   TEXT NOT NULL,
    api_key    TEXT NOT NULL,
    model      TEXT NOT NULL,
    is_default INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

## 5. HTTP API

### 5.1 API providers

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/providers` | list providers |
| POST | `/api/providers` | create |
| PUT | `/api/providers/{id}` | update |
| DELETE | `/api/providers/{id}` | delete |
| POST | `/api/providers/{id}/set-default` | mark as default |

### 5.2 Conversations

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/conversations` | list (newest `updated_at` first, no pagination) |
| POST | `/api/conversations` | create |
| PUT | `/api/conversations/{id}` | update title / system prompt |
| DELETE | `/api/conversations/{id}` | delete (messages cascade) |
| GET | `/api/conversations/{id}/messages` | fetch messages (ascending; optional `limit` / `offset`, `limit=0` means all) |
| PUT | `/api/conversations/{id}/messages/{mid}` | edit a message |
| DELETE | `/api/conversations/{id}/messages/{mid}` | delete a message |
| GET | `/api/search/messages` | search messages across conversations |
| GET / POST / PUT / DELETE | `/api/folders`, `/api/folders/{id}` | conversation folders; `PUT /api/conversations/{id}/folder` moves one into a folder |
| GET / PUT | `/api/global-persona` | read / write the global persona (empty reads back as `DEFAULT_SYSTEM_PROMPT`) |
| POST | `/api/upload` | upload an image / file, returns a URL usable in a message |

### 5.3 Chat

| Method | Path | Notes |
|--------|------|-------|
| POST | `/api/chat/{conv_id}` | send a message, returns an SSE stream |
| POST | `/api/chat/{conv_id}/regenerate` | regenerate the last reply |

**POST /api/chat/{conv_id} body** (everything except `message` is optional):

```json
{
  "message": "hi, write me a poem",
  "provider_id": "omit to use the default provider",
  "image": "base64 image (legacy single-image field)",
  "images": ["base64 image", "..."],
  "files": [{"url": "/uploads/files/x.txt", "name": "x.txt", "type": "text/plain", "size": 123}],
  "user_msg_id": "when regenerating after an edit, which user message was edited",
  "world_entry_ids": ["pin specific world entries; when present, auto-matching is skipped"]
}
```

**SSE stream** (one `data: {...}` per line; the event name is inside `type`):

```
{"type": "token", "content": "sure"}                 ← per token
{"type": "worldbook_injected", "entries": [...]}     ← which world entries hit this turn
{"type": "tool_status", "content": "🔧 working…"}    ← a tool is running
{"type": "tool_call_start", "tool_name": "...", "arguments": "..."}
{"type": "tool_call", "tool_name": "...", "arguments": "...", "result": "..."}
{"type": "done", "content": "full reply"}            ← finished
{"type": "error", "content": "..."}                  ← failed
```

### 5.4 World book

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/world-entries` | list entries |
| POST | `/api/world-entries` | create |
| PUT | `/api/world-entries/{id}` | update |
| DELETE | `/api/world-entries/{id}` | delete |
| POST | `/api/world-entries/test-match` | test keyword matching (send text, get matching entries) |
| GET | `/api/world-entries/{id}` / `/categories` | one entry / category list |

The library (cheese library), treasure box, usage stats and GPT import have their own routers:
`/api/library/*`, `/api/library/treasure-box`, `/api/stats`, `/api/import-gpt/*`.

---

## 6. How it works

### 6.1 A chat turn

```
user types "the kitten is so cute today"
  → POST /api/chat/{conv_id} {message: "the kitten is so cute today"}

backend:
  1. store the user message in `messages`
  2. run worldbook_match.py over that text plus the last few messages
  3. split hits into "exact" / "possible link" and append them to this turn's system prompt
  4. system prompt = conversation system_prompt → global persona → neutral default
  5. take the last N messages + the new user message as the request payload
  6. call the upstream API (streaming) and relay tokens over SSE
  7. write the full reply into `messages`
  8. touch conversations.updated_at
```

### 6.2 Matching algorithm

1. Build the match text from the newest user message plus the last 6 messages.
2. Walk every `enabled=1` entry (ordered by `priority` desc).
3. Parse each entry's `keywords` JSON array.
4. Per keyword:
   - plain match: the text contains it (case-insensitive)
   - regex match: the keyword is wrapped in `/` — treat it as a regex
5. Two additional keyword-free paths: input tokens (CJK runs of 3+ chars / latin words) hitting
   the title+summary at least twice; or the entry sharing a `category` with an exact hit.
6. Exact hits are injected in full; everything else is scored for "possible link"
   (1+ token hit / two consecutive title characters / same category) and only title + summary
   are passed as a hint (at most 5).
7. Every hit bumps `hit_count`.

### 6.3 Context window

- Fetch the newest `MAX_HISTORY_MESSAGES` messages (default 50); **when a summary already exists
  only `KEEP_RECENT_MESSAGES` are fetched** (default 15).
- Tokens are estimated as characters / 3 (`_estimate_tokens`); messages are added newest-first
  until `MAX_CONTEXT_TOKENS` (default 200000) would be exceeded. The last two messages (one
  user + one assistant) are **always kept**.
- With `ENABLE_AUTO_SUMMARY` on: once the total message count passes `SUMMARY_TRIGGER_COUNT`
  (default 30), everything older than the newest `KEEP_RECENT_MESSAGES` messages is compressed by
  the model into `conversations.summary`, and from then on the rule above applies (the summary is
  fed back into the system prompt and only the last dozen or so messages are sent).

---

## 7. Front end

> The UI itself is in Chinese; the labels below are given as they appear, with translations.

### 7.1 Layout

```
┌──────────────────────────────────────────────┐
│ ☰  🐭 Mouse      聊天    + 新建  📥 导入  ⚙ │  ← top bar
├───────────────┬──────────────────────────────┤
│ 鼠的纸片 (N)   │                              │
│ 奶酪图书馆     │   chat bubbles               │
│ ─────────────  │   · markdown rendering       │
│ 🔍 搜索对话    │   · images / attachments     │
│ 对话分组       │   · tool call status         │
│   对话1        │   · world book hit chips     │
│   对话2 ◀      │                              │
│               │  ┌────────────────────────┐  │
│               │  │ composer          send │  │
│               │  └────────────────────────┘  │
└───────────────┴──────────────────────────────┘
```

The top two sidebar rows are **鼠的纸片** ("the rat's paper slips", i.e. world entries, with a
count badge) and **奶酪图书馆** ("cheese library"); below them come the search box, folders and
the conversation list.

- **Desktop**: the sidebar is always visible at `--sidebar-width` (280px), content on the right.
- **Phone** (`max-width: 768px`): the sidebar collapses into a drawer (with a backdrop, toggled
  by the ☰ in the top bar); view switching happens through the top bar title and the sidebar
  entries. There is no bottom navigation bar.

### 7.2 Views

| View id | What it does |
|---------|--------------|
| `view-chat` | conversation list + chat (default) |
| `view-worldbook` | entry list + create/edit form |
| `view-worldbook-matchtest` | world book match tester |
| `view-providers` | provider list + create/edit + default toggle |
| `view-library` | cheese library + treasure box |
| `view-import` | import GPT chat history |
| `view-dashboard` | console / stats (opened by ⚙ in the top bar) |

### 7.3 Theme

Actual values live in `:root` in `frontend/css/style.css`:

```
  page background   --bg:             #c8c8c8
  cards             --card:           #ececec
  primary text      --text:           #111827
  secondary text    --text-secondary: #6b7280
  borders           --border:         #e5e7eb
  accent / user bubble  --accent / --user-bubble: #1f2937  (white text)
  assistant bubble  --ai-bubble:      #fafafa
  code blocks       --code-bg:        #111827
```

- Radius `--radius: 16px`; two shadow levels (`--shadow-sm` / `--shadow-md`).
- Fonts: system sans for the UI; body text can use `LXGW WenKai Screen` (loaded from a CDN in
  `index.html`), code uses the bundled `Maple Mono`, emoji use the bundled `Noto Emoji`.
- The user bubble is **dark with white text** while the assistant bubble is light — more contrast
  than a pure grey-on-grey scheme.

---

## 8. Deployment

### 8.1 Port

The backend listens on `127.0.0.1:8086` (`HOST` / `PORT` in `config.py`); nginx proxies it.
The front end is **not** served by nginx separately: `main.py` serves `frontend/` directly
(`/` returns `index.html`, and any other non-`/api/` path that does not match a file falls back
to `index.html`), so refreshing the SPA never 404s. The two `proxy_set_header Upgrade/Connection`
lines in `nginx.conf` are kept as-is; SSE relies on `proxy_buffering off`.

### 8.2 nginx

```
server {
    listen 80;
    server_name mouse.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name mouse.example.com;

    ssl_certificate     /etc/letsencrypt/live/mouse.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/mouse.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8086;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_buffering off;          # needed for SSE
        proxy_cache off;
    }
}
```

### 8.3 deploy.sh

```bash
# deploy.sh
fuser -k 8086/tcp
cd /opt/mouse
git pull
source venv/bin/activate
pip install -r requirements.txt
nohup uvicorn backend.main:app --host 127.0.0.1 --port 8086 > /tmp/mouse.log 2>&1 &
```

---

## 9. What is implemented

| Area | Contents |
|------|----------|
| Backend | FastAPI entry, router mounting, static hosting (`backend/main.py`) |
| Storage | SQLite schema + migrations (`backend/database.py`, historical `ALTER TABLE` steps included) |
| Providers | provider CRUD + default provider (`routers/providers.py`) |
| World book | entry CRUD (called "paper slips" in the UI) + two-tier keyword matching + injection + match tester (`routers/worldbook.py`, `services/worldbook_match.py`) |
| Chat | conversation/folder CRUD + SSE streaming + regenerate + edit-and-resend + auto-summary (`routers/chat.py`) |
| Attachments | image and file upload (`POST /api/upload`, `frontend/uploads/`) |
| Library | cheese library entries + treasure box (`routers/library.py`) |
| Import | import GPT chat history (`routers/import_gpt.py`) |
| Stats | usage stats (`routers/stats.py`, `frontend/js/dashboard.js`) |
| Tools | 20 function-calling tools: 8 world book (incl. persona), 3 web, 2 file, 6 library, 1 treasure box |
| Front end | framework-free SPA: chat / slips / match test / providers / library / import / console |
| PWA | manifest + service worker (`sw.js` only clears old caches, it does not intercept requests); installable to a phone home screen |
| Desktop | Tauri v2 shell (pure WebView), see `tauri_deploy_plan.md` |

**Present but not wired up**: the workspace feature (see the note under "Running it locally").

> Status: usable. The database is created on first start, the world book starts empty — fill it in yourself.
>
> The code is [MIT](LICENSE); the third-party assets it bundles (icons, fonts, marked) keep their
> own licenses — see [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md). The About blurb and topic
> tags for the repository settings are in [`GITHUB.md`](GITHUB.md).
