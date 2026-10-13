"""
AI 可调用的上传文件工具定义 + 执行
"""

import json
import os
from config import FRONTEND_DIR

# ─── 工具定义（OpenAI tool calling 格式）───────────

FILE_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "list_uploaded_files",
            "description": "列出当前对话中用户上传过的所有文件（含文件名、大小）。适用于了解用户手上有什么材料。",
            "parameters": {
                "type": "object",
                "properties": {},
                "required": []
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "read_uploaded_file",
            "description": "读取用户上传的某个文件的内容。适用于需要详细查看某个文件中的信息时。",
            "parameters": {
                "type": "object",
                "properties": {
                    "filename": {
                        "type": "string",
                        "description": "要读取的文件名（如「ENI gpt.txt」），或上传时的完整文件名。可以从 list_uploaded_files 的结果中获取。"
                    }
                },
                "required": ["filename"]
            }
        }
    },
]


def execute_file_tool(tool_name: str, args: dict, conn, conversation_id: str) -> str:
    """执行文件工具，返回文本结果"""
    if tool_name == "list_uploaded_files":
        return _list_files(conn, conversation_id)
    elif tool_name == "read_uploaded_file":
        return _read_file(conn, conversation_id, args.get("filename", ""))
    return f"❌ 未知工具: {tool_name}"


def _list_files(conn, conversation_id: str) -> str:
    """列出对话中所有上传过的文件"""
    rows = conn.execute(
        """SELECT content, files FROM messages
           WHERE conversation_id = ? AND role = 'user' AND files IS NOT NULL
           ORDER BY created_at ASC""",
        (conversation_id,),
    ).fetchall()

    all_files = []
    seen = set()
    for row in rows:
        raw = row["files"]
        if not raw:
            continue
        try:
            file_list = json.loads(raw) if isinstance(raw, str) else raw
        except Exception:
            continue
        for f in file_list:
            name = f.get("name", "未知文件")
            if name in seen:
                continue
            seen.add(name)
            size = f.get("size", 0)
            size_str = _fmt_size(size)
            all_files.append(f"  📎 {name} ({size_str})")

    if not all_files:
        return "📂 当前对话中没有找到上传过的文件。"

    return f"📂 当前对话中共 {len(all_files)} 个上传文件：\n\n" + "\n".join(all_files)


def _read_file(conn, conversation_id: str, filename: str) -> str:
    """读取指定文件的内容"""
    if not filename:
        return "❌ 请指定要读取的文件名。"

    # 在对话中查找该文件
    rows = conn.execute(
        """SELECT files FROM messages
           WHERE conversation_id = ? AND role = 'user' AND files IS NOT NULL
           ORDER BY created_at ASC""",
        (conversation_id,),
    ).fetchall()

    target_url = None
    target_name = filename
    for row in rows:
        raw = row["files"]
        if not raw:
            continue
        try:
            file_list = json.loads(raw) if isinstance(raw, str) else raw
        except Exception:
            continue
        for f in file_list:
            if f.get("name") == filename or f.get("name", "").endswith(filename):
                target_url = f.get("url", "")
                target_name = f.get("name", filename)
                break
        if target_url:
            break

    if not target_url:
        return f"❌ 未找到文件「{filename}」。使用 list_uploaded_files 查看所有可用的文件。"

    # 从磁盘读取文件内容
    filepath = os.path.join(FRONTEND_DIR, target_url.lstrip("/"))
    if not os.path.isfile(filepath):
        return f"❌ 文件「{target_name}」在服务器上不存在。"

    try:
        with open(filepath, "r", encoding="utf-8", errors="replace") as f:
            content = f.read(50000)
    except Exception as e:
        return f"❌ 读取文件失败: {e}"

    return f"📄 {target_name}\n\n{content}"


def _fmt_size(size: int) -> str:
    if size < 1024:
        return f"{size}B"
    elif size < 1024 * 1024:
        return f"{size/1024:.1f}KB"
    else:
        return f"{size/1024/1024:.1f}MB"
