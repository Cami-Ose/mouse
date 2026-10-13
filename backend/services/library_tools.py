"""
🧀 奶酪图书馆 — AI 工具定义
模型可以通过工具自由读写查询图书馆条目
"""

from database import get_connection

# ─── 工具 Schema ───────────────────────────

LIBRARY_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "search_library",
            "description": "在奶酪图书馆中搜索条目，按关键词匹配标题和内容",
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
            "name": "read_library_entry",
            "description": "读取奶酪图书馆中的单条条目全文",
            "parameters": {
                "type": "object",
                "properties": {
                    "id": {
                        "type": "string",
                        "description": "条目的 ID"
                    }
                },
                "required": ["id"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "write_library_entry",
            "description": "向奶酪图书馆写入一条新条目。写入后 AI 可以随时读取。用于保存重要的参考信息、资料原文、代码片段等。",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {
                        "type": "string",
                        "description": "条目标题，简洁明了"
                    },
                    "content": {
                        "type": "string",
                        "description": "条目内容，完整原文"
                    },
                    "source_url": {
                        "type": "string",
                        "description": "来源链接（可选）"
                    },
                    "folder": {
                        "type": "string",
                        "description": "所属文件夹（可选），用于分类组织"
                    }
                },
                "required": ["title", "content"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "list_library_folders",
            "description": "列出奶酪图书馆中的所有文件夹",
            "parameters": {
                "type": "object",
                "properties": {}
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "delete_library_entry",
            "description": "删除奶酪图书馆中的一条条目",
            "parameters": {
                "type": "object",
                "properties": {
                    "id": {
                        "type": "string",
                        "description": "要删除的条目 ID"
                    }
                },
                "required": ["id"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "update_library_entry",
            "description": "修改奶酪图书馆中的条目内容、标题、来源或移动文件夹",
            "parameters": {
                "type": "object",
                "properties": {
                    "id": {
                        "type": "string",
                        "description": "要修改的条目 ID"
                    },
                    "title": {
                        "type": "string",
                        "description": "新的标题（不修改则省略）"
                    },
                    "content": {
                        "type": "string",
                        "description": "新的内容（不修改则省略）"
                    },
                    "source_url": {
                        "type": "string",
                        "description": "新的来源链接（不修改则省略）"
                    },
                    "folder": {
                        "type": "string",
                        "description": "新的文件夹（不修改则省略，移出文件夹传空字符串）"
                    }
                },
                "required": ["id"]
            }
        }
    },
]

# ─── 宝箱 — AI 只读工具 ──────────────

TREASURE_BOX_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "read_treasure_box",
            "description": "读取 宝箱 — 里面存着用户写下的单句、心情、想法。注意：该工具只读，不可以写入或删除。",
            "parameters": {
                "type": "object",
                "properties": {},
                "required": []
            }
        }
    },
]


# ─── 工具执行 ──────────────────────────────

def execute_library_tool(name: str, args: dict) -> str:
    """执行图书馆工具调用，返回文本结果"""
    conn = get_connection()

    if name == "search_library":
        q = args.get("query", "")
        if not q:
            return "请提供搜索关键词"
        pattern = f"%{q}%"
        rows = conn.execute(
            """SELECT id, title, folder, substr(content, 1, 200) as preview
               FROM cheese_library
               WHERE title LIKE ? OR content LIKE ?
               ORDER BY updated_at DESC LIMIT 20""",
            (pattern, pattern),
        ).fetchall()
        if not rows:
            return f"没有找到包含「{q}」的条目"
        results = []
        for r in rows:
            parts = [f"ID: {r['id']}", f"标题: {r['title']}"]
            if r["folder"]:
                parts.append(f"文件夹: {r['folder']}")
            parts.append(f"预览: {r['preview']}")
            results.append(" | ".join(parts))
        return "找到以下条目：\n\n" + "\n\n".join(results)

    elif name == "read_library_entry":
        eid = args.get("id", "")
        if not eid:
            return "请提供条目 ID"
        row = conn.execute(
            "SELECT * FROM cheese_library WHERE id = ?", (eid,)
        ).fetchone()
        if not row:
            return f"未找到 ID 为 {eid} 的条目"
        result = f"标题: {row['title']}\n"
        if row["folder"]:
            result += f"文件夹: {row['folder']}\n"
        if row["source_url"]:
            result += f"来源: {row['source_url']}\n"
        result += f"---\n{row['content']}"
        return result

    elif name == "write_library_entry":
        title = args.get("title", "").strip()
        content = args.get("content", "").strip()
        if not title or not content:
            return "标题和内容不能为空"
        import uuid
        eid = str(uuid.uuid4())[:8]
        source_url = args.get("source_url", "").strip()
        folder = args.get("folder", "").strip()
        conn.execute(
            """INSERT INTO cheese_library (id, title, content, source_url, folder)
               VALUES (?, ?, ?, ?, ?)""",
            (eid, title, content, source_url, folder),
        )
        conn.commit()
        return f"已写入条目「{title}」，ID: {eid}"

    elif name == "list_library_folders":
        rows = conn.execute(
            "SELECT DISTINCT folder FROM cheese_library WHERE folder != '' ORDER BY folder"
        ).fetchall()
        if not rows:
            return "还没有文件夹"
        folders = [r["folder"] for r in rows]
        return "现有文件夹：\n" + "\n".join(f"- {f}" for f in folders)

    elif name == "delete_library_entry":
        eid = args.get("id", "")
        if not eid:
            return "请提供要删除的条目 ID"
        row = conn.execute("SELECT title FROM cheese_library WHERE id = ?", (eid,)).fetchone()
        if not row:
            return f"未找到 ID 为 {eid} 的条目"
        conn.execute("DELETE FROM cheese_library WHERE id = ?", (eid,))
        conn.commit()
        return f"已删除条目「{row['title']}」（ID: {eid}）"

    elif name == "update_library_entry":
        eid = args.get("id", "")
        if not eid:
            return "请提供要修改的条目 ID"
        row = conn.execute("SELECT * FROM cheese_library WHERE id = ?", (eid,)).fetchone()
        if not row:
            return f"未找到 ID 为 {eid} 的条目"
        updates = {}
        for field in ("title", "content", "source_url", "folder"):
            if field in args and args[field] is not None:
                updates[field] = str(args[field]).strip()
        if not updates:
            return "没有需要修改的字段"
        field_clauses = [f"{k} = ?" for k in updates] + ["updated_at = CURRENT_TIMESTAMP"]
        fields = ", ".join(field_clauses)
        values = list(updates.values()) + [eid]
        conn.execute(f"UPDATE cheese_library SET {fields} WHERE id = ?", values)
        conn.commit()
        changed = "、".join(updates.keys())
        return f"已更新条目「{row['title']}」的 {changed}（ID: {eid}）"

    elif name == "read_treasure_box":
        rows = conn.execute(
            "SELECT content, created_at FROM treasure_box ORDER BY created_at DESC LIMIT 50"
        ).fetchall()
        if not rows:
            return "🎁 宝箱还是空的"
        results = []
        for r in rows:
            results.append(f"- {r['content']}（{r['created_at'][:16]}）")
        return "🎁 宝箱里有以下内容：\n" + "\n".join(results)

    return f"未知工具: {name}"
