"""
对话 CRUD + 聊天 SSE
"""

import uuid
import json
import base64
import os
import re
import asyncio

# 跟踪每个对话已注入的世界书条目（内存，重启后重置）
# 结构：{ conversation_id: set(entry_id) }
_wb_injected: dict[str, set[int]] = {}
from fastapi import APIRouter, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse
from database import get_connection
from models import (
    ConversationCreate,
    ConversationUpdate,
    ChatFolderCreate,
    ChatFolderUpdate,
    ChatRequest,
    MessageUpdate,
)
from services.chat_history import build_messages
from services.llm_service import LLMClient
from services.worldbook_match import match_world_entries_detailed, _entry_dict
from services.worldbook_tools import WORDBOOK_TOOLS, execute_tool as execute_wb_tool
from services.web_tools import WEB_TOOLS, execute_web_tool
from services.file_tools import FILE_TOOLS, execute_file_tool
from services.library_tools import LIBRARY_TOOLS, TREASURE_BOX_TOOLS, execute_library_tool
from config import FRONTEND_DIR, ENABLE_AUTO_SUMMARY, SUMMARY_TRIGGER_COUNT, KEEP_RECENT_MESSAGES, SUMMARY_TIMEOUT, SUMMARY_PROMPT
from models import DEFAULT_SYSTEM_PROMPT


def _get_global_persona():
    conn = get_connection()
    row = conn.execute("SELECT persona FROM global_config WHERE id = 1").fetchone()
    # 表里那一行可能一直是空的（刚建库就是 ''），这时候跟 chat_history 一样落到中性默认
    return (row["persona"] if row and row["persona"] else DEFAULT_SYSTEM_PROMPT)

# 上传目录
UPLOAD_DIR = os.path.join(FRONTEND_DIR, "uploads")
FILE_DIR = os.path.join(UPLOAD_DIR, "files")

# 合并所有工具
ALL_TOOLS = WORDBOOK_TOOLS + WEB_TOOLS + FILE_TOOLS + LIBRARY_TOOLS + TREASURE_BOX_TOOLS

router = APIRouter(prefix="/api", tags=["chat"])


def _save_image_file(base64_str: str, msg_id: str) -> str | None:
    """将 base64 图片保存到 uploads/ 目录，返回 URL 路径。"""
    try:
        image_data = base64.b64decode(base64_str)
        # 探测图片格式
        if image_data[:3] == b"\xff\xd8\xff":
            ext = "jpg"
        elif image_data[:4] == b"\x89PNG":
            ext = "png"
        elif image_data[:6] in (b"GIF87a", b"GIF89a"):
            ext = "gif"
        elif image_data[:4] == b"RIFF":
            ext = "webp"
        else:
            ext = "jpg"
        os.makedirs(UPLOAD_DIR, exist_ok=True)
        filename = f"{msg_id}_{uuid.uuid4().hex[:8]}.{ext}"
        filepath = os.path.join(UPLOAD_DIR, filename)
        with open(filepath, "wb") as f:
            f.write(image_data)
        return f"/uploads/{filename}"
    except Exception as e:
        print(f"[ERROR] 保存图片失败: {e}")
        return None


_TEXT_EXTENSIONS = {".txt", ".md", ".csv", ".json", ".xml", ".yaml", ".yml",
                    ".py", ".js", ".ts", ".jsx", ".tsx", ".html", ".css", ".scss",
                    ".java", ".cpp", ".c", ".h", ".hpp", ".go", ".rs", ".rb", ".php",
                    ".sh", ".bat", ".ps1", ".sql", ".r", ".lua", ".pl", ".swift",
                    ".kt", ".kts", ".toml", ".ini", ".cfg", ".conf", ".env",
                    ".log", ".tex", ".rst", ".vue", ".svelte", ".astro"}


def _extract_file_text(filepath: str, mime_type: str = "", filename: str = "") -> str:
    """提取文件文本内容（供 AI 阅读）"""
    ext = os.path.splitext(filename or filepath)[1].lower()

    # 纯文本类
    if ext in _TEXT_EXTENSIONS:
        try:
            with open(filepath, "r", encoding="utf-8", errors="replace") as f:
                text = f.read(50000)  # 最多 50KB
            return text
        except Exception as e:
            return f"[无法读取文本文件: {e}]"

    # PDF
    if ext == ".pdf":
        try:
            import fitz  # PyMuPDF
            doc = fitz.open(filepath)
            text = ""
            for page in doc:
                text += page.get_text()
            doc.close()
            return text[:50000]
        except Exception as e:
            return f"[无法提取 PDF 内容: {e}]"

    # DOCX
    if ext == ".docx":
        try:
            from docx import Document
            doc = Document(filepath)
            text = "\n".join(p.text for p in doc.paragraphs)
            return text[:50000]
        except Exception as e:
            return f"[无法提取 DOCX 内容: {e}]"

    return f"[不支持的文件类型: {mime_type or ext}]"


