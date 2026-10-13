"""
API 线路 CRUD
"""

import uuid
from fastapi import APIRouter, HTTPException
from database import get_connection
from models import ProviderCreate, ProviderUpdate, ProviderResponse

router = APIRouter(prefix="/api/providers", tags=["providers"])


def _row_to_provider(row) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "base_url": row["base_url"],
        "api_key": row["api_key"],
        "model": row["model"],
        "is_default": bool(row["is_default"]),
        "created_at": row["created_at"],
    }


@router.get("")
def list_providers():
    conn = get_connection()
    rows = conn.execute("SELECT * FROM api_providers ORDER BY created_at DESC").fetchall()
    return [_row_to_provider(r) for r in rows]


@router.post("")
def create_provider(body: ProviderCreate):
    conn = get_connection()
    pid = str(uuid.uuid4())[:8]
    conn.execute(
        "INSERT INTO api_providers (id, name, base_url, api_key, model) VALUES (?, ?, ?, ?, ?)",
        (pid, body.name, body.base_url.rstrip("/"), body.api_key, body.model),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM api_providers WHERE id = ?", (pid,)).fetchone()
    return _row_to_provider(row)


@router.put("/{pid}")
def update_provider(pid: str, body: ProviderUpdate):
    conn = get_connection()
    existing = conn.execute("SELECT * FROM api_providers WHERE id = ?", (pid,)).fetchone()
    if not existing:
        raise HTTPException(404, "线路不存在")

    updates = body.model_dump(exclude_unset=True)
    if not updates:
        return _row_to_provider(existing)

    # 保证 base_url 末尾无斜杠（提前处理，避免两次 SQL）
    if "base_url" in updates:
        updates["base_url"] = updates["base_url"].rstrip("/")

    fields = ", ".join(f"{k} = ?" for k in updates)
    values = list(updates.values()) + [pid]
    conn.execute(f"UPDATE api_providers SET {fields} WHERE id = ?", values)
    conn.commit()
    row = conn.execute("SELECT * FROM api_providers WHERE id = ?", (pid,)).fetchone()
    return _row_to_provider(row)


@router.delete("/{pid}")
def delete_provider(pid: str):
    conn = get_connection()
    existing = conn.execute("SELECT * FROM api_providers WHERE id = ?", (pid,)).fetchone()
    if not existing:
        raise HTTPException(404, "线路不存在")
    conn.execute("DELETE FROM api_providers WHERE id = ?", (pid,))
    conn.commit()
    return {"ok": True}


@router.post("/{pid}/set-default")
def set_default_provider(pid: str):
    conn = get_connection()
    existing = conn.execute("SELECT * FROM api_providers WHERE id = ?", (pid,)).fetchone()
    if not existing:
        raise HTTPException(404, "线路不存在")
    conn.execute("UPDATE api_providers SET is_default = 0")
    conn.execute("UPDATE api_providers SET is_default = 1 WHERE id = ?", (pid,))
    conn.commit()
    return _row_to_provider(existing)
