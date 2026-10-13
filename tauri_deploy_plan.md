# 🐭 Mouse — Tauri v2 桌面壳 + Android APK 集成方案

> 当前状态：纯 Web 项目（FastAPI + 前端 SPA）
> 目标状态：VPS 部署后端 + Tauri v2 壳（exe + APK）

---

## 一、最终架构

```
┌─────────────────────────┐    ┌─────────────────────────┐
│  Tauri Desktop (exe)     │    │  Tauri Android (APK)    │
│  Windows / macOS / Linux │    │                         │
│                          │    │                         │
│  ┌───────────────────┐   │    │  ┌───────────────────┐   │
│  │ WebView            │   │    │  │ WebView            │   │
│  │ frontend/index.html │  │    │  │ frontend/index.html │  │
│  │ + css/ + js/       │   │    │  │ + css/ + js/       │   │
│  └───────────────────┘   │    │  └───────────────────┘   │
│          │                │    │          │                │
│          │ fetch/SSE      │    │          │ fetch/SSE      │
│          ▼                │    │          ▼                │
│  https://mouse.           │    │  https://mouse.           │
│  example.com/api/...      │    │  example.com/api/...      │
└─────────────────────────┘    └─────────────────────────┘
          │                              │
          └──────────┬───────────────────┘
                     │
                     ▼
        ┌──────────────────────────────┐
        │  VPS · Ubuntu 24.04          │
        │                              │
        │  nginx → https://mouse.    │
        │         example.com         │
        │         ↓                    │
        │  127.0.0.1:8086 · FastAPI    │
        │  + CORS middleware           │
        │  + SQLite (data/mouse.db)    │
        └──────────────────────────────┘
```

### 关键变化

- **前端** `frontend/` 完全不变，原封不动挂进 Tauri WebView
- **后端** 上 VPS，前端通过 HTTPS 调用，不再本地起服务
- **Tauri** 只做壳，不跑 sidecar，纯 WebView 渲染
- **跨域** 后端加 CORS，允许 Tauri WebView 的 origin

---

## 二、分步实施

### Phase 1 — VPS 部署后端 ⏰ 30min

> 目标：`https://mouse.example.com` 能访问，返回 JSON

#### 1.1 上传代码到 VPS

```bash
# 本地执行，去掉 venv 再传
rsync -avz --exclude 'venv' --exclude '__pycache__' --exclude '*.pyc' \
  ./ root@<服务器 IP>:/opt/mouse/
```

#### 1.2 VPS 上初始化

```bash
ssh root@<服务器 IP>

cd /opt/mouse
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt -q

# 测试启动（手动验证，Ctrl+C 停掉）
uvicorn backend.main:app --host 127.0.0.1 --port 8086
```

#### 1.3 后端加 CORS

修改 `backend/main.py`，在 `app = FastAPI(...)` 之后加：

```python
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Tauri v2 dev 和生产 origin 不同，用 * 方便
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

> 注意：`allow_origins=["*"]` 在 Tauri v2 中必要，因为 WebView 的 origin 是 `tauri://localhost` 或 `https://tauri.localhost`，不是常规的 `http://localhost`。

#### 1.4 nginx + SSL

```bash
# 创建 nginx 配置软链接
ln -sf /opt/mouse/nginx.conf /etc/nginx/sites-enabled/mouse.example.com

# 先检查 nginx 配置里是否有 mouse 的 ssl 路径，certbot 会自动处理
# 申请证书
certbot --nginx -d mouse.example.com

# 重载
nginx -t && nginx -s reload
```

#### 1.5 启动服务

```bash
cd /opt/mouse
source venv/bin/activate
fuser -k 8086/tcp 2>/dev/null
nohup uvicorn backend.main:app --host 127.0.0.1 --port 8086 > /tmp/mouse.log 2>&1 &

sleep 2
curl -s http://127.0.0.1:8086/api/providers | head -20
```

如果返回 `[]` 或 JSON，部署成功。

---

### Phase 2 — Tauri v2 项目初始化 ⏰ 20min

> 目标：能跑起来一个空 Tauri 窗口

#### 2.1 前置条件检查

```bash
# Rust
rustc --version          # 需要 ≥ 1.77
cargo --version

# 安卓（可选，先确认）
java -version            # 需要 JDK 17
```

如果没有 Rust：
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

#### 2.2 在 Mouse 项目里初始化 Tauri

**目录规划**：

