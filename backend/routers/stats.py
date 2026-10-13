"""
Dashboard stats API — 今日消息数、今日新增、热力图数据、图片历史
"""

import json
from fastapi import APIRouter, Query
from database import get_connection

router = APIRouter(prefix="/api", tags=["stats"])


@router.get("/stats")
def get_stats():
    conn = get_connection()

    today = conn.execute(
        "SELECT COUNT(*) AS cnt FROM messages WHERE date(created_at) = date('now')"
    ).fetchone()
    today_messages = today["cnt"] if today else 0

    today_lib = conn.execute(
        "SELECT COUNT(*) AS cnt FROM cheese_library WHERE date(created_at) = date('now')"
    ).fetchone()
    today_library = today_lib["cnt"] if today_lib else 0

    today_wb = conn.execute(
        "SELECT COUNT(*) AS cnt FROM world_entries WHERE date(created_at) = date('now')"
    ).fetchone()
    today_worldbook = today_wb["cnt"] if today_wb else 0

    daily = conn.execute(
        """SELECT date(created_at) AS date, COUNT(*) AS count
        FROM messages
        WHERE created_at >= date('now', '-365 days')
        GROUP BY date(created_at)
        ORDER BY date ASC"""
    ).fetchall()

    return {
        "todayMessages": today_messages,
        "todayLibrary": today_library,
        "todayWorldbook": today_worldbook,
        "dailyMessages": [dict(d) for d in daily],
    }


@router.get("/stats/images")
def list_images(limit: int = Query(100, ge=1, le=500), offset: int = Query(0, ge=0)):
    """列出所有用户发过的图片，按时间倒序，支持分页"""
    conn = get_connection()
    rows = conn.execute(
        """SELECT image_path, created_at, conversation_id FROM messages
           WHERE image_path IS NOT NULL AND image_path != ''
           ORDER BY created_at DESC
           LIMIT ? OFFSET ?""",
        (limit, offset),
    ).fetchall()

    results = []
    for r in rows:
        raw = r["image_path"]
        if not raw:
            continue
        try:
            urls = json.loads(raw) if isinstance(raw, str) else raw
        except (json.JSONDecodeError, TypeError):
            urls = [raw]

        if isinstance(urls, list):
            for url in urls:
                if url:
                    results.append({
                        "url": url,
                        "created_at": r["created_at"],
                        "conversation_id": r["conversation_id"],
                    })
        elif urls:
            results.append({
                "url": str(urls),
                "created_at": r["created_at"],
                "conversation_id": r["conversation_id"],
            })

    return results
