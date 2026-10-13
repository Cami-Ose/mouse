"""
GPT 聊天记录导入接口
1. POST /api/import/gpt-preview      上传 JSON（纯文本），返回会话预览
2. POST /api/import/gpt-upload       上传 ZIP/JSON 文件（multipart），支持图片
3. POST /api/import/gpt-execute      传入要导入的会话下标，写入 DB
"""

import json
import os
import uuid
import tempfile
import zipfile
import shutil
import base64
from fastapi import APIRouter, HTTPException, UploadFile, File
from pydantic import BaseModel
from database import get_connection
from config import FRONTEND_DIR

router = APIRouter(prefix="/api/import", tags=["import"])

# ─── 内存暂存 ──────────────────────────────
_gpt_sessions: dict[str, dict] = {}


# ─── 模型 ──────────────────────────────────

class PreviewRequest(BaseModel):
    data: str  # JSON 文件内容


class ExecuteRequest(BaseModel):
    session_id: str
    selected_indices: list[int]


# ─── 工具函数 ──────────────────────────────

def _parse_gpt_conversations(raw: str) -> list[dict]:
    data = json.loads(raw)
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        for key in ("conversations", "data", "items"):
            if key in data:
                return data[key]
    raise ValueError("无法识别的 JSON 结构")


def _extract_asset_file_id(asset_pointer: str) -> str | None:
    """从 'sediment://file_XXXXXXXXXX' 提取 file_XXXXXXXXXX"""
    if asset_pointer and asset_pointer.startswith("sediment://file_"):
        return asset_pointer[len("sediment://"):]
    return None


def _save_image_from_dat(dat_path: str, msg_id: str) -> str | None:
    """将 .dat 文件（实际是图片）复制到 uploads/ 目录，返回 URL 路径。"""
    if not os.path.isfile(dat_path):
        return None
    try:
        with open(dat_path, "rb") as f:
            image_data = f.read()
        if len(image_data) < 8:
            return None
        # 探测格式
        if image_data[:3] == b"\xff\xd8\xff":
            ext = "jpg"
        elif image_data[:4] == b"\x89PNG":
            ext = "png"
        elif image_data[:6] in (b"GIF87a", b"GIF89a"):
            ext = "gif"
        elif image_data[:4] == b"RIFF" and image_data[8:12] == b"WEBP":
            ext = "webp"
        elif image_data[:2] == b"BM":
            ext = "bmp"
        else:
            return None  # 不是可识别的图片格式

        # 写到 uploads/
        upload_dir = os.path.join(FRONTEND_DIR, "uploads")
        os.makedirs(upload_dir, exist_ok=True)
        filename = f"gpt_import_{msg_id}.{ext}"
        dest = os.path.join(upload_dir, filename)
        with open(dest, "wb") as f:
            f.write(image_data)
        return f"/uploads/{filename}"
    except Exception:
        return None


def _walk_messages(conv: dict) -> list[dict]:
    """全部消息，按时间排序（用于预览计数对比）"""
    mapping = conv.get("mapping", {})
    if not mapping:
        return []

    raw = []
    for node in mapping.values():
        msg = node.get("message")
        if msg is None:
            continue
        role = msg.get("author", {}).get("role", "")
        if role not in ("user", "assistant"):
            continue
        ct = msg.get("create_time")
        if ct is None:
            continue
        parts = msg.get("content", {}).get("parts", [])
        text_parts = []
        for p in parts:
            if isinstance(p, str):
                text_parts.append(p)
            elif isinstance(p, dict):
                if p.get("content_type") == "audio_transcription":
                    text_parts.append(p.get("text", ""))
        text = "\n".join(text_parts).strip()
        if not text:
            continue
        raw.append({"role": role, "content": text, "created_at": ct})

    raw.sort(key=lambda m: m["created_at"])
    return raw


