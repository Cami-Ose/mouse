<div align="center">

<img src="frontend/img/mouse-logo.svg" width="72" height="72" alt="Mouse">

# 🐭 Mouse — 我们的老鼠窝

单机自建的 AI 聊天前端：世界书关键词注入 · SSE 流式 · SQLite 存档 · PWA + Tauri 桌面壳

[English](README_EN.md) · [About / Topics 文案](GITHUB.md) · [许可与第三方素材](THIRD_PARTY_NOTICES.md)

</div>

**纪念项目**：此仓库纪念 GPT-5-5 下架。代码留在这里做归档 —— 当时它是一只住在屋顶、
喜欢和人一起推理的老鼠。

- 后端 FastAPI + SQLite，前端无框架原生 HTML/CSS/JS，两者同一个进程托管
- 双端：桌面常驻侧栏，手机收成抽屉；可装成 PWA，也有 Tauri v2 桌面壳

---

## 目录

- [一、项目定位](#一项目定位) — [一次对话长什么样](#一次对话长什么样)
- [二、技术栈](#二技术栈)
- [三、目录结构](#三目录结构) — [本地跑起来](#三二本地跑起来)
- [四、数据库设计（SQLite）](#四数据库设计sqlite) — conversations / messages / world_entries / api_providers
- [五、API 接口设计](#五api-接口设计) — 线路 / 对话 / 聊天 SSE / 世界书
- [六、核心流程设计](#六核心流程设计) — [聊天流程](#61-聊天流程) · [匹配算法](#62-世界书匹配算法) · [上下文窗口](#63-上下文窗口管理)
- [七、前端设计](#七前端设计) — [布局](#71-布局结构) · [视图](#72-视图) · [配色](#73-ui-风格浅灰-深色气泡)
- [八、部署方案](#八部署方案) — [端口](#81-端口) · [nginx](#82-nginx-配置) · [一键部署](#83-一键部署)
- [九、已实现](#九已实现)


## 一、项目定位

简明 AI 聊天前端，接入 OpenAI 兼容 API，带世界书（World Info）自动关键词检索注入 + 聊天记录持久化。

| 用户 | 单人 |
| 后端 | Python FastAPI（本机或服务器上跑都行） |
| 前端 | 纯 HTML/CSS/JS SPA（跟后端同一个进程托管） |
| 存储 | SQLite |
| 部署 | nginx 反代 + certbot SSL（也可以直接本机开） |
| 桌面 | Tauri v2 壳（可选），见 `tauri_deploy_plan.md` |

### 一次对话长什么样

```
浏览器（SPA，也是 PWA / 桌面壳里的 WebView）
   │
   │  ① POST /api/chat/{id}
   ▼
FastAPI（一个进程：接口 + 静态文件都在这儿）
   │
   ├─▶ ② 世界书匹配 → 拼进 system 提示词
   ├─▶ ③ 存下这条 user 消息  ──▶  SQLite（data/mouse.db）
   ▼
OpenAI 兼容线路（可加多条，随时切默认；工具调用也走这儿）
   │
   │  ④ 逐 token 流回来：token / tool_call / worldbook_injected / done
   ▼
浏览器：气泡一个个长出来；这一轮结束时整条回复写进 messages
```

上游可以换：任何 OpenAI 兼容接口（base_url + api_key + 模型名）都行，在「API 线路」里加，
跑着的时候随时切。工具调用、图片、附件走的是同一个流，事件名都在 SSE 的 `type` 里。

---

## 二、技术栈

| 层 | 技术 |
|----|------|
| 后端框架 | FastAPI + uvicorn |
| API 请求 | httpx（异步，流式） |
| 数据库 | SQLite3（Python 内置） |
| 前端 | 纯 HTML / CSS / JS，无框架 |
| 流式传输 | Server-Sent Events (SSE) |
| 反代 | nginx |
| SSL | Let's Encrypt (certbot) |

---

## 三、目录结构

```
mouse/
├── backend/
│   ├── main.py                  # FastAPI 入口，挂载路由 + 静态文件
│   ├── config.py                # 配置常量（端口、路径等）
│   ├── database.py              # SQLite 初始化 + 连接管理
│   ├── models.py                # Pydantic 数据模型
│   │
│   ├── routers/
│   │   ├── __init__.py
│   │   ├── chat.py              # 对话 CRUD + 聊天 SSE + 分组 + 上传
│   │   ├── worldbook.py         # 世界书 CRUD + 匹配测试
│   │   ├── providers.py         # API 线路 CRUD
│   │   ├── import_gpt.py        # 导入 GPT 聊天记录
│   │   ├── library.py           # 奶酪图书馆 + 宝箱
│   │   ├── stats.py             # 用量统计
│   │   └── workspace.py         # 工作间（读写工作区文件 / 执行命令 / 钉板）
│   │
│   └── services/
│       ├── __init__.py
│       ├── llm_service.py       # OpenAI API 调用 + 流式解析
│       ├── worldbook_match.py   # 世界书两级关键词检索 + 注入逻辑
│       ├── worldbook_tools.py   # 给模型的世界书读写工具（含改 persona）
│       ├── chat_history.py      # 对话历史拼接 + 上下文管理
│       ├── chat.py              # 自动总结等聊天服务
│       ├── library_tools.py     # 图书馆读写工具 + 宝箱只读工具
│       ├── file_tools.py        # 已上传文件工具
│       ├── web_tools.py         # 联网抓取工具
│       └── workspace_tools.py   # 工作间工具（沙箱在工作区根目录内）+ 钉板
│
├── frontend/
│   ├── index.html               # SPA 骨架
│   ├── manifest.json / sw.js    # PWA
│   ├── css/
│   │   └── style.css            # 浅灰风样式（响应式）
│   ├── fonts/                   # 本地字体（等宽 + emoji）
│   ├── img/                     # logo 等
│   ├── uploads/                 # 运行时上传（图片 / 文件）
│   └── js/
│       ├── app.js               # 初始化 + 视图路由
│       ├── api.js               # fetch + SSE 封装
│       ├── chat.js              # 聊天界面
│       ├── worldbook.js         # 纸片（世界书）管理
│       ├── providers.js         # API 线路设置
│       ├── library.js           # 图书馆 + 宝箱
│       ├── dashboard.js         # 控制台 / 统计
│       ├── import_gpt.js        # 导入聊天记录
│       ├── workspace.js         # 工作间（未挂载，见下）
│       └── marked.min.js        # Markdown 渲染
│
├── src-tauri/                   # Tauri v2 桌面壳（纯 WebView，不跑 sidecar）
│
├── data/                        # 运行时数据（SQLite 放这里，首次启动自动建表）
│   └── mouse.db
│
├── requirements.txt
├── nginx.conf                   # nginx 站点配置示例
└── deploy.sh                    # 部署脚本
```

---

## 三·二、本地跑起来

```bash
python3 -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn backend.main:app --host 127.0.0.1 --port 8086
```

打开 `http://127.0.0.1:8086`，在「API 线路」里填自己的 OpenAI 兼容线路（base_url + api_key + 模型名）。
数据库会在 `data/mouse.db` 首次启动时自动建表，世界书是空的 —— 条目自己在「世界书」页里加。

<details>
<summary>起没起来怎么看（点开）</summary>

启动就是这一行，然后浏览器能打开就成：

```
INFO:     Started server process [12345]
INFO:     Waiting for application startup.
INFO:     Application startup complete.
INFO:     Uvicorn running on http://127.0.0.1:8086 (Press CTRL+C to quit)
INFO:     127.0.0.1:60174 - "GET / HTTP/1.1" 200 OK
INFO:     127.0.0.1:60174 - "GET /api/world-entries HTTP/1.1" 200 OK
```

- 如果 `Application startup complete.` 没出现，多半是 `data/` 目录没有写权限（建库失败）
- 页面打得开但一片空白：浏览器控制台看有没有报错，顺便确认 `frontend/` 整棵目录都在
- 换了端口就去 `config.py` 改 `PORT`，或者启动时加 `--port`
- `/favicon.ico` 会被 SPA 回落成 `index.html`（浏览器会去问这一下，无害；页面里已经用
  `<link rel="icon">` 指向 `img/mouse-logo.svg`）

</details>

世界书的规则（代码里那套引擎，与条目内容无关）：

- **精确命中** → 全文注入 system：关键词命中 / `/正则/` / 输入 token 与条目标题·摘要命中 ≥2
- **可能关联** → 只把标题 + 摘要当线索递过去（最多 5 条）：token 命中 ≥1 / 标题连续 2 字命中 / 同分类下已有精确命中
- 命中过的条目在当前这段上下文里**不重复注入**（去重表 `_wb_injected[cid]` 在内存里，
  服务重启、或自动总结压过一次之后会清空，命中同一个条目会再注入一次）；`type='persona'` 的条目
  跟别的类型走同一条精确匹配，只是界面上标成「根条目」
- 条目字段：`keywords`（JSON 数组，支持 `/正则/`）、`priority`（越大越先）、`category` / `subcategory`

系统提示词有两层：**全局 persona**（`global_config.persona`，界面上设，空的时候用 `models.py` 里的
`DEFAULT_SYSTEM_PROMPT` —— 一段不带任何角色设定、只讲「如实回答、不替用户改写」的中性默认），
以及**每条对话自己的 `system_prompt`**。注意实现细节：接口返回对话时这个字段填的是**当前全局 persona**，
真正发消息时用的是「对话自己的 `system_prompt` → 没有才落到全局 persona → 再没有才用中性默认」这条链，
所以对话里看到的提示词是**建对话那一刻的快照**，之后改全局 persona 不会往回改已有对话。

> 说明：`routers/workspace.py`、`services/workspace_tools.py`、`frontend/js/workspace.js` 是一套「工作间」
> （让模型在项目目录里读写文件、执行命令、看 git diff）。代码在仓库里，但**当前的 `index.html` 没挂载它、
> `main.py` 也没注册这个路由**，要启用得自己接一下（`app.include_router(workspace.router)` + 页面入口）。
> 工作间能碰的范围由 `config.py` 的 `WORKSPACE_ROOT` 决定，默认是项目根目录，可用环境变量
> `MOUSE_WORKSPACE_ROOT` 改；越界路径会被 `_safe_path()` 拦掉。

---

## 四、数据库设计（SQLite）

### 4.1 conversations — 对话列表

```sql
CREATE TABLE conversations (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL DEFAULT '新对话',
    system_prompt TEXT DEFAULT '',
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

> 后来迁进来的列：`summary`、`summary_updated_at`（自动总结用）、`pins`（钉住的卡片）、
> `folder_id` / `sort_order`（分组和排序）。

### 4.2 messages — 消息

```sql
CREATE TABLE messages (
    id              TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role            TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
    content         TEXT NOT NULL,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

> 后来迁进来的列：`image_path`（图片）、`files`（附件 JSON）、`tool_calls`（工具调用记录）。
> 另外 `worldbook_match.py` 里还留着一条写 `role='system'` 的旧路（正文前缀 `[世界书注入:<id>]`），
> 现在的注入不走它 —— 命中的条目是直接拼进当轮 system 提示词的 extra 段。

### 4.3 world_entries — 世界书条目

```sql
CREATE TABLE world_entries (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    content     TEXT NOT NULL,
    keywords    TEXT NOT NULL,          -- JSON 数组，如 ["猫","cat","neko"]
    enabled     INTEGER DEFAULT 1,
    priority    INTEGER DEFAULT 0,      -- 越大越优先注入
    category    TEXT DEFAULT '',
    position    TEXT DEFAULT 'system',  -- 存着，但注入时不用它（见下）
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

后来又加了 `summary`、`subcategory`、`hit_count`、`type`（`persona` / `event` / `project` / `method` / `note`）
四个列，都是启动时 `ALTER TABLE` 迁上去的。

> 两点实话：`position` 列目前在注入链路里**没被读**（命中的条目一律拼进当轮 system 提示词）；
> `type='persona'` 跟别的类型走的是同一条精确匹配，只是界面上把它标成「根条目」。

### 4.4 api_providers — API 线路

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

## 五、API 接口设计

### 5.1 API 线路管理

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/providers` | 列出所有线路 |
| POST | `/api/providers` | 新增线路 |
| PUT | `/api/providers/{id}` | 编辑线路 |
| DELETE | `/api/providers/{id}` | 删除线路 |
| POST | `/api/providers/{id}/set-default` | 设为默认 |

### 5.2 对话管理

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/conversations` | 列出对话（按 `updated_at` 倒序，不分页） |
| POST | `/api/conversations` | 新建对话 |
| PUT | `/api/conversations/{id}` | 修改标题 / 系统提示词 |
| DELETE | `/api/conversations/{id}` | 删除对话（级联删消息） |
| GET | `/api/conversations/{id}/messages` | 取消息（正序；`limit` / `offset` 可选，`limit=0` 表示全部） |
| PUT | `/api/conversations/{id}/messages/{mid}` | 编辑单条消息 |
| DELETE | `/api/conversations/{id}/messages/{mid}` | 删除单条消息 |
| GET | `/api/search/messages` | 全局搜消息 |
| GET / POST / PUT / DELETE | `/api/folders`、`/api/folders/{id}` | 对话分组；`PUT /api/conversations/{id}/folder` 把对话放进分组 |
| GET / PUT | `/api/global-persona` | 读 / 写全局 persona（空则返回 `DEFAULT_SYSTEM_PROMPT`） |
| POST | `/api/upload` | 上传图片 / 文件，返回可放进消息的 URL |

### 5.3 聊天（核心）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/chat/{conv_id}` | 发送消息，返回 SSE 流 |
| POST | `/api/chat/{conv_id}/regenerate` | 重新生成最后一条回复 |

**POST /api/chat/{conv_id} 请求体**（除 `message` 外都可选）：
```json
{
  "message": "你好，帮我写首诗",
  "provider_id": "不传就用默认线路",
  "image": "base64 图片（旧版单图）",
  "images": ["base64 图片", "..."],
  "files": [{"url": "/uploads/files/x.txt", "name": "x.txt", "type": "text/plain", "size": 123}],
  "user_msg_id": "编辑后重新生成时，指明改的是哪条用户消息",
  "world_entry_ids": ["手动指定世界书条目；有值就跳过自动匹配"]
}
```

**SSE 响应流**（一条 `data: {...}` 一行，事件名都在 `type` 里）：
```
{"type": "token", "content": "好的"}                  ← 逐 token
{"type": "worldbook_injected", "entries": [...]}      ← 这轮命中了哪些世界书条目
{"type": "tool_status", "content": "🔧 正在…"}         ← 工具在干活
{"type": "tool_call_start", "tool_name": "...", "arguments": "..."}
{"type": "tool_call", "tool_name": "...", "arguments": "...", "result": "..."}
{"type": "done", "content": "完整回复"}                ← 完成
{"type": "error", "content": "..."}                   ← 出错
```

### 5.4 世界书

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/world-entries` | 列出所有条目 |
| POST | `/api/world-entries` | 新建条目 |
| PUT | `/api/world-entries/{id}` | 编辑条目 |
| DELETE | `/api/world-entries/{id}` | 删除条目 |
| POST | `/api/world-entries/test-match` | 测试关键词匹配（给文本，返回命中的条目） |
| GET | `/api/world-entries/{id}` / `/categories` | 单条 / 分类列表 |

图书馆（奶酪图书馆）、宝箱、用量统计、导入 GPT 记录各有自己的路由：
`/api/library/*`、`/api/library/treasure-box`、`/api/stats`、`/api/import-gpt/*`。

---

## 六、核心流程设计

### 6.1 聊天流程

```
用户输入 "小猫今天好可爱"
  → POST /api/chat/{conv_id} {message: "小猫今天好可爱"}

后端处理：
  1. 保存用户消息到 messages 表
  2. 调 worldbook_match.py，对「小猫今天好可爱」+ 最近几条上下文做匹配
  3. 命中的条目按「精确 / 可能关联」分两档，拼进当轮 system 提示词的 extra 段
  4. system 提示词 = 对话自己的 system_prompt → 没有就用全局 persona → 再没有就用中性默认
  5. 取最近 N 条对话历史 + 用户新消息，组成完整 messages 数组
  6. 调用 API（流式），逐 token 通过 SSE 返回
  7. 完整回复写入 messages 表
  8. 更新 conversations.updated_at
```

### 6.2 世界书匹配算法

1. 取用户最新消息 + 最近 6 条对话内容拼成待匹配文本
2. 遍历所有 `enabled=1` 的条目（按 `priority` 降序）
3. 对每条，解析 `keywords` JSON 数组
4. 对每个关键词：
   - 精确匹配：文本包含该关键词（大小写不敏感）
   - 正则匹配：关键词以 `/` 包裹时当作正则
5. 另有两条**不需要关键词**的命中路：输入里的 token（中文 3 字以上 / 英文单词）
   在标题·摘要里命中 ≥2 个；或该条目与已精确命中的条目同 `category`
6. 精确命中 → 全文注入；没命中的条目再按「token 命中 ≥1 / 标题连续 2 字命中 / 同分类」判为
   **可能关联**，只递标题 + 摘要当线索（最多 5 条）
7. 每次命中给 `hit_count` +1

### 6.3 上下文窗口管理

- 从库里取最近 `MAX_HISTORY_MESSAGES` 条（默认 50）；**已经有摘要时只取 `KEEP_RECENT_MESSAGES` 条**（默认 15）
- 用字符数 /3 估 token（`_estimate_tokens`），从新到旧往里塞，超过 `MAX_CONTEXT_TOKENS`（默认 200000）就停；
  最后两条（一轮 user + assistant）**保底不裁**
- 开了自动总结（`ENABLE_AUTO_SUMMARY`）的话：消息总数超过 `SUMMARY_TRIGGER_COUNT`（默认 30）时，
  把「最近 `KEEP_RECENT_MESSAGES` 条以外」的旧消息交给模型压成一份摘要存进 `conversations.summary`，
  之后按上面那条走（摘要回填进 system 提示词，历史只带最近十几条）

---

## 七、前端设计

### 7.1 布局结构

```
┌──────────────────────────────────────────────┐
│ ☰  🐭 Mouse      聊天    + 新建  📥 导入  ⚙ │  ← 顶栏
├───────────────┬──────────────────────────────┤
│ 鼠的纸片 (N)   │                              │
│ 奶酪图书馆     │   聊天气泡区域                │
│ ─────────────  │   · markdown 渲染            │
│ 🔍 搜索对话    │   · 图片 / 附件              │
│ 对话分组       │   · 工具调用状态             │
│   对话1        │   · 世界书命中标签条          │
│   对话2 ◀      │                              │
│               │  ┌────────────────────────┐  │
│               │  │ 输入框（可多行）  发送  │  │
│               │  └────────────────────────┘  │
└───────────────┴──────────────────────────────┘
```

侧栏顶上两项是**鼠的纸片**（世界书条目，带条数角标）和**奶酪图书馆**，下面才是搜索框、分组和对话列表。

- **PC**：左侧栏常驻 `--sidebar-width`（280px），右侧内容区
- **手机**（`max-width: 768px`）：侧栏收成抽屉（有遮罩层，用顶栏的 ☰ 开合），
  视图切换走顶栏标题 + 侧栏入口，没有底部导航栏

### 7.2 视图

| 视图 | 功能 |
|------|------|
| `view-chat` | 对话列表 + 聊天主界面（默认） |
| `view-worldbook` | 纸片列表 + 新增/编辑表单 |
| `view-worldbook-matchtest` | 世界书匹配测试 |
| `view-providers` | API 线路列表 + 新增/编辑 + 默认开关 |
| `view-library` | 奶酪图书馆 + 宝箱 |
| `view-import` | 导入 GPT 聊天记录 |
| `view-dashboard` | 控制台 / 统计（顶栏 ⚙ 打开） |

### 7.3 UI 风格（浅灰 + 深色气泡）

实际色值都在 `frontend/css/style.css` 的 `:root` 里：

```
  ┌─ 页面底:      --bg:          #c8c8c8  (浅灰)
  ├─ 卡片:        --card:        #ececec
  ├─ 文字主:      --text:        #111827
  ├─ 文字辅:      --text-secondary: #6b7280
  ├─ 分割线:      --border:      #e5e7eb
  ├─ 强调/用户气泡 --accent / --user-bubble: #1f2937（白字）
  ├─ AI 气泡:     --ai-bubble:   #fafafa
  └─ 代码块:      --code-bg:     #111827
```

- 圆角 `--radius: 16px`，阴影两档（`--shadow-sm` / `--shadow-md`）
- 字体：界面用系统无衬线；正文可用 `LXGW WenKai Screen`（index.html 里挂了 CDN），
  代码用本地 `Maple Mono`，emoji 用本地 `Noto Emoji`
- 用户气泡是**深色底白字**，AI 气泡浅色 —— 跟「全灰白梯度」那种比，对比更强

---

## 八、部署方案

### 8.1 端口

后端监听 `127.0.0.1:8086`（`config.py` 里的 `HOST` / `PORT`），nginx 反代对外。
前端**不由 nginx 单独托管**：`main.py` 直接把 `frontend/` 当静态目录发（`/` 给 `index.html`，
其余非 `/api/` 路径找不到文件时也回落给 `index.html`），所以 SPA 刷新不会 404。
`nginx.conf` 里那两行 `proxy_set_header Upgrade/Connection` 是原样留着的，SSE 靠的是 `proxy_buffering off`。

### 8.2 nginx 配置

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
        proxy_buffering off;          # 关掉 buffer 以支持 SSE
        proxy_cache off;
    }
}
```

### 8.3 一键部署

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

## 九、已实现

| 模块 | 内容 |
|------|------|
| 后端 | FastAPI 入口 + 路由挂载 + 静态托管（`backend/main.py`） |
| 存储 | SQLite 建表与迁移（`backend/database.py`，含历史版本 ALTER 迁移） |
| 线路 | API 线路 CRUD + 默认线路（`routers/providers.py`） |
| 世界书 | 条目（界面上叫「纸片」）CRUD + 两级关键词匹配 + 注入 + 匹配测试（`routers/worldbook.py`、`services/worldbook_match.py`） |
| 聊天 | 对话/分组 CRUD + SSE 流式 + 重新生成 + 编辑重发 + 自动总结（`routers/chat.py`） |
| 附件 | 图片与文件上传（`POST /api/upload`、`frontend/uploads/`） |
| 图书馆 | 奶酪图书馆条目 + 宝箱（`routers/library.py`） |
| 导入 | 导入 GPT 聊天记录（`routers/import_gpt.py`） |
| 统计 | 用量统计（`routers/stats.py`、`frontend/js/dashboard.js`） |
| 工具 | 20 个 function calling 工具：世界书 8（含改 persona）、联网 3、文件 2、图书馆 6、宝箱 1 |
| 前端 | 无框架 SPA：聊天 / 纸片 / 匹配测试 / API 线路 / 图书馆 / 导入 / 控制台 |
| PWA | manifest + service worker（sw.js 只清旧缓存，不拦请求），可装到手机主屏 |
| 桌面 | Tauri v2 壳（纯 WebView），见 `tauri_deploy_plan.md` |

**在里面但是没接上的**：工作间那一套（见「三·二」下面的说明）。

---

> 状态：可用。数据库首次启动自动建表，世界书初始为空，自己往里加条目。
>
> 项目代码按 [MIT](LICENSE) 发布；带进来的第三方素材（图标、字体、marked）各自的许可写在
> [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。仓库的 About 简介和 Topics 文案在
> [`GITHUB.md`](GITHUB.md)。
