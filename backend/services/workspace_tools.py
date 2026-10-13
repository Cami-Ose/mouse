"""
工作间工具定义 + 执行
允许模型在工作间模式下读写工作区文件、执行命令、管理钉板卡片
"""

import os
import json
import subprocess
import base64

from config import WORKSPACE_ROOT as _config_workspace_root

# 所有操作限制在 WORKSPACE_ROOT 下（默认项目根目录，见 config.py）
WORKSPACE_ROOT = _config_workspace_root


def _safe_path(path: str) -> str:
    """校验并规范化路径，确保在 WORKSPACE_ROOT 内"""
    full = os.path.realpath(os.path.join(WORKSPACE_ROOT, path.lstrip("/")))
    if not full.startswith(os.path.realpath(WORKSPACE_ROOT)):
        raise PermissionError(f"路径不在工作区内: {path}")
    return full


# ─── 钉板工具定义（普通聊天也可用）─────────

PIN_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "workspace_pin_note",
            "description": "在工作间右侧钉板上钉一张卡片。用于记录当前目标、发现、待办事项等。如果标题已存在则更新内容。",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "卡片标题"},
                    "content": {"type": "string", "description": "卡片内容"}
                },
                "required": ["title", "content"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "workspace_remove_pin",
            "description": "从钉板上移除一张卡片。",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "要移除的卡片标题"}
                },
                "required": ["title"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "workspace_list_pins",
            "description": "列出钉板上所有的卡片。",
            "parameters": {"type": "object", "properties": {}}
        }
    },
    {
        "type": "function",
        "function": {
            "name": "workspace_clear_pins",
            "description": "清空钉板上所有的卡片。",
            "parameters": {"type": "object", "properties": {}}
        }
    },
]

# ─── 完整工作间工具定义 ─────────────────

WORKSPACE_TOOLS = PIN_TOOLS + [
    {
        "type": "function",
        "function": {
            "name": "workspace_list_dir",
            "description": "列出工作区内目录的内容。返回文件和子目录的名称、类型、大小和修改时间。不传 path 默认列出根目录。",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "目录路径，相对于工作区根目录，默认为空（根目录）"
                    }
                }
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "workspace_read_file",
            "description": "读取工作区内一个文件的内容。适用于查看代码、配置文件等文本文件。",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "文件路径，相对于工作区根目录"
                    }
                },
                "required": ["path"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "workspace_write_file",
            "description": "写入或覆盖工作区内的一个文件。如果文件不存在则创建，如果存在则覆盖。用于修改代码、配置等。",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "文件路径，相对于工作区根目录"
                    },
                    "content": {
                        "type": "string",
                        "description": "要写入的文件内容"
                    }
                },
                "required": ["path", "content"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "workspace_exec",
            "description": "在工作区目录下执行一条 shell 命令。适用于运行构建、测试、git 操作等。禁止使用 sudo、rm -rf、shutdown、reboot 等危险命令。",
            "parameters": {
                "type": "object",
                "properties": {
                    "command": {
                        "type": "string",
                        "description": "要执行的 shell 命令"
                    }
                },
                "required": ["command"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "workspace_git_commit",
            "description": "对工作区执行 git add -A 并提交。适用于保存修改记录。",
            "parameters": {
                "type": "object",
                "properties": {
                    "message": {
                        "type": "string",
                        "description": "commit message"
                    }
                },
                "required": ["message"]
            }
        }
    },
]


_DANGER_COMMANDS = ["sudo", "rm -rf", "shutdown", "reboot", "poweroff", "halt", "mkfs", "dd", ">"]


def _check_safe_command(cmd: str):
    """检查命令是否安全"""
    cmd_lower = cmd.lower()
    for danger in _DANGER_COMMANDS:
        if danger in cmd_lower:
            raise PermissionError(f"禁止执行危险命令: {danger}")


_TEXT_EXTENSIONS = {
    ".txt", ".md", ".csv", ".json", ".xml", ".yaml", ".yml",
    ".py", ".js", ".ts", ".jsx", ".tsx", ".html", ".css", ".scss",
    ".java", ".cpp", ".c", ".h", ".hpp", ".go", ".rs", ".rb", ".php",
    ".sh", ".bat", ".ps1", ".sql", ".r", ".lua", ".pl", ".swift",
    ".kt", ".kts", ".toml", ".ini", ".cfg", ".conf", ".env",
    ".log", ".tex", ".rst", ".vue", ".svelte", ".astro",
    ".cjs", ".mjs", ".mts", ".cts",
}


