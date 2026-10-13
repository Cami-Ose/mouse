"""
FastAPI 入口 — 挂载路由 + 静态文件托管
"""

import os
import sys
from pathlib import Path
from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware

# 确保 backend/ 目录在导入路径中，使内部模块可直接 import
_backend_dir = os.path.dirname(os.path.abspath(__file__))
if _backend_dir not in sys.path:
    sys.path.insert(0, _backend_dir)

from database import init_db
from config import FRONTEND_DIR

app = FastAPI(title="Mouse AI Chat", version="0.1.0")

# CORS — Tauri WebView origin（tauri://localhost / https://tauri.localhost）需要跨域
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── 启动时初始化数据库 ──────────────────────────────────
@app.on_event("startup")
def startup():
    init_db()


# ─── 挂载路由 ────────────────────────────────────────────
from routers import chat, providers, worldbook, import_gpt, library, stats

app.include_router(chat.router)
app.include_router(providers.router)
app.include_router(worldbook.router)
app.include_router(import_gpt.router)
app.include_router(library.router)
app.include_router(stats.router)


# ─── 托管前端静态文件 ─────────────────────────────────────
if os.path.isdir(FRONTEND_DIR):
    @app.get("/")
    def index():
        return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))


# ─── SPA fallback ───────────────────────────────────────
# 对非 API 路径的 404 返回 index.html（前端路由），对 API 返回 JSON 404
@app.exception_handler(404)
async def not_found_handler(request: Request, exc):
    if request.url.path.startswith("/api/"):
        return JSONResponse({"detail": "Not Found"}, status_code=404)

    # 安全校验：防止路径遍历 (../../../etc/passwd)
    request_path = request.url.path.lstrip("/")
    fp = os.path.realpath(os.path.join(FRONTEND_DIR, request_path))
    frontend_real = os.path.realpath(FRONTEND_DIR)

    if not fp.startswith(frontend_real):
        return JSONResponse({"detail": "Forbidden"}, status_code=403)

    if os.path.isfile(fp):
        return FileResponse(fp)
    return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))