```
mouse/                     # 项目根
├── backend/                # FastAPI（部署在服务器上）
├── frontend/               # 原封不动的 SPA
│   ├── index.html
│   ├── css/
│   └── js/
├── src-tauri/              # ← Tauri 新增
│   ├── src/
│   │   └── main.rs         # Tauri 入口
│   ├── Cargo.toml
│   ├── tauri.conf.json     # Tauri 配置
│   ├── capabilities/       # v2 权限
│   ├── icons/              # 应用图标
│   ├── android/            # Android 工程（tauri android init 生成）
│   └── build.rs
├── package.json            # Node 脚本（tauri CLI）
└── README.md
```

初始化方式 **二选一**：

**方式 A：用 CLI 交互式（推荐）**
```bash
cd ~/mouse
npm create tauri-app@latest
# 项目名: mouse
# 前端: Vanilla HTML/JS
# 包管理器: npm 或不选
```

**方式 B：手动建**
1. `npm init` 生成 `package.json`
2. `npm install -D @tauri-apps/cli@^2`
3. `npx tauri init`（按提示填：窗口名 mouse，前端路径 ../frontend，开发命令空，构建命令空）

#### 2.3 关键配置 `tauri.conf.json`

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/nicejade/tauri-app-config-schema/refs/heads/main/tauri.conf.json",
  "productName": "Mouse",
  "version": "0.1.0",
  "identifier": "com.mouse-ai.chat",
  "build": {
    "frontendDist": "../frontend",       // 指向你的 SPA
    "devUrl": "http://localhost:1420",    // tauri dev 的本地地址
    "beforeDevCommand": "echo 'static'",  // 不需要构建
    "beforeBuildCommand": "echo 'static'"
  },
  "app": {
    "windows": [
      {
        "title": "🐭 Mouse AI Chat",
        "width": 1000,
        "height": 720,
        "minWidth": 360,
        "minHeight": 500,
        "resizable": true,
        "fullscreen": false
      }
    ],
    "security": {
      "csp": null  // 放宽 CSP，允许加载 marked.js CDN
    }
  }
}
```

#### 2.4 修改前端 API 地址

`frontend/js/api.js` 第 6 行：

```js
const API = {
  base: 'https://mouse.example.com',  // 默认 '' 表示同源（Web 版由后端一起托管）
  // ...
};
```

> Web 版前后端同一个源，`base: ''` 就够；桌面壳里 WebView 的 origin 是 `tauri://localhost`，
> 必须把 `base` 改成后端绝对地址（本地调试填 `http://127.0.0.1:8086`）。

#### 2.5 修改 marked.js 引用

`frontend/index.html` 第 84 行的 CDN 链接在 Tauri WebView 中可能因为 CSP 加载失败。两种修法：

**方案 A：下载 marked.js 放入项目**

```bash
curl -o frontend/js/marked.min.js https://cdn.jsdelivr.net/npm/marked@12.0.1/lib/marked.umd.min.js
```

`index.html` 中改成：
```html
<script src="/static/js/marked.min.js"></script>
```

**方案 B：放宽 CSP（已在 tauri.conf.json 中设为 null）**

CDN 可用，但需要网络。

推荐 **方案 A**，离线可用。

#### 2.6 验证 Tauri 跑起来

```bash
cd ~/mouse
npm install -D @tauri-apps/cli@^2
npx tauri dev
```

如果能弹出窗口显示 Mouse 界面，Tauri 集成完成。

---

### Phase 3 — 桌面壳发布 exe ⏰ 15min

```bash
# 生产构建
npx tauri build

# 产物在 src-tauri/target/release/bundle/
# Windows:  src-tauri/target/release/bundle/msi/Mouse_0.1.0_x64_en-US.msi
#           或 src-tauri/target/release/bundle/nsis/Mouse_0.1.0_x64-setup.exe
```

#### 3.1 应用图标

`src-tauri/icons/` 需要这些尺寸（Tauri v2 要求）：

| 平台 | 格式 | 尺寸 |
|------|------|------|
| Windows | `.ico` | 256×256 |
| 通用 | `.png` | 32/128/256/512 |

可以用在线工具把一张 PNG 转成 ico 和缩放多尺寸 png，丢进 `src-tauri/icons/`。

---

### Phase 4 — Android APK ⏰ 30min

#### 4.1 前置条件

| 软件 | 说明 |
|------|------|
| Android Studio | 提供 SDK、NDK、模拟器 |
| JDK 17+ | `java -version` 确认 |
| Android SDK 34 | 通过 Android Studio SDK Manager 装 |

环境变量设好：

```bash
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:ANDROID_NDK_HOME = "$env:ANDROID_HOME\ndk\27.0.12077973"
```

#### 4.2 初始化 Android 工程

```bash
cd ~/mouse
npx tauri android init
```

这会生成 `src-tauri/android/`。

#### 4.3 配置 Android 权限（网络请求）

`src-tauri/android/app/src/main/AndroidManifest.xml` 确认有：