# ─── 钉板存储 ─────────────────────────────────

def _load_pins(conn) -> list[dict]:
    """从 global_config 加载全局钉板卡片"""
    row = conn.execute(
        "SELECT pins FROM global_config WHERE id = 1"
    ).fetchone()
    if not row or not row["pins"]:
        return []
    try:
        pins = json.loads(row["pins"]) if isinstance(row["pins"], str) else (row["pins"] or [])
        return pins if isinstance(pins, list) else []
    except Exception:
        return []


def _save_pins(conn, pins: list[dict]):
    """保存钉板卡片到 global_config"""
    conn.execute(
        "UPDATE global_config SET pins = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1",
        (json.dumps(pins, ensure_ascii=False),),
    )
    conn.commit()


# ─── 执行函数 ─────────────────────────────

def execute_workspace_tool(tool_name: str, args: dict, conn=None, conversation_id: str = None) -> str:
    """执行工作间工具，返回文本结果"""

    # ── 文件操作 ─────────────────────────
    if tool_name == "workspace_list_dir":
        path = args.get("path", "")
        try:
            target = _safe_path(path)
            if not os.path.isdir(target):
                return f"❌ 目录不存在: {path}"
            items = []
            for entry in os.scandir(target):
                info = {
                    "name": entry.name,
                    "type": "dir" if entry.is_dir() else "file",
                    "size": entry.stat().st_size if entry.is_file() else 0,
                    "mtime": entry.stat().st_mtime,
                }
                items.append(info)
            # 排序：目录在前，然后按名称排序
            items.sort(key=lambda x: (0 if x["type"] == "dir" else 1, x["name"]))
            result = f"📁 {path or '/'}\n"
            for item in items:
                if item["type"] == "dir":
                    result += f"  📂 {item['name']}/\n"
                else:
                    size_str = _format_size(item["size"])
                    result += f"  📄 {item['name']}  ({size_str})\n"
            return result
        except PermissionError as e:
            return f"❌ {e}"
        except Exception as e:
            return f"❌ 列出目录失败: {e}"

    elif tool_name == "workspace_read_file":
        path = args.get("path", "")
        try:
            target = _safe_path(path)
            if not os.path.isfile(target):
                return f"❌ 文件不存在: {path}"
            ext = os.path.splitext(target)[1].lower()
            if ext in _TEXT_EXTENSIONS or ext == "":
                try:
                    with open(target, "r", encoding="utf-8", errors="replace") as f:
                        content = f.read(100000)  # 最多 100KB
                except UnicodeDecodeError:
                    # 可能是二进制，尝试 base64
                    with open(target, "rb") as f:
                        b64 = base64.b64encode(f.read(50000)).decode()
                    return f"⚠️ 文件 {path} 不是文本文件，已编码为 base64（前 50KB）：\n\n{b64}"
                size = os.path.getsize(target)
                size_str = _format_size(size)
                return f"📄 {path}  ({size_str})\n\n```\n{content}\n```"
            else:
                # 二进制文件，base64 编码
                with open(target, "rb") as f:
                    b64 = base64.b64encode(f.read(50000)).decode()
                return f"⚠️ 二进制文件 {path}，已编码为 base64（前 50KB）：\n\n{b64}"
        except PermissionError as e:
            return f"❌ {e}"
        except Exception as e:
            return f"❌ 读取文件失败: {e}"

    elif tool_name == "workspace_write_file":
        path = args.get("path", "")
        content = args.get("content", "")
        try:
            target = _safe_path(path)
            os.makedirs(os.path.dirname(target), exist_ok=True)
            with open(target, "w", encoding="utf-8") as f:
                f.write(content)
            size = len(content.encode("utf-8"))
            size_str = _format_size(size)
            return f"✅ 已写入 {path}  ({size_str})"
        except PermissionError as e:
            return f"❌ {e}"
        except Exception as e:
            return f"❌ 写入文件失败: {e}"

    # ── 命令执行 ─────────────────────────
    elif tool_name == "workspace_exec":
        command = args.get("command", "")
        try:
            _check_safe_command(command)
            result = subprocess.run(
                command,
                shell=True,
                cwd=WORKSPACE_ROOT,
                capture_output=True,
                text=True,
                timeout=60,
            )
            output = ""
            if result.stdout:
                output += result.stdout
            if result.stderr:
                if output:
                    output += "\n"
                output += f"[stderr]\n{result.stderr}"
            if not output:
                output = "(无输出)"
            status = f"💻 `{command}`\n退出码: {result.returncode}\n\n{output[:5000]}"
            if len(output) > 5000:
                status += "\n\n...(输出过长已截断)"
            return status
        except PermissionError as e:
            return f"❌ {e}"
        except subprocess.TimeoutExpired:
            return "❌ 命令执行超时（60s）"
        except Exception as e:
            return f"❌ 执行失败: {e}"

    # ── Git ──────────────────────────────
    elif tool_name == "workspace_git_commit":
        message = args.get("message", "工作间更新")
        try:
            # git add -A
            add_result = subprocess.run(
                ["git", "add", "-A"],
                cwd=WORKSPACE_ROOT,
                capture_output=True, text=True, timeout=30,
            )
            if add_result.returncode != 0:
                return f"❌ git add 失败: {add_result.stderr[:500]}"

            # git diff --cached --stat
            stat_result = subprocess.run(
                ["git", "diff", "--cached", "--stat"],
                cwd=WORKSPACE_ROOT,
                capture_output=True, text=True, timeout=30,
            )
            changed = stat_result.stdout.strip() or "(无变化)"

            # git commit
            commit_result = subprocess.run(
                ["git", "commit", "-m", message],
                cwd=WORKSPACE_ROOT,
                capture_output=True, text=True, timeout=30,
            )
            if commit_result.returncode != 0:
                return f"❌ git commit 失败: {commit_result.stderr[:500]}"

            # 提取 hash
            output = commit_result.stdout
            hash_str = ""
            for line in output.split("\n"):
                if "commit" in line:
                    hash_str = line.strip()
                    break

            return f"✅ git commit 成功\n\n变更文件:\n{changed}\n\n{output[:2000]}"
        except subprocess.TimeoutExpired:
            return "❌ git 操作超时"
        except Exception as e:
            return f"❌ git 操作失败: {e}"

    # ── 钉板操作 ─────────────────────────
    elif tool_name == "workspace_pin_note":
        if not conn:
            return "❌ 钉板操作需要数据库连接"
        title = args.get("title", "").strip()
        content = args.get("content", "").strip()
        if not title:
            return "❌ 卡片标题不能为空"
        pins = _load_pins(conn)
        # 更新已存在的
        found = False
        for pin in pins:
            if pin.get("title") == title:
                pin["content"] = content
                found = True
                break
        if not found:
            pins.append({"title": title, "content": content})
        _save_pins(conn, pins)
        return f"📌 已钉上卡片「{title}」"

    elif tool_name == "workspace_remove_pin":
        if not conn:
            return "❌ 钉板操作需要数据库连接"
        title = args.get("title", "").strip()
        if not title:
            return "❌ 卡片标题不能为空"
        pins = _load_pins(conn)
        new_pins = [p for p in pins if p.get("title") != title]
        if len(new_pins) == len(pins):
            return f"⚠️ 没有找到卡片「{title}」"
        _save_pins(conn, new_pins)
        return f"🗑️ 已移除卡片「{title}」"

    elif tool_name == "workspace_list_pins":
        if not conn:
            return "❌ 钉板操作需要数据库连接"
        pins = _load_pins(conn)
        if not pins:
            return "📌 钉板上还没有卡片"
        result = f"📌 钉板 ({len(pins)} 张卡片)\n\n"
        for i, pin in enumerate(pins, 1):
            result += f"{i}. {pin.get('title', '(无标题)')}\n   {pin.get('content', '')}\n\n"
        return result.strip()

    elif tool_name == "workspace_clear_pins":
        if not conn:
            return "❌ 钉板操作需要数据库连接"
        _save_pins(conn, [])
        return "🗑️ 已清空所有卡片"

    return f"❌ 未知工具: {tool_name}"


def _format_size(size: int) -> str:
    """格式化文件大小"""
    if size < 1024:
        return f"{size}B"
    elif size < 1024 * 1024:
        return f"{size / 1024:.1f}KB"
    else:
        return f"{size / 1024 / 1024:.1f}MB"