def _walk_longest_branch(conv: dict) -> list[dict]:
    """从 mapping 树中找到最长的单一分支，返回消息列表。
    每条消息额外包含 image_assets（如果有图片引用）"""
    mapping = conv.get("mapping", {})
    if not mapping:
        return []

    all_children = set()
    for node in mapping.values():
        for child_id in node.get("children") or []:
            if child_id:
                all_children.add(child_id)

    leaf_ids = [nid for nid in mapping if nid not in all_children]
    if not leaf_ids:
        return []

    best_path = []
    for leaf_id in leaf_ids:
        path = []
        cur = leaf_id
        while cur:
            node = mapping.get(cur)
            if not node:
                break
            msg = node.get("message")
            if msg:
                role = msg.get("author", {}).get("role", "")
                if role in ("user", "assistant"):
                    ct = msg.get("create_time")
                    if ct is not None:
                        parts = msg.get("content", {}).get("parts", [])
                        text_parts = []
                        image_assets = []
                        for p in parts:
                            if isinstance(p, str):
                                text_parts.append(p)
                            elif isinstance(p, dict):
                                ct2 = p.get("content_type", "")
                                if ct2 == "audio_transcription":
                                    text_parts.append(p.get("text", ""))
                                elif ct2 == "image_asset_pointer":
                                    asset_id = _extract_asset_file_id(p.get("asset_pointer", ""))
                                    if asset_id:
                                        image_assets.append(asset_id)
                        text = "\n".join(text_parts).strip()
                        entry = {
                            "role": role,
                            "content": text,
                            "created_at": ct,
                        }
                        if image_assets:
                            entry["image_assets"] = image_assets
                        path.append(entry)
            cur = node.get("parent")

        path.reverse()
        if len(path) > len(best_path):
            best_path = path

    return best_path


def _ts_to_sqlite(ts: float | None) -> str | None:
    if ts is None:
        return None
    from datetime import datetime
    return datetime.fromtimestamp(ts).strftime("%Y-%m-%d %H:%M:%S")


# ─── 接口：JSON 文本上传 ──────────────────

@router.post("/gpt-preview")
def preview_gpt(body: PreviewRequest):
    try:
        conversations = _parse_gpt_conversations(body.data)
    except (json.JSONDecodeError, ValueError) as e:
        raise HTTPException(400, f"JSON 解析失败: {e}")

    return _build_preview(conversations, session_data=None)


# ─── 接口：文件上传（ZIP / JSON）──────────

@router.post("/gpt-upload")
async def upload_gpt(file: UploadFile = File(...)):
    """接收 ZIP 或 JSON 文件，提取内容并返回预览"""
    if not file.filename:
        raise HTTPException(400, "未选择文件")

    # 保存上传的文件
    tmp_dir = tempfile.mkdtemp(prefix="gpt_import_")
    tmp_path = os.path.join(tmp_dir, file.filename)
    try:
        content = await file.read()
        with open(tmp_path, "wb") as f:
            f.write(content)
    except Exception as e:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        raise HTTPException(400, f"文件保存失败: {e}")

    # 判断类型
    ext = os.path.splitext(file.filename)[1].lower()
    conversations = None
    asset_map = {}

    if ext == ".zip":
        # 解压 ZIP
        try:
            with zipfile.ZipFile(tmp_path, "r") as zf:
                zf.extractall(tmp_dir)
        except Exception as e:
            shutil.rmtree(tmp_dir, ignore_errors=True)
            raise HTTPException(400, f"ZIP 解压失败: {e}")

        # 找 conversations JSON
        json_file = None
        for fname in os.listdir(tmp_dir):
            if fname.startswith("conversations-") and fname.endswith(".json"):
                json_file = fname
                break
        if not json_file:
            shutil.rmtree(tmp_dir, ignore_errors=True)
            raise HTTPException(400, "ZIP 中未找到 conversations-*.json")

        json_path = os.path.join(tmp_dir, json_file)
        with open(json_path, "r", encoding="utf-8") as f:
            raw = f.read()
        conversations = _parse_gpt_conversations(raw)

        # 读 asset 映射
        asset_path = os.path.join(tmp_dir, "conversation_asset_file_names.json")
        if os.path.isfile(asset_path):
            with open(asset_path, "r", encoding="utf-8") as f:
                asset_map = json.load(f)

    elif ext == ".json":
        with open(tmp_path, "r", encoding="utf-8") as f:
            raw = f.read()
        conversations = _parse_gpt_conversations(raw)

    else:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        raise HTTPException(400, "仅支持 .json 或 .zip 文件")

    if not conversations:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        raise HTTPException(400, "未解析到对话数据")

    session_data = {
        "tmp_dir": tmp_dir,
        "asset_map": asset_map,
        "file_ext": ext,
    }

    return _build_preview(conversations, session_data)


