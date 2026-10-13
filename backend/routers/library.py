"""
🧀 奶酪图书馆 CRUD
存储你复制来的原文，AI 可以自由读写查询
"""

import uuid
import json
import re
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from database import get_connection

router = APIRouter(prefix="/api/library", tags=["library"])


# ─── 模型 ──────────────────────────────────

class LibraryEntryCreate(BaseModel):
    title: str
    content: str
    source_url: str = ""
    folder: str = ""


class LibraryEntryUpdate(BaseModel):
    title: str | None = None
    content: str | None = None
    source_url: str | None = None
    folder: str | None = None


# ─── 工具函数 ──────────────────────────────

def _row_to_dict(row) -> dict:
    return {
        "id": row["id"],
        "title": row["title"],
        "content": row["content"],
        "source_url": row["source_url"],
        "folder": row["folder"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


# ─── CRUD ──────────────────────────────────

@router.get("/entries")
def list_entries(folder: str = ""):
    """列出所有条目，可按文件夹筛选"""
    conn = get_connection()
    if folder:
        rows = conn.execute(
            "SELECT * FROM cheese_library WHERE folder = ? ORDER BY updated_at DESC",
            (folder,),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM cheese_library ORDER BY updated_at DESC"
        ).fetchall()
    return [_row_to_dict(r) for r in rows]


@router.get("/entries/{eid}")
def get_entry(eid: str):
    """获取单条条目"""
    conn = get_connection()
    row = conn.execute(
        "SELECT * FROM cheese_library WHERE id = ?", (eid,)
    ).fetchone()
    if not row:
        raise HTTPException(404, "条目不存在")
    return _row_to_dict(row)


@router.post("/entries")
def create_entry(body: LibraryEntryCreate):
    """新建条目"""
    if not body.title or not body.content:
        raise HTTPException(400, "标题和内容不能为空")

    eid = str(uuid.uuid4())[:8]
    conn = get_connection()
    conn.execute(
        """INSERT INTO cheese_library (id, title, content, source_url, folder)
           VALUES (?, ?, ?, ?, ?)""",
        (eid, body.title.strip(), body.content.strip(), body.source_url.strip(), body.folder.strip()),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM cheese_library WHERE id = ?", (eid,)).fetchone()
    return _row_to_dict(row)


@router.put("/entries/{eid}")
def update_entry(eid: str, body: LibraryEntryUpdate):
    """编辑条目（部分更新）"""
    conn = get_connection()
    existing = conn.execute(
        "SELECT * FROM cheese_library WHERE id = ?", (eid,)
    ).fetchone()
    if not existing:
        raise HTTPException(404, "条目不存在")

    updates = {}
    if body.title is not None:
        updates["title"] = body.title.strip()
    if body.content is not None:
        updates["content"] = body.content.strip()
    if body.source_url is not None:
        updates["source_url"] = body.source_url.strip()
    if body.folder is not None:
        updates["folder"] = body.folder.strip()

    if not updates:
        return _row_to_dict(existing)

    field_clauses = [f"{k} = ?" for k in updates] + ["updated_at = CURRENT_TIMESTAMP"]
    fields = ", ".join(field_clauses)
    values = list(updates.values()) + [eid]
    conn.execute(f"UPDATE cheese_library SET {fields} WHERE id = ?", values)
    conn.commit()
    row = conn.execute("SELECT * FROM cheese_library WHERE id = ?", (eid,)).fetchone()
    return _row_to_dict(row)


@router.delete("/entries/{eid}")
def delete_entry(eid: str):
    """删除条目"""
    conn = get_connection()
    existing = conn.execute(
        "SELECT * FROM cheese_library WHERE id = ?", (eid,)
    ).fetchone()
    if not existing:
        raise HTTPException(404, "条目不存在")
    conn.execute("DELETE FROM cheese_library WHERE id = ?", (eid,))
    conn.commit()
    return {"ok": True}


# ─── 文件夹 / 搜索 ─────────────────────────

@router.get("/folders")
def list_folders():
    """列出所有文件夹名"""
    conn = get_connection()
    rows = conn.execute(
        "SELECT DISTINCT folder FROM cheese_library WHERE folder != '' ORDER BY folder"
    ).fetchall()
    return [r["folder"] for r in rows]


@router.get("/search")
def search_entries(q: str = Query("", min_length=1)):
    """搜索标题和内容"""
    conn = get_connection()
    pattern = f"%{q}%"
    rows = conn.execute(
        """SELECT * FROM cheese_library
           WHERE title LIKE ? OR content LIKE ?
           ORDER BY updated_at DESC""",
        (pattern, pattern),
    ).fetchall()
    return [_row_to_dict(r) for r in rows]


# ─── 宝箱 ──────────────────────────

@router.get("/treasure-box")
def list_treasure():
    """列出所有宝箱条目"""
    conn = get_connection()
    rows = conn.execute(
        "SELECT id, content, created_at FROM treasure_box ORDER BY created_at DESC"
    ).fetchall()
    return [{"id": r["id"], "content": r["content"], "created_at": r["created_at"]} for r in rows]


@router.post("/treasure-box")
def create_treasure(body: dict):
    """写入一条宝箱"""
    content = body.get("content", "").strip()
    if not content:
        raise HTTPException(400, "内容不能为空")
    import uuid
    tid = str(uuid.uuid4())[:8]
    conn = get_connection()
    conn.execute(
        "INSERT INTO treasure_box (id, content) VALUES (?, ?)",
        (tid, content),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM treasure_box WHERE id = ?", (tid,)).fetchone()
    return {"id": row["id"], "content": row["content"], "created_at": row["created_at"]}


@router.delete("/treasure-box/{tid}")
def delete_treasure(tid: str):
    """删除一条宝箱"""
    conn = get_connection()
    existing = conn.execute("SELECT * FROM treasure_box WHERE id = ?", (tid,)).fetchone()
    if not existing:
        raise HTTPException(404, "条目不存在")
    conn.execute("DELETE FROM treasure_box WHERE id = ?", (tid,))
    conn.commit()
    return {"ok": True}
