"""
AI 可调用的世界书工具定义 + 执行
"""

import json
import re
import uuid
import sqlite3
from database import get_connection

# ─── 工具定义（OpenAI tool calling 格式）───────────

WORDBOOK_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "list_world_entries",
            "description": "列出世界书条目，可按分类/类型/启用状态筛选。用于全局盘点、整理和查看当前条目全貌。",
            "parameters": {
                "type": "object",
                "properties": {
                    "category": {
                        "type": "string",
                        "description": "分类名称过滤，如「重要事件」「自身」"
                    },
                    "type": {
                        "type": "string",
                        "enum": ["persona", "event", "project", "method", "note"],
                        "description": "条目类型过滤"
                    },
                    "enabled": {
                        "type": "boolean",
                        "description": "是否只返回启用的条目"
                    }
                }
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_world_entry",
            "description": "获取单个世界书条目的完整内容，包含标题/内容/关键词/分类/类型/优先级/创建和更新时间。适合精读事件条目或查看完整上下文。",
            "parameters": {
                "type": "object",
                "properties": {
                    "entry_id": {
                        "type": "string",
                        "description": "条目 ID"
                    }
                },
                "required": ["entry_id"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_world_entry_stats",
            "description": "查看世界书条目使用统计：总条目数、按命中次数排序的条目列表。用于了解哪些条目频繁使用、哪些从未命中。",
            "parameters": {
                "type": "object",
                "properties": {
                    "min_hits": {
                        "type": "integer",
                        "description": "只看命中次数 ≥ 此值的条目（可选，默认 0=全部）"
                    },
                    "sort_by": {
                        "type": "string",
                        "enum": ["hits_desc", "hits_asc", "priority"],
                        "description": "排序方式（默认按命中降序）"
                    }
                }
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "search_world_entries",
            "description": "按文本搜索世界书条目（标题/摘要/内容/关键词）",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "搜索关键词"
                    }
                },
                "required": ["query"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "create_world_entry",
            "description": "创建新的世界书条目",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "条目标题"},
                    "content": {"type": "string", "description": "条目内容"},
                    "summary": {"type": "string", "description": "条目摘要（简短概述，用于搜索和列表展示）"},
                    "keywords": {
                        "type": "array", "items": {"type": "string"},
                        "description": "触发关键词列表"
                    },
                    "priority": {
                        "type": "integer", "description": "优先级，越大越优先"
                    },
                    "category": {
                        "type": "string", "description": "父分类标签"
                    },
                    "subcategory": {
                        "type": "string", "description": "子分类（可选，放在父分类下）"
                    },
                    "type": {
                        "type": "string", "enum": ["persona", "event", "project", "method", "note"],
                        "description": "条目类型：persona=根条目, event=事件, project=项目, method=方法, note=笔记"
                    }
                },
                "required": ["title", "content", "keywords"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "update_world_entry",
            "description": "修改已有的世界书条目",
            "parameters": {
                "type": "object",
                "properties": {
                    "entry_id": {"type": "string", "description": "条目 ID"},
                    "title": {"type": "string"},
                    "content": {"type": "string"},
                    "summary": {"type": "string", "description": "条目摘要"},
                    "keywords": {"type": "array", "items": {"type": "string"}},
                    "category": {"type": "string", "description": "父分类名称"},
                    "subcategory": {"type": "string", "description": "子分类（可选）"},
                    "priority": {"type": "integer", "description": "优先级，越大越优先"},
                    "enabled": {"type": "boolean"},
                    "type": {
                        "type": "string", "enum": ["persona", "event", "project", "method", "note"],
                        "description": "条目类型：persona=根条目, event=事件, project=项目, method=方法, note=笔记"
                    }
                },
                "required": ["entry_id"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "delete_world_entry",
            "description": "删除世界书条目",
            "parameters": {
                "type": "object",
                "properties": {
                    "entry_id": {"type": "string", "description": "要删除的条目 ID"}
                },
                "required": ["entry_id"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "update_persona",
            "description": "仅在用户明确要求修改 persona/角色设定时使用。讨论、引用、询问或展示 persona 内容都不是修改请求；未明确要求时不要调用。修改会影响后续回复。",
            "parameters": {
                "type": "object",
                "properties": {
                    "persona": {
                        "type": "string",
                        "description": "完整的角色设定文本，描述助手应该以什么样的角色和方式与用户对话"
                    }
                },
                "required": ["persona"]
            }
        }
    }
]


# ─── 执行函数 ──────────────────────────────

def _row_to_dict(row: sqlite3.Row) -> dict:
    return {k: row[k] for k in row.keys()}


def _explicitly_requests_persona_update(user_message: str | None) -> bool:
    """只把当前用户明确提出的 persona 修改请求视为授权。"""
    if not user_message:
        return False
    text = user_message.lower()
    if re.search(r"(?:不是|并非|没有|不要|别|无需).{0,12}(?:persona|角色设定|角色設定|系统提示词|系统提示|system prompt)", text):
        return False
    markers = ("persona", "角色设定", "角色設定", "系统提示词", "系统提示", "system prompt")
    actions = ("修改", "更新", "改成", "重写", "替换", "设置", "设为", "调整", "change", "update", "rewrite", "set")
    return any(marker in text for marker in markers) and any(action in text for action in actions)


def execute_tool(
    tool_name: str,
    args: dict,
    conn,
    conversation_id: str | None = None,
    user_message: str | None = None,
) -> str:
    """
    执行世界书工具，返回给 AI 看的文本结果。
    所有增删改立即 commit。
    """
    if conn is None:
        conn = get_connection()

    if tool_name == "list_world_entries":
        sql = "SELECT * FROM world_entries WHERE 1=1"
        params = []
        if args.get("category"):
            sql += " AND category = ?"
            params.append(args["category"])
        if args.get("type"):
            sql += " AND type = ?"
            params.append(args["type"])
        if "enabled" in args:
            sql += " AND enabled = ?"
            params.append(int(args["enabled"]))
        sql += " ORDER BY priority DESC, created_at DESC"
        rows = conn.execute(sql, params).fetchall()
        if not rows:
            return "当前没有符合条件的条目"
        lines = [f"共 {len(rows)} 条（按优先级排序）："]
        for r in rows:
            flag = "✅" if r["enabled"] else "⛔"
            kw = ", ".join(json.loads(r["keywords"])) if r["keywords"] else ""
            created = r["created_at"][:16] if r["created_at"] else ""
            hits = r["hit_count"] if "hit_count" in r else 0
            summary_text = (r["summary"] or "")[:60]
            subcat = f" / {r['subcategory']}" if "subcategory" in r.keys() and r["subcategory"] else ""
            lines.append(f"  [{r['id']}] {flag} {r['title']}  (命中{hits}次)")
            lines.append(f"      分类: {r['category'] or '-'}{subcat}  类型: {r['type'] or 'note'}  P{r['priority']}  {created}")
            if summary_text:
                lines.append(f"      摘要: {summary_text}")
            else:
                lines.append(f"      内容: {r['content'][:60]}…")
        return "\n".join(lines)

    elif tool_name == "get_world_entry":
        eid = args["entry_id"]
        row = conn.execute("SELECT * FROM world_entries WHERE id = ?", (eid,)).fetchone()
        if not row:
            return f"❌ 条目 {eid} 不存在"
        kw = ", ".join(json.loads(row["keywords"])) if row["keywords"] else ""
        summary_text = row["summary"] if "summary" in row and row["summary"] else ""
        hits = row["hit_count"] if "hit_count" in row else 0
        subcat = f" / {row['subcategory']}" if "subcategory" in row.keys() and row["subcategory"] else ""
        result = (
            f"📄 {row['title']}\n"
            f"   状态: {'✅ 启用' if row['enabled'] else '⛔ 禁用'}\n"
            f"   分类: {row['category'] or '-'}{subcat}  类型: {row['type'] or 'note'}  优先级: {row['priority']}  命中: {hits}次\n"
            f"   创建: {row['created_at'] or '-'}  更新: {row['updated_at'] or '-'}\n"
            f"   关键词: {kw}\n"
        )
        if summary_text:
            result += f"   摘要: {summary_text}\n"
        result += f"\n{row['content']}"
        return result

    elif tool_name == "search_world_entries":
        query = args["query"]
        like = f"%{query}%"
        rows = conn.execute(
            """SELECT * FROM world_entries
               WHERE id LIKE ? OR title LIKE ? OR content LIKE ? OR summary LIKE ? OR keywords LIKE ?
               ORDER BY priority DESC""",
            (like, like, like, like, like),
        ).fetchall()
        if not rows:
            return f"没有找到包含「{query}」的条目"
        lines = [f"共 {len(rows)} 条结果："]
        for r in rows:
            flag = "✅" if r["enabled"] else "⛔"
            kw = ", ".join(json.loads(r["keywords"])) if r["keywords"] else ""
            summary_text = (r["summary"] or "")[:60]
            lines.append(f"  [{r['id']}] {flag} {r['title']}")
            if summary_text:
                lines.append(f"      摘要: {summary_text}")
            lines.append(f"      关键词: {kw}  |  优先级: {r['priority']}  分类: {r['category'] or '-'}")
        return "\n".join(lines)

    elif tool_name == "get_world_entry_stats":
        min_hits = args.get("min_hits", 0)
        sort_by = args.get("sort_by", "hits_desc")
        order = "hit_count DESC, priority DESC" if sort_by == "hits_desc" else \
                "hit_count ASC" if sort_by == "hits_asc" else "priority DESC"
        rows = conn.execute(
            f"""SELECT id, title, type, priority, hit_count, enabled FROM world_entries
                WHERE hit_count >= ? ORDER BY {order}""",
            (min_hits,),
        ).fetchall()
        if not rows:
            return "没有符合条件的条目"
        total = conn.execute("SELECT COUNT(*) FROM world_entries").fetchone()[0]
        lines = [f"共 {len(rows)} 条（总条目 {total} 条，仅显示命中≥{min_hits}）："]
        for r in rows:
            status = "✅" if r["enabled"] else "⛔"
            lines.append(f"  [{r['id']}] {status} {r['title']}  (类型: {r['type'] or 'note'}, 优先级: P{r['priority']}, 命中: {r['hit_count']}次)")
        return "\n".join(lines)

    elif tool_name == "create_world_entry":
        eid = str(uuid.uuid4())[:8]
        keywords_json = json.dumps(args.get("keywords", []), ensure_ascii=False)
        entry_type = args.get("type", "note")
        conn.execute(
            """INSERT INTO world_entries
               (id, title, content, summary, keywords, enabled, priority, category, subcategory, position, type)
               VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, 'system', ?)""",
            (eid, args["title"], args.get("content", ""), args.get("summary", ""),
             keywords_json, args.get("priority", 0), args.get("category", ""),
             args.get("subcategory", ""), entry_type),
        )
        conn.commit()
        return f"✅ 已创建世界书条目「{args['title']}」(ID: {eid})"

    elif tool_name == "update_world_entry":
        eid = args["entry_id"]
        existing = conn.execute(
            "SELECT * FROM world_entries WHERE id = ?", (eid,)
        ).fetchone()
        if not existing:
            return f"❌ 条目 {eid} 不存在"

        updates = {}
        for field in ("title", "content", "summary", "enabled", "category", "subcategory", "type"):
            if field in args:
                updates[field] = args[field]
        if "keywords" in args:
            updates["keywords"] = json.dumps(args["keywords"], ensure_ascii=False)
        if "priority" in args:
            updates["priority"] = args["priority"]

        if not updates:
            return f"条目 {eid} 无变更"

        field_clauses = [f"{k} = ?" for k in updates]
        field_clauses.append("updated_at = CURRENT_TIMESTAMP")
        values = [updates[k] for k in updates] + [eid]
        conn.execute(
            f"UPDATE world_entries SET {', '.join(field_clauses)} WHERE id = ?",
            values,
        )
        conn.commit()
        return f"✅ 已更新条目 {eid}"

    elif tool_name == "delete_world_entry":
        eid = args["entry_id"]
        conn.execute("DELETE FROM world_entries WHERE id = ?", (eid,))
        conn.commit()
        return f"✅ 已删除条目 {eid}"

    elif tool_name == "update_persona":
        if not _explicitly_requests_persona_update(user_message):
            return "❌ 未执行：当前用户消息没有明确要求修改 persona 或角色设定"
        persona = args.get("persona", "")
        if not persona:
            return "❌ 请提供角色设定内容"
        if not conversation_id:
            return "❌ 无法确定当前对话"
        conn.execute(
            "UPDATE conversations SET system_prompt = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (persona, conversation_id),
        )
        conn.commit()
        return "✅ 已更新角色设定 (system prompt)"

    return f"❌ 未知工具: {tool_name}"