@router.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    """上传文件（任意类型），返回 URL 和元信息"""
    os.makedirs(FILE_DIR, exist_ok=True)
    file_id = str(uuid.uuid4())[:12]
    ext = os.path.splitext(file.filename or "file")[1].lower()
    safe_name = f"{file_id}{ext}"
    filepath = os.path.join(FILE_DIR, safe_name)

    content = await file.read()
    with open(filepath, "wb") as f:
        f.write(content)

    url = f"/uploads/files/{safe_name}"
    return {
        "url": url,
        "name": file.filename or safe_name,
        "type": file.content_type or "application/octet-stream",
        "size": len(content),
    }


def _conv_row(row) -> dict:
    prompt = _get_global_persona()
    rk = row.keys()
    return {
        "id": row["id"],
        "title": row["title"],
        "system_prompt": prompt,
        "resolved_prompt": prompt or DEFAULT_SYSTEM_PROMPT,
        "folder_id": row["folder_id"] if "folder_id" in rk and row["folder_id"] else None,
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def _msg_row(row) -> dict:
    result = {
        "id": row["id"],
        "conversation_id": row["conversation_id"],
        "role": row["role"],
        "content": row["content"],
        "created_at": row["created_at"],
    }
    if row["image_path"]:
        try:
            urls = json.loads(row["image_path"])
            if isinstance(urls, list):
                result["image_urls"] = urls
            else:
                result["image_urls"] = [row["image_path"]]
        except (json.JSONDecodeError, TypeError):
            result["image_urls"] = [row["image_path"]]
    if row["tool_calls"]:
        try:
            result["tool_calls"] = json.loads(row["tool_calls"])
        except (json.JSONDecodeError, TypeError):
            pass
    if row["files"]:
        try:
            result["files"] = json.loads(row["files"])
        except (json.JSONDecodeError, TypeError):
            pass
    return result


# ─── 对话 CRUD ────────────────────────────────────────────

@router.get("/conversations")
def list_conversations():
    conn = get_connection()
    rows = conn.execute(
        "SELECT * FROM conversations ORDER BY updated_at DESC"
    ).fetchall()
    return [_conv_row(r) for r in rows]


@router.post("/conversations")
def create_conversation(body: ConversationCreate):
    conn = get_connection()
    cid = str(uuid.uuid4())[:8]
    conn.execute(
        "INSERT INTO conversations (id, title) VALUES (?, ?)",
        (cid, body.title),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM conversations WHERE id = ?", (cid,)).fetchone()
    return _conv_row(row)


@router.put("/conversations/{cid}")
def update_conversation(cid: str, body: ConversationUpdate):
    conn = get_connection()
    existing = conn.execute(
        "SELECT * FROM conversations WHERE id = ?", (cid,)
    ).fetchone()
    if not existing:
        raise HTTPException(404, "对话不存在")

    updates = body.model_dump(exclude_unset=True)
    if not updates:
        return _conv_row(existing)

    # 更新字段 + 时间戳（CURRENT_TIMESTAMP 是 SQL 函数，不能做参数绑定）
    field_clauses = [f"{k} = ?" for k in updates] + ["updated_at = CURRENT_TIMESTAMP"]
    fields = ", ".join(field_clauses)
    values = list(updates.values()) + [cid]
    conn.execute(f"UPDATE conversations SET {fields} WHERE id = ?", values)
    conn.commit()
    row = conn.execute("SELECT * FROM conversations WHERE id = ?", (cid,)).fetchone()
    return _conv_row(row)


# ─── 聊天文件夹 CRUD ──────────────────────────────────────


@router.get("/folders")
def list_folders():
    conn = get_connection()
    rows = conn.execute("SELECT * FROM chat_folders ORDER BY sort_order, name").fetchall()
    result = []
    for r in rows:
        cnt = conn.execute(
            "SELECT COUNT(*) FROM conversations WHERE folder_id = ?", (r["id"],)
        ).fetchone()[0]
        result.append({
            "id": r["id"],
            "name": r["name"],
            "sort_order": r["sort_order"],
            "count": cnt,
            "created_at": r["created_at"],
            "updated_at": r["updated_at"],
        })
    return result


@router.post("/folders")
def create_folder(body: ChatFolderCreate):
    conn = get_connection()
    fid = str(uuid.uuid4())[:8]
    conn.execute(
        "INSERT INTO chat_folders (id, name, sort_order) VALUES (?, ?, ?)",
        (fid, body.name, body.sort_order),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM chat_folders WHERE id = ?", (fid,)).fetchone()
    return {
        "id": row["id"],
        "name": row["name"],
        "sort_order": row["sort_order"],
        "count": 0,
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


@router.put("/folders/{fid}")
def update_folder(fid: str, body: ChatFolderUpdate):
    conn = get_connection()
    existing = conn.execute("SELECT * FROM chat_folders WHERE id = ?", (fid,)).fetchone()
    if not existing:
        raise HTTPException(404, "文件夹不存在")
    updates = body.model_dump(exclude_unset=True)
    if not updates:
        return existing
    fields = ", ".join(f"{k} = ?" for k in updates)
    fields += ", updated_at = CURRENT_TIMESTAMP"
    values = list(updates.values()) + [fid]
    conn.execute(f"UPDATE chat_folders SET {fields} WHERE id = ?", values)
    conn.commit()
    row = conn.execute("SELECT * FROM chat_folders WHERE id = ?", (fid,)).fetchone()
    return {
        "id": row["id"],
        "name": row["name"],
        "sort_order": row["sort_order"],
        "count": None,
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


@router.delete("/folders/{fid}")
def delete_folder(fid: str):
    conn = get_connection()
    existing = conn.execute("SELECT * FROM chat_folders WHERE id = ?", (fid,)).fetchone()
    if not existing:
        raise HTTPException(404, "文件夹不存在")
    conn.execute("UPDATE conversations SET folder_id = NULL WHERE folder_id = ?", (fid,))
    conn.execute("DELETE FROM chat_folders WHERE id = ?", (fid,))
    conn.commit()
    return {"ok": True}


@router.put("/conversations/{cid}/folder")
def move_conversation_to_folder(cid: str, body: dict):
    """移动对话到文件夹 body: {folder_id: '...' or null}"""
    conn = get_connection()
    existing = conn.execute("SELECT * FROM conversations WHERE id = ?", (cid,)).fetchone()
    if not existing:
        raise HTTPException(404, "对话不存在")
    folder_id = body.get("folder_id") or None
    conn.execute("UPDATE conversations SET folder_id = ? WHERE id = ?", (folder_id, cid))
    conn.commit()
    row = conn.execute("SELECT * FROM conversations WHERE id = ?", (cid,)).fetchone()
    return _conv_row(row)


@router.get("/global-persona")
def get_global_persona():
    return {"persona": _get_global_persona()}


@router.put("/global-persona")
def update_global_persona(body: dict):
    persona = body.get("persona", "")
    if not persona:
        raise HTTPException(400, "persona 不能为空")
    conn = get_connection()
    conn.execute(
        "INSERT OR REPLACE INTO global_config (id, persona, updated_at) VALUES (1, ?, CURRENT_TIMESTAMP)",
        (persona,),
    )
    conn.commit()
    return {"persona": persona}


@router.delete("/conversations/{cid}")
def delete_conversation(cid: str):
    conn = get_connection()
    existing = conn.execute(
        "SELECT * FROM conversations WHERE id = ?", (cid,)
    ).fetchone()
    if not existing:
        raise HTTPException(404, "对话不存在")
    conn.execute("DELETE FROM conversations WHERE id = ?", (cid,))
    conn.commit()
    return {"ok": True}


# ─── 消息 CRUD ────────────────────────────────────────────

@router.get("/conversations/{cid}/messages")
def list_messages(cid: str, limit: int = 0, offset: int = 0):
    conn = get_connection()
    conv = conn.execute(
        "SELECT * FROM conversations WHERE id = ?", (cid,)
    ).fetchone()
    if not conv:
        raise HTTPException(404, "对话不存在")

    if limit > 0:
        rows = conn.execute(
            """SELECT * FROM messages
               WHERE conversation_id = ?
               ORDER BY created_at ASC
               LIMIT ? OFFSET ?""",
            (cid, limit, offset),
        ).fetchall()
    else:
        rows = conn.execute(
            """SELECT * FROM messages
               WHERE conversation_id = ?
               ORDER BY created_at ASC""",
            (cid,),
        ).fetchall()
    return [_msg_row(r) for r in rows]


@router.delete("/conversations/{cid}/messages/{mid}")
def delete_message(cid: str, mid: str):
    conn = get_connection()
    existing = conn.execute(
        "SELECT * FROM messages WHERE id = ? AND conversation_id = ?", (mid, cid)
    ).fetchone()
    if not existing:
        raise HTTPException(404, "消息不存在")
    conn.execute("DELETE FROM messages WHERE id = ?", (mid,))
    conn.commit()
    return {"ok": True}


@router.put("/conversations/{cid}/messages/{mid}")
def update_message(cid: str, mid: str, body: MessageUpdate):
    conn = get_connection()
    existing = conn.execute(
        "SELECT * FROM messages WHERE id = ? AND conversation_id = ?", (mid, cid)
    ).fetchone()
    if not existing:
        raise HTTPException(404, "消息不存在")
    conn.execute(
        "UPDATE messages SET content = ? WHERE id = ?", (body.content, mid)
    )
    conn.commit()
    row = conn.execute("SELECT * FROM messages WHERE id = ?", (mid,)).fetchone()
    return _msg_row(row)


# ─── 消息搜索 ──────────────────────────────────────────────

@router.get("/search/messages")
def search_messages(q: str = ""):
    """在全部消息的 content 中搜索关键词，返回匹配的消息（含对话标题）"""
    if not q or not q.strip():
        return []
    conn = get_connection()
    like = f"%{q.strip()}%"
    rows = conn.execute(
        """SELECT m.id, m.conversation_id, m.role, m.content, m.created_at,
                  c.title as conv_title
           FROM messages m
           JOIN conversations c ON c.id = m.conversation_id
           WHERE m.content LIKE ?
           ORDER BY m.created_at DESC
           LIMIT 30""",
        (like,),
    ).fetchall()
    result = []
    for r in rows:
        content = r["content"] or ""
        # 截取关键词附近的文本片段
        idx = content.lower().find(q.strip().lower())
        start = max(0, idx - 40)
        end = min(len(content), idx + len(q.strip()) + 60)
        snippet = content[start:end] if idx >= 0 else content[:100]
        if start > 0:
            snippet = "…" + snippet
        if end < len(content):
            snippet = snippet + "…"
        result.append({
            "id": r["id"],
            "conversation_id": r["conversation_id"],
            "role": r["role"],
            "snippet": snippet,
            "conv_title": r["conv_title"],
            "created_at": str(r["created_at"]) if r["created_at"] else "",
        })
    return result


# ─── 聊天 SSE ─────────────────────────────────────────────

def _resolve_provider(conn, provider_id: str | None) -> tuple:
    """确定 API 线路，返回 (provider_row, provider_id)。"""
    pid = provider_id
    if not pid:
        row = conn.execute(
            "SELECT * FROM api_providers WHERE is_default = 1 LIMIT 1"
        ).fetchone()
        if not row:
            row = conn.execute(
                "SELECT * FROM api_providers ORDER BY created_at ASC LIMIT 1"
            ).fetchone()
        if not row:
            raise HTTPException(400, "没有可用的 API 线路，请先添加")
        pid = row["id"]

    provider = conn.execute(
        "SELECT * FROM api_providers WHERE id = ?", (pid,)
    ).fetchone()
    if not provider:
        raise HTTPException(404, "API 线路不存在")
    return provider, pid


def _fetch_manual_entries(conn, entry_ids: list[str]) -> list[dict]:
    """按 ID 拉取世界书条目（用户手动携带）。未找到或已禁用的自动跳过。"""
    ids = [i for i in entry_ids if i]
    if not ids:
        return []
    placeholders = ",".join("?" for _ in ids)
    rows = conn.execute(
        f"SELECT * FROM world_entries WHERE id IN ({placeholders}) AND enabled = 1",
        ids,
    ).fetchall()
    return [_entry_dict(r, "manual") for r in rows]


def _build_chat_messages(conn, cid: str, text: str, exclude_last_user: bool = False, source_msg_id: str | None = None, world_entry_ids: list[str] | None = None) -> tuple[list[dict], list | None, list]:
    """世界书动态注入（不写DB，不占消息坑）+ 上下文拼接，返回 (messages, tools, injected_entries) 元组。

    world_entry_ids 非 None：用户手动指定携带的世界书（完全控制，跳过自动匹配）；
    为 None：自动匹配注入（旧逻辑）。
    """
    # 如果有自动摘要（说明上下文被压缩过），清除注入标记，允许重新注入
    conv = conn.execute(
        "SELECT summary FROM conversations WHERE id = ?", (cid,)
    ).fetchone()
    if conv and conv["summary"] and cid in _wb_injected:
        del _wb_injected[cid]

    if world_entry_ids is not None:
        # 手动携带：只用用户选的条目，重复携带也强制注入（不做去重过滤）
        new_matched = _fetch_manual_entries(conn, world_entry_ids)
    else:
        # 世界书：每次动态匹配，注入到 system prompt extra 中
        match_result = match_world_entries_detailed(text)
        all_matched = match_result["exact"] + match_result["fuzzy"]

        # 过滤掉已注入过的条目（同一次压缩周期内不重复注入）
        if cid not in _wb_injected:
            _wb_injected[cid] = set()
        new_matched = [e for e in all_matched if e["id"] not in _wb_injected[cid]]
        for e in new_matched:
            _wb_injected[cid].add(e["id"])

    # 从匹配结果直接拼注入文本（手动/精确 → 全文；模糊 → 提示关联）
    wb_parts = []
    for e in new_matched:
        if e["match_type"] in ("manual", "exact"):
            wb_parts.append(f"[世界书] {e['title']}：{e['content']}")
        else:
            summary_text = e["summary"] or e["content"][:60]
            wb_parts.append(f"📌 世界书关联：{e['title']} — {summary_text}（可查阅详情）")
    wb_extra = "\n\n".join(wb_parts)

    # 构建消息（世界书文本通过 system_prompt_extra 注入到 system message 中，不占历史坑）
    msgs = build_messages(cid, text, system_prompt_extra=wb_extra, exclude_last_user=exclude_last_user)
    if not msgs:
        raise HTTPException(500, "消息构建失败")

    # 为历史消息中带 files 的用户消息拼接文件内容
    # 兼容旧数据：content 已有文件文本的跳过，新数据从 files 列读取
    import json as _json
    for msg in msgs:
        if msg.get("role") != "user" or not msg.get("files"):
            continue
        files_raw = msg["files"]
        try:
            user_files = _json.loads(files_raw) if isinstance(files_raw, str) else (files_raw or [])
        except Exception:
            continue
        if not user_files or not isinstance(user_files, list):
            continue
        # 跳过已含文件文本的旧消息
        if isinstance(msg["content"], str) and msg["content"].startswith("[用户上传了以下文件：]"):
            continue
        file_context = ""
        for f in user_files:
            fp = os.path.join(FRONTEND_DIR, f.get("url", "").lstrip("/"))
            if os.path.isfile(fp):
                text_content = _extract_file_text(fp, f.get("type", ""), f.get("name", ""))
                file_context += f"\n--- {f['name']} ---\n{text_content}\n"
        if file_context:
            msg["content"] = f"[用户上传了以下文件：]\n{file_context.strip()}\n\n{msg['content']}"

    # 清理消息中的内部字段（AI API 用不到）
    for msg in msgs:
        msg.pop("id", None)
        msg.pop("files", None)

    # 有对话历史才给 AI 工具权限
    has_history = len([m for m in msgs if m["role"] in ("user", "assistant")]) > 0
    tools = ALL_TOOLS if has_history else None

    # 构建 SSE 通知用的注入列表
    injected_entries = [{"id": e["id"], "title": e["title"], "match_type": e["match_type"]} for e in new_matched]
    return msgs, tools, injected_entries


# ─── 自动总结 ────────────────────────────────────────────────

async def _maybe_summarize_conversation(cid: str, provider_row):
    """流式完成后，如果对话太长则自动总结旧消息。
    总结会在后台异步执行，不阻塞用户回复。"""
    if not ENABLE_AUTO_SUMMARY:
        return

    try:
        conn = get_connection()

        # 取对话信息和当前摘要
        conv = conn.execute(
            "SELECT summary, summary_updated_at FROM conversations WHERE id = ?", (cid,)
        ).fetchone()
        if not conv:
            return

        # 总消息数
        total_row = conn.execute(
            "SELECT COUNT(*) as c FROM messages WHERE conversation_id = ?", (cid,)
        ).fetchone()
        total_msgs = total_row["c"] if total_row else 0
        if total_msgs <= SUMMARY_TRIGGER_COUNT:
            return

        # 收集需要总结的消息（早于最近 KEEP_RECENT_MESSAGES 条的消息）
        # 先取所有消息的 id 和 created_at，按时间正序
        all_rows = conn.execute(
            """SELECT id, role, content, created_at FROM messages
               WHERE conversation_id = ? ORDER BY created_at ASC""",
            (cid,),
        ).fetchall()

        # 要保留的最近消息数量
        old_rows = all_rows[:-KEEP_RECENT_MESSAGES] if len(all_rows) > KEEP_RECENT_MESSAGES else []
        if not old_rows:
            return

        # 有已有摘要 → 只总结新增部分（增量）
        existing_summary = conv["summary"]
        if existing_summary and conv["summary_updated_at"]:
            # 只取 summary_updated_at 之后的消息（新增部分）
            new_rows = [
                r for r in old_rows
                if r["created_at"] > conv["summary_updated_at"]
            ]
            if not new_rows:
                return  # 没有新增消息，不需要重新总结

            # 增量总结：已有摘要 + 新增消息
            history_text = f"[已有摘要]\n{existing_summary}\n\n[新增消息]\n"
            for r in new_rows:
                prefix = "用户" if r["role"] == "user" else "AI"
                content = (r["content"] or "")[:2000]  # 每条截断防超
                history_text += f"{prefix}: {content}\n\n"

            prompt_text = ("以下是已有的对话摘要和新增的对话内容，"
                          "请合并为一篇新的连贯摘要，保留所有重要信息、具体细节和关键原话，"
                          "尽量详细，控制在600字以内。\n\n" + history_text)
        else:
            # 首次总结：取 old_rows（最多 80 条，避免超时）
            limit_old = old_rows[:80]
            history_text = ""
            for r in limit_old:
                prefix = "用户" if r["role"] == "user" else "AI"
                content = (r["content"] or "")[:2000]
                history_text += f"{prefix}: {content}\n\n"

            prompt_text = SUMMARY_PROMPT + "\n\n" + history_text

        # 调用 LLM 总结
        client = LLMClient(
            base_url=provider_row["base_url"],
            api_key=provider_row["api_key"],
            model=provider_row["model"],
        )
        summary = await client.chat_once(
            [
                {"role": "system", "content": "你是一个对话摘要助手。请简洁准确地总结对话内容。"},
                {"role": "user", "content": prompt_text},
            ],
            timeout=SUMMARY_TIMEOUT,
        )

        if summary and not summary.startswith("[API 错误") and not summary.startswith("[请求异常"):
            # 把已注入的世界书 ID 追加到摘要中，方便压缩后重新注入
            injected_ids = _wb_injected.get(cid)
            if injected_ids:
                summary += "\n\n[世界书: " + ",".join(str(i) for i in injected_ids) + "]"
                # 清除注入标记，下次请求可重新匹配注入
                del _wb_injected[cid]
            # 存库
            conn.execute(
                "UPDATE conversations SET summary = ?, summary_updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                (summary.strip(), cid),
            )
            conn.commit()
            print(f"[AUTO-SUMMARY] 已更新对话 {cid} 的摘要: {len(summary)} chars")
        else:
            print(f"[AUTO-SUMMARY] 总结失败: {summary[:100] if summary else '空'}")

    except Exception as e:
        print(f"[AUTO-SUMMARY] 异常: {e}")


def _stream_response(messages: list[dict], provider, cid: str, tools: list | None = None,
                     user_msg_id: str | None = None, user_text: str | None = None,
                     user_image_urls: list[str] | None = None,
                     user_files: list[dict] | None = None,
                     injected_entries: list = None):
    """
    创建 SSE StreamingResponse。
    支持工具调用链：stream → tool_calls → 执行 → stream → tool_calls → ... → 最终文字 → done
    在 done 事件中一并保存 user 消息（如为新发）和 assistant 回复到 DB。
    """
    client = LLMClient(
        base_url=provider["base_url"],
        api_key=provider["api_key"],
        model=provider["model"],
    )

    async def event_stream():
        assistant_msg_id = str(uuid.uuid4())[:8]
        current_messages = list(messages)
        tool_calls_log = []  # 收集工具调用详情，最终存入 DB

        # 先发送世界书注入通知（如有新注入）
        if injected_entries:
            yield f"data: {json.dumps({'type': 'worldbook_injected', 'entries': injected_entries}, ensure_ascii=False)}\n\n"

        while True:
            full_reply = ""
            tool_calls_result = None

            # 每次循环都用新的流式请求（携带之前的对话+tools）
            async for event in client.chat_stream(current_messages, tools=tools):
                if event["type"] == "token":
                    full_reply += event["content"]
                    yield f"data: {json.dumps({'type': 'token', 'content': event['content']}, ensure_ascii=False)}\n\n"
                elif event["type"] == "tool_calls":
                    tool_calls_result = event["calls"]
                    yield f"data: {json.dumps({'type': 'tool_status', 'content': '🔧 正在操作纸片…'}, ensure_ascii=False)}\n\n"
                elif event["type"] == "done":
                    if not tool_calls_result:
                        full_reply = event["content"]
                elif event["type"] == "error":
                    yield f"data: {json.dumps({'type': 'error', 'content': event['content']}, ensure_ascii=False)}\n\n"
                    # 出错时也尝试触发总结（避免对话无限增长）
                    if ENABLE_AUTO_SUMMARY:
                        asyncio.create_task(_maybe_summarize_conversation(cid, provider))
                    return

            # 没有工具调用 → 结束循环
            if not tool_calls_result:
                break

            # 有工具调用：将 AI 回复（文字 + tool_calls）追加到消息列表
            tc_msg = {"role": "assistant"}
            if full_reply:
                tc_msg["content"] = full_reply
            tc_msg["tool_calls"] = []
            for tc in tool_calls_result:
                tc_msg["tool_calls"].append({
                    "id": tc["id"],
                    "type": "function",
                    "function": {"name": tc["name"], "arguments": tc["arguments"]}
                })
            current_messages.append(tc_msg)

            # 执行每个工具，结果追加到消息列表
            for tc in tool_calls_result:
                args = json.loads(tc.get("arguments", "{}") or "{}")
                conn2 = get_connection()

                # 通知前端：工具开始执行
                yield f"data: {json.dumps({'type': 'tool_call_start', 'tool_name': tc['name'], 'arguments': tc.get('arguments', '{}')}, ensure_ascii=False)}\n\n"

                if tc["name"] in ("fetch_webpage", "search_web", "view_image"):
                    # 网络请求放线程池，不阻塞事件循环
                    result = await asyncio.to_thread(execute_web_tool, tc["name"], args, provider)
                elif tc["name"] in ("list_uploaded_files", "read_uploaded_file"):
                    result = execute_file_tool(tc["name"], args, conn2, conversation_id=cid)
                elif tc["name"] in ("search_library", "read_library_entry", "write_library_entry", "list_library_folders", "delete_library_entry", "update_library_entry"):
                    result = execute_library_tool(tc["name"], args)
                else:
                    result = execute_wb_tool(
                        tc["name"],
                        args,
                        conn2,
                        conversation_id=cid,
                        user_message=user_text,
                    )

                # 向前端发送工具调用详情（含结果）
                yield f"data: {json.dumps({'type': 'tool_call', 'tool_name': tc['name'], 'arguments': tc.get('arguments', '{}'), 'result': result}, ensure_ascii=False)}\n\n"
                tool_calls_log.append({
                    "name": tc["name"],
                    "arguments": tc.get("arguments", "{}"),
                    "result": result,
                })
                current_messages.append({
                    "role": "tool",
                    "tool_call_id": tc["id"],
                    "content": result,
                })

            # 继续循环 → 再次调 AI（tools 仍在，AI 可继续调用链）

        # done：存库（用户消息已在 chat_stream 中预存，这里只存 assistant）
        conn2 = get_connection()
        tool_calls_json = json.dumps(tool_calls_log, ensure_ascii=False) if tool_calls_log else None
        conn2.execute(
            "INSERT INTO messages (id, conversation_id, role, content, tool_calls) VALUES (?, ?, 'assistant', ?, ?)",
            (assistant_msg_id, cid, full_reply, tool_calls_json),
        )
        conn2.execute(
            "UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (cid,),
        )
        conn2.commit()
        payload = {
            "type": "done",
            "message_id": assistant_msg_id,
        }
        if user_msg_id:
            payload["user_message_id"] = user_msg_id
        if user_image_urls:
            payload["user_image_urls"] = user_image_urls
        if user_files:
            payload["user_files"] = user_files
        yield f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"

        # ★ 流式完成，后台触发自动总结（不阻塞用户）
        if ENABLE_AUTO_SUMMARY:
            asyncio.create_task(_maybe_summarize_conversation(cid, provider))

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/chat/{cid}")
async def chat_stream(cid: str, body: ChatRequest):
    """
    发送消息 → SSE 流式回复。
    先存用户消息到 DB，再开始流式。即使 AI 回复失败，用户消息不会丢失。
    """
    conn = get_connection()
    conv = conn.execute(
        "SELECT * FROM conversations WHERE id = ?", (cid,)
    ).fetchone()
    if not conv:
        raise HTTPException(404, "对话不存在")

    # 生成用户消息 ID
    msg_id = str(uuid.uuid4())[:8]

    provider, _ = _resolve_provider(conn, body.provider_id)
    msgs, tools, injected = _build_chat_messages(conn, cid, body.message, source_msg_id=msg_id, world_entry_ids=body.world_entry_ids)

    # 处理文件附件：提取文本内容加到用户消息前面
    file_context = ""
    if body.files:
        for f in body.files:
            filepath = os.path.join(FRONTEND_DIR, f["url"].lstrip("/"))
            if os.path.isfile(filepath):
                text = _extract_file_text(filepath, f.get("type", ""), f.get("name", ""))
                file_context += f"\n--- {f['name']} ---\n{text}\n"
        if file_context:
            prefix = f"[用户上传了以下文件：]\n{file_context.strip()}\n\n"
            if msgs and msgs[-1]["role"] == "user":
                existing = msgs[-1]["content"]
                if isinstance(existing, str):
                    msgs[-1]["content"] = prefix + existing

    # 收集所有图片（兼容旧版单图 image + 新版多图 images）
    all_images = []
    if body.image:
        all_images.append(body.image)
    if body.images:
        all_images.extend(body.images)

    if all_images and msgs and msgs[-1]["role"] == "user":
        content_parts = [{"type": "text", "text": msgs[-1]["content"]}]
        for b64_img in all_images:
            content_parts.append({"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64_img}"}})
        msgs[-1]["content"] = content_parts

    # ★ 先存用户消息到 DB，再开始流式。这样即使 AI 流式失败（超时/报错），
    #   用户的消息也不会丢失。
    #   只存纯用户文字（不带文件文本），文件内容在构建 AI 上下文时从 files 列读取。
    save_content = body.message
    # 保存所有图片
    user_image_urls = []
    if all_images:
        for b64_img in all_images:
            url = _save_image_file(b64_img, msg_id)
            if url:
                user_image_urls.append(url)
    image_path_json = json.dumps(user_image_urls, ensure_ascii=False) if user_image_urls else None
    files_json = json.dumps(body.files, ensure_ascii=False) if body.files else None
    conn.execute(
        "INSERT INTO messages (id, conversation_id, role, content, image_path, files) VALUES (?, ?, 'user', ?, ?, ?)",
        (msg_id, cid, save_content, image_path_json, files_json),
    )
    conn.execute(
        "UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        (cid,),
    )
    conn.commit()

    return _stream_response(msgs, provider, cid, tools=tools,
                            user_msg_id=msg_id, user_text=body.message,
                            user_image_urls=user_image_urls, user_files=body.files,
                            injected_entries=injected)


@router.post("/chat/{cid}/regenerate")
async def regenerate(cid: str, body: ChatRequest):
    """
    重新生成回复。

    常规场景（user_msg_id 为空）：
      删除最后一条 assistant 消息 → 取最后一条用户消息 → SSE 流式回复。

    编辑场景（user_msg_id 指定了被编辑的用户消息）：
      删除该用户消息之后的 assistant 消息 → 用该用户消息的内容 → SSE 流式回复。
      避免误删编辑位置之前的 assistant。
    """
    conn = get_connection()
    conv = conn.execute(
        "SELECT * FROM conversations WHERE id = ?", (cid,)
    ).fetchone()
    if not conv:
        raise HTTPException(404, "对话不存在")

    if body.user_msg_id:
        # 编辑场景：只删指定用户消息之后的 assistant，不碰前面的
        edited = conn.execute(
            "SELECT created_at, content, files, image_path FROM messages WHERE id = ? AND conversation_id = ?",
            (body.user_msg_id, cid),
        ).fetchone()
        if not edited:
            raise HTTPException(404, "要重新生成的消息不存在")
        conn.execute(
            """DELETE FROM messages
               WHERE conversation_id = ? AND id != ?
               AND created_at > ?""",
            (cid, body.user_msg_id, edited["created_at"]),
        )
        conn.commit()
        # 编辑场景：清除本条消息触发的世界书注入，重新注入
        conn.execute(
            """DELETE FROM messages
               WHERE conversation_id = ? AND role = 'system' AND content LIKE ?""",
            (cid, '%msg:' + body.user_msg_id + '%'),
        )
        conn.commit()
        user_text = edited["content"]
        user_files_raw = edited["files"]
    else:
        # 常规场景：删除最后一条 assistant
        last_assistant = conn.execute(
            """SELECT id FROM messages
               WHERE conversation_id = ? AND role = 'assistant'
               ORDER BY created_at DESC LIMIT 1""",
            (cid,),
        ).fetchone()
        if last_assistant:
            conn.execute("DELETE FROM messages WHERE id = ?", (last_assistant["id"],))
            conn.commit()

        # 取最后一条用户消息（含 files 字段）
        last_user = conn.execute(
            """SELECT content, files, image_path FROM messages
               WHERE conversation_id = ? AND role = 'user'
               ORDER BY created_at DESC LIMIT 1""",
            (cid,),
        ).fetchone()
        if not last_user:
            raise HTTPException(400, "没有找到用户消息，无法重新生成")
        user_text = last_user["content"]
        user_files_raw = last_user["files"]

    # 新格式消息：content 是纯文字，文件内容在 files 列中，需要拼回来
    if user_files_raw and user_text and not user_text.startswith("[用户上传了以下文件：]"):
        try:
            user_files = json.loads(user_files_raw) if isinstance(user_files_raw, str) else (user_files_raw or [])
            file_context = ""
            for f in user_files:
                fp = os.path.join(FRONTEND_DIR, f.get("url", "").lstrip("/"))
                if os.path.isfile(fp):
                    text_content = _extract_file_text(fp, f.get("type", ""), f.get("name", ""))
                    file_context += f"\n--- {f['name']} ---\n{text_content}\n"
            if file_context:
                user_text = f"[用户上传了以下文件：]\n{file_context.strip()}\n\n{user_text}"
        except Exception:
            pass

    # 加载用户消息中的图片（让 AI 重新看到图）
    user_image_urls = []
    if body.user_msg_id:
        if edited["image_path"]:
            try:
                user_image_urls = json.loads(edited["image_path"]) if isinstance(edited["image_path"], str) else (edited["image_path"] or [])
            except Exception:
                pass
    else:
        if last_user["image_path"]:
            try:
                user_image_urls = json.loads(last_user["image_path"]) if isinstance(last_user["image_path"], str) else (last_user["image_path"] or [])
            except Exception:
                pass

    provider, _ = _resolve_provider(conn, body.provider_id)
    msgs, tools, injected = _build_chat_messages(conn, cid, user_text, exclude_last_user=True, source_msg_id=body.user_msg_id)

    # 如果编辑的消息有图片，把图片 base64 塞进最后一条 user 消息
    if user_image_urls and msgs and msgs[-1]["role"] == "user":
        content_parts = [{"type": "text", "text": msgs[-1]["content"]}]
        for url in user_image_urls:
            fp = os.path.join(FRONTEND_DIR, url.lstrip("/"))
            if os.path.isfile(fp):
                with open(fp, "rb") as f:
                    b64 = base64.b64encode(f.read()).decode("utf-8")
                ext = url.rsplit(".", 1)[-1].lower()
                mime = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "gif": "image/gif", "webp": "image/webp"}.get(ext, "image/jpeg")
                content_parts.append({"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}"}})
        msgs[-1]["content"] = content_parts

    return _stream_response(msgs, provider, cid, tools=tools,
                            user_image_urls=user_image_urls, injected_entries=injected)