def _build_preview(conversations: list[dict], session_data: dict | None) -> dict:
    """构建预览响应并存入 session"""
    session_id = str(uuid.uuid4())[:12]
    preview_list = []

    for idx, conv in enumerate(conversations):
        title = conv.get("title") or "(无标题)"
        messages = _walk_longest_branch(conv)
        if not messages:
            continue
        user_count = sum(1 for m in messages if m["role"] == "user")
        assistant_count = sum(1 for m in messages if m["role"] == "assistant")
        first_msg = messages[0]["content"][:80] if messages else ""
        # 是否有图片
        has_images = any("image_assets" in m for m in messages)

        preview_list.append({
            "index": idx,
            "title": title,
            "user_count": user_count,
            "assistant_count": assistant_count,
            "total": len(messages),
            "first_msg": first_msg,
            "has_images": has_images,
        })

    # 暂存
    session_entry = {
        "conversations": conversations,
        "preview": preview_list,
    }
    if session_data:
        session_entry.update(session_data)

    _gpt_sessions[session_id] = session_entry

    return {
        "session_id": session_id,
        "conversations": preview_list,
        "total": len(preview_list),
    }


# ─── 接口：执行导入 ──────────────────────

@router.post("/gpt-execute")
def execute_import(body: ExecuteRequest):
    session = _gpt_sessions.get(body.session_id)
    if not session:
        raise HTTPException(404, "会话已过期，请重新上传")

    conversations = session["conversations"]
    tmp_dir = session.get("tmp_dir")  # 可能为 None（纯 JSON 上传）
    asset_map = session.get("asset_map", {})
    selected = body.selected_indices
    if not selected:
        raise HTTPException(400, "请选择至少一个要导入的会话")

    conn = get_connection()
    imported_ids = []

    for idx in selected:
        if idx < 0 or idx >= len(conversations):
            continue

        conv = conversations[idx]
        title = conv.get("title") or "(无标题)"
        mouse_title = f"📥 {title}" if not title.startswith("📥") else title

        messages = _walk_longest_branch(conv)
        if not messages:
            continue

        # 创建对话
        cid = str(uuid.uuid4())[:8]
        conn.execute(
            "INSERT INTO conversations (id, title) VALUES (?, ?)",
            (cid, mouse_title),
        )

        # 批量插入消息（含图片）
        for m in messages:
            mid = str(uuid.uuid4())[:8]
            created_at = _ts_to_sqlite(m.get("created_at")) or "CURRENT_TIMESTAMP"

            image_url = None
            # 如果有图片引用且我们有提取目录，复制图片
            image_assets = m.get("image_assets")
            if image_assets and tmp_dir:
                for asset_id in image_assets:
                    dat_path = os.path.join(tmp_dir, f"{asset_id}.dat")
                    if not os.path.isfile(dat_path):
                        # 也可能是直接用 asset_id 命名
                        dat_path = os.path.join(tmp_dir, asset_id)
                    if os.path.isfile(dat_path):
                        image_url = _save_image_from_dat(dat_path, mid)
                        break  # 只取第一张

            if image_url:
                conn.execute(
                    "INSERT INTO messages (id, conversation_id, role, content, image_path, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                    (mid, cid, m["role"], m["content"], image_url, created_at),
                )
            else:
                conn.execute(
                    "INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)",
                    (mid, cid, m["role"], m["content"], created_at),
                )

        conn.execute(
            "UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (cid,),
        )
        imported_ids.append(cid)

    conn.commit()

    # 清理临时目录
    if tmp_dir:
        shutil.rmtree(tmp_dir, ignore_errors=True)

    # 清理 session
    del _gpt_sessions[body.session_id]

    return {
        "imported": len(imported_ids),
        "conversation_ids": imported_ids,
    }


