"""
世界书 CRUD + 匹配测试
"""

import uuid
import json
from fastapi import APIRouter, HTTPException
from database import get_connection
from models import WorldEntryCreate, WorldEntryUpdate, MatchTestRequest
from services.worldbook_match import match_world_entries

router = APIRouter(prefix="/api/world-entries", tags=["worldbook"])


def _row_to_entry(row) -> dict:
    row_keys = row.keys()
    return {
        "id": row["id"],
        "title": row["title"],
        "content": row["content"],
        "summary": row["summary"] if "summary" in row_keys and row["summary"] else "",
        "keywords": row["keywords"],
        "enabled": bool(row["enabled"]),
        "priority": row["priority"],
        "category": row["category"],
        "subcategory": row["subcategory"] if "subcategory" in row_keys and row["subcategory"] else "",
        "position": row["position"],
        "type": row["type"] if "type" in row_keys and row["type"] else "note",
        "hit_count": row["hit_count"] if "hit_count" in row_keys else 0,
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


@router.get("")
def list_entries(type: str = None, category: str = None, parent_category: str = None):
    conn = get_connection()
    sql = "SELECT * FROM world_entries WHERE 1=1"
    params = []
    if type:
        sql += " AND type = ?"
        params.append(type)
    if category:
        sql += " AND category = ?"
        params.append(category)
    if parent_category:
        sql += " AND (category = ? OR category LIKE ?)"
        params.append(parent_category)
        params.append(parent_category + "/%")
    sql += " ORDER BY priority DESC, created_at DESC"
    rows = conn.execute(sql, params).fetchall()
    return [_row_to_entry(r) for r in rows]


@router.get("/categories")
def list_categories():
    """返回分类树：父分类 + 子分类 + 各自条目数"""
    conn = get_connection()
    # 父分类统计（category != '' 且 subcategory == ''）
    parent_rows = conn.execute(
        """SELECT category, COUNT(*) as cnt FROM world_entries
           WHERE category != '' GROUP BY category ORDER BY category"""
    ).fetchall()

    # 子分类统计（subcategory != ''）
    sub_rows = conn.execute(
        """SELECT category, subcategory, COUNT(*) as cnt FROM world_entries
           WHERE subcategory != '' GROUP BY category, subcategory ORDER BY category, subcategory"""
    ).fetchall()

    # 构建父分类 -> 子分类映射
    sub_map = {}
    for r in sub_rows:
        parent = r["category"]
        if parent not in sub_map:
            sub_map[parent] = []
        sub_map[parent].append({
            "name": r["subcategory"],
            "count": r["cnt"],
        })

    result = []
    for r in parent_rows:
        parent_name = r["category"]
        total = r["cnt"]
        subs = sub_map.get(parent_name, [])
        # 如果父分类计数包含子分类条目，减去子分类的重复计数
        # 但这里 category 分组本身就按 category 算，不包含 subcategory 的额外影响
        result.append({
            "name": parent_name,
            "count": total,
            "subcategories": subs,
        })

    return sorted(result, key=lambda x: x["name"])


@router.get("/{eid}")
def get_entry(eid: str):
    conn = get_connection()
    row = conn.execute("SELECT * FROM world_entries WHERE id = ?", (eid,)).fetchone()
    if not row:
        raise HTTPException(404, "条目不存在")
    return _row_to_entry(row)


@router.post("")
def create_entry(body: WorldEntryCreate):
    conn = get_connection()
    eid = str(uuid.uuid4())[:8]
    keywords_json = json.dumps(body.keywords, ensure_ascii=False)
    conn.execute(
        """INSERT INTO world_entries (id, title, content, summary, keywords, enabled, priority, category, subcategory, position, type)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (eid, body.title, body.content, body.summary, keywords_json, int(body.enabled),
         body.priority, body.category, body.subcategory, body.position, body.type),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM world_entries WHERE id = ?", (eid,)).fetchone()
    return _row_to_entry(row)


@router.put("/{eid}")
def update_entry(eid: str, body: WorldEntryUpdate):
    conn = get_connection()
    existing = conn.execute("SELECT * FROM world_entries WHERE id = ?", (eid,)).fetchone()
    if not existing:
        raise HTTPException(404, "条目不存在")

    updates = body.model_dump(exclude_unset=True)
    if not updates:
        return _row_to_entry(existing)

    # keywords 是 list[str] → 序列化
    if "keywords" in updates and isinstance(updates["keywords"], list):
        updates["keywords"] = json.dumps(updates["keywords"], ensure_ascii=False)
    if "enabled" in updates:
        updates["enabled"] = int(updates["enabled"])

    fields = ", ".join(f"{k} = ?" for k in updates)
    values = list(updates.values()) + [eid]
    conn.execute(f"UPDATE world_entries SET {fields} WHERE id = ?", values)
    conn.commit()
    row = conn.execute("SELECT * FROM world_entries WHERE id = ?", (eid,)).fetchone()
    return _row_to_entry(row)


@router.delete("/{eid}")
def delete_entry(eid: str):
    conn = get_connection()
    existing = conn.execute("SELECT * FROM world_entries WHERE id = ?", (eid,)).fetchone()
    if not existing:
        raise HTTPException(404, "条目不存在")
    conn.execute("DELETE FROM world_entries WHERE id = ?", (eid,))
    conn.commit()
    return {"ok": True}


@router.post("/test-match")
def test_match(body: MatchTestRequest):
    entries = match_world_entries(body.text)
    return {"matched_entries": entries}