```xml
<uses-permission android:name="android.permission.INTERNET" />
```

Tauri v2 默认不加这个权限，但 WebView 需要联网调 VPS API。

#### 4.4 构建 APK

```bash
# 构建
npx tauri android build

# 产物:
# src-tauri/target/android/apk/release/mouse-x86_64-release.apk
# src-tauri/target/android/apk/release/mouse-arm64-release.apk  ← 手机用这个
```

#### 4.5 安装到手机

- 把 arm64 APK 传到手机，直接安装
- 或用数据线 `adb install src-tauri/target/android/apk/release/mouse-arm64-release.apk`

---

## 三、需要修改的文件清单

| 文件 | 改动 | 原因 |
|------|------|------|
| `backend/main.py` | + `CORSMiddleware` 约 10 行 | Tauri WebView origin 非标准，需允许跨域 |
| `frontend/js/api.js:6` | `base: ''` 改成后端绝对地址 | WebView origin 不是后端源，前端拿不到同源接口 |
| `frontend/index.html:84` | CDN → 本地 `marked.min.js` | 离线可用，避免 CSP 问题 |
| `frontend/` | 新增 `marked.min.js` | 下载一个文件到 `frontend/js/` |
| 根目录 | 新增 `package.json` | npm 管理 tauri CLI |
| 根目录 | 新增 `src-tauri/` | Tauri 全部工程文件 |
| 根目录 | 新增 `README.md` 更新 | 加入构建说明 |

**无需改动**：`chat.js`、`worldbook.js`、`providers.js`、`app.js`、`style.css`、全部 HTML 结构。前端逻辑零修改。

---

## 四、文件总览（最终状态）

```
mouse/
├── backend/                     # 服务器上的后端
│   ├── main.py                  # 加 CORS
│   ├── config.py
│   ├── database.py
│   ├── models.py
│   ├── routers/
│   │   ├── chat.py
│   │   ├── providers.py
│   │   └── worldbook.py
│   └── services/
│       ├── chat_history.py
│       ├── llm_service.py
│       └── worldbook_match.py
│
├── frontend/                    # 原封不动，只改 2 处
│   ├── index.html               # marked.js 换成本地
│   ├── css/style.css
│   └── js/
│       ├── api.js               # base 改成后端地址
│       ├── marked.min.js        # 新增，代替 CDN
│       ├── chat.js
│       ├── worldbook.js
│       ├── providers.js
│       └── app.js
│
├── src-tauri/                   # 全新，初始化生成
│   ├── src/main.rs
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── capabilities/
│   │   └── default.json
│   ├── icons/
│   │   └── *.png / *.ico
│   ├── android/                 # tauri android init 生成
│   │   ├── app/
│   │   └── build.gradle.kts
│   └── build.rs
│
├── package.json                 # 新增
├── nginx.conf
├── requirements.txt
├── deploy.sh
└── tauri_deploy_plan.md         # 本规划文档
```

---

## 五、常见坑

### 5.1 Tauri v2 CSP 问题

Tauri v2 默认 CSP 严格。如果 marked.js 通过 CDN 加载失败，在 `tauri.conf.json` 中设 `"csp": null` 彻底放开，或下载到本地。

### 5.2 Tauri v2 跨域问题

WebView 发请求的 origin 是 `tauri://localhost` 或 `https://tauri.localhost`。后端 CORS `allow_origins` 设 `["*"]` 最省心。带 cookie/凭据不要设 `allow_credentials=true`（且 `*` 不能和 `true` 共存）。

### 5.3 Android INTERNET 权限

Tauri v2 Android 默认没有网络权限。`AndroidManifest.xml` 必须手动加 `<uses-permission android:name="android.permission.INTERNET" />`，否则所有 API 请求静默失败。

### 5.4 本地测试技巧

调试时可以暂时把 `API.base` 设回 `''`，本地起 FastAPI 测试前端：

```bash
cd ~/mouse
uvicorn backend.main:app --host 127.0.0.1 --port 8086
```

然后 `npx tauri dev` 指向本地 API。

---

## 六、执行顺序汇总

```
Step 1: VPS 部署后端 (CORS + nginx + SSL)
  └─ 验证: curl https://mouse.example.com/api/providers

Step 2: 本地前端改 2 处 (api.js base URL + marked.js 本地化)
  └─ 验证: 浏览器打开 frontend/index.html 能调 VPS API

Step 3: 初始化 Tauri v2
  └─ 验证: npx tauri dev 弹出窗口，能正常聊天

Step 4: tauri build → exe
  └─ 产物: src-tauri/target/release/bundle/nsis/*.exe

Step 5: tauri android init + build → APK
  └─ 产物: src-tauri/target/android/apk/release/mouse-arm64-release.apk
```