# ─── 接口：补图到已有对话 ─────────────────

@router.post("/gpt-patch-images/{conv_id}")
async def patch_images(conv_id: str, file: UploadFile = File(...)):
    """上传 GPT 导出 ZIP，将图片匹配并更新到已导入的对话中"""
    if not file.filename or not file.filename.lower().endswith('.zip'):
        raise HTTPException(400, "请上传 .zip 文件")

    # 保存 ZIP
    tmp_dir = tempfile.mkdtemp(prefix="gpt_patch_")
    tmp_path = os.path.join(tmp_dir, file.filename)
    try:
        content = await file.read()
        with open(tmp_path, "wb") as f:
            f.write(content)
    except Exception as e:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        raise HTTPException(400, f"文件保存失败: {e}")

    # 解压
    try:
        with zipfile.ZipFile(tmp_path, "r") as zf:
            zf.extractall(tmp_dir)
    except Exception as e:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        raise HTTPException(400, f"ZIP 解压失败: {e}")

    # 找 conversations JSON
    json_file = None
    for fname in os.listdir(tmp_dir):
        if fname.startswith("conversations-") and fname.endswith(".json"):
            json_file = fname
            break
    if not json_file:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        raise HTTPException(400, "ZIP 中未找到 conversations-*.json")

    with open(os.path.join(tmp_dir, json_file), "r", encoding="utf-8") as f:
        conversations = _parse_gpt_conversations(f.read())

    # 读 asset 映射
    asset_map = {}
    asset_path = os.path.join(tmp_dir, "conversation_asset_file_names.json")
    if os.path.isfile(asset_path):
        with open(asset_path, "r", encoding="utf-8") as f:
            asset_map = json.load(f)

    # 验证对话存在
    conn = get_connection()
    conv = conn.execute("SELECT id, title FROM conversations WHERE id = ?", (conv_id,)).fetchone()
    if not conv:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        raise HTTPException(404, "对话不存在")

    # 遍历每个 GPT 对话，尝试用 created_at 匹配消息
    patched = 0
    for gpt_conv in conversations:
        messages = _walk_longest_branch(gpt_conv)
        for m in messages:
            image_assets = m.get("image_assets")
            if not image_assets:
                continue
            # 按 created_at + role + content 前缀匹配 DB 消息
            ct = m["created_at"]
            if ct is None:
                continue
            # created_at 可能是毫秒级时间戳，DB 存的是格式化字符串
            # 先查这个对话里所有还没有 image_path 的消息
            rows = conn.execute(
                "SELECT id, created_at, content FROM messages WHERE conversation_id = ? AND image_path IS NULL AND role = ? ORDER BY created_at",
                (conv_id, m["role"]),
            ).fetchall()

            # 找匹配的消息：content 相同 或 created_at 时间戳匹配
            matched = None
            target_ts = _ts_to_sqlite(ct)
            for row in rows:
                if row["created_at"] == target_ts and row["content"] == m["content"]:
                    matched = row
                    break
            if not matched:
                # 宽松匹配：只看 content
                for row in rows:
                    if row["content"] == m["content"]:
                        matched = row
                        break

            if not matched:
                continue

            # 复制图片
            for asset_id in image_assets:
                dat_path = os.path.join(tmp_dir, f"{asset_id}.dat")
                if not os.path.isfile(dat_path):
                    dat_path = os.path.join(tmp_dir, asset_id)
                if os.path.isfile(dat_path):
                    image_url = _save_image_from_dat(dat_path, matched["id"])
                    if image_url:
                        conn.execute(
                            "UPDATE messages SET image_path = ? WHERE id = ?",
                            (image_url, matched["id"]),
                        )
                        patched += 1
                        break  # 每个消息只补一张图

    conn.commit()

    # 清理
    shutil.rmtree(tmp_dir, ignore_errors=True)

    return {
        "patched": patched,
        "conversation_id": conv_id,
    }
