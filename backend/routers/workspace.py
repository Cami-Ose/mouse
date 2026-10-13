"""
工作间 — 专属流式聊天 + 文件操作端点
工作间里的聊天有独立的 workspace tools，没有世界书注入
"""

import uuid
import json
import os
import subprocess
import asyncio
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from database import get_connection
from models import ChatRequest
from services.llm_service import LLMClient
from services.chat_history import build_messages
from services.workspace_tools import WORKSPACE_TOOLS, execute_workspace_tool, WORKSPACE_ROOT

router = APIRouter(prefix="/api/workspace", tags=["workspace"])


def _resolve_provider(conn, provider_id: str | None) -> tuple:
    """确定 API 线路，返回 (provider_row, provider_id)。复用 chat.py 的逻辑。"""
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


def _build_workspace_messages(conn, cid: str, text: str) -> tuple[list[dict], list | None]:
    """
    构建工作间消息列表。
    和 _build_chat_messages 类似，但：
    - 不做世界书注入
    - 始终带 workspace tools
    - 使用全局 persona
    """
    from models import DEFAULT_SYSTEM_PROMPT
    from routers.chat import _get_global_persona

    # 构建消息（不含世界书注入）
    msgs = build_messages(cid, text, "", exclude_last_user=False)
    if not msgs:
        raise HTTPException(500, "消息构建失败")

    # 清理消息中的内部字段
    for msg in msgs:
        msg.pop("id", None)
        msg.pop("files", None)

    # 工作间始终带 workspace tools（不需要历史对话）
    tools = WORKSPACE_TOOLS
    return msgs, tools


def _workspace_stream_response(messages: list[dict], provider, cid: str, tools: list | None = None,
                                user_msg_id: str | None = None):
    """
    工作间专用 SSE StreamingResponse。
    和 chat.py 的 _stream_response 类似，但工具路由到 workspace tools。
    """
    client = LLMClient(
        base_url=provider["base_url"],
        api_key=provider["api_key"],
        model=provider["model"],
    )

    async def event_stream():
        assistant_msg_id = str(uuid.uuid4())[:8]
        current_messages = list(messages)
        tool_calls_log = []

        while True:
            full_reply = ""
            tool_calls_result = None

            async for event in client.chat_stream(current_messages, tools=tools):
                if event["type"] == "token":
                    full_reply += event["content"]
                    yield f"data: {json.dumps({'type': 'token', 'content': event['content']}, ensure_ascii=False)}\n\n"
                elif event["type"] == "tool_calls":
                    tool_calls_result = event["calls"]
                    yield f"data: {json.dumps({'type': 'tool_status', 'content': '🔧 正在操作…'}, ensure_ascii=False)}\n\n"
                elif event["type"] == "done":
                    if not tool_calls_result:
                        full_reply = event["content"]
                elif event["type"] == "error":
                    yield f"data: {json.dumps({'type': 'error', 'content': event['content']}, ensure_ascii=False)}\n\n"
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

            # 执行每个工具
            for tc in tool_calls_result:
                args = json.loads(tc.get("arguments", "{}") or "{}")
                conn2 = get_connection()

                yield f"data: {json.dumps({'type': 'tool_call_start', 'tool_name': tc['name'], 'arguments': tc.get('arguments', '{}')}, ensure_ascii=False)}\n\n"

                result = execute_workspace_tool(tc["name"], args, conn2, conversation_id=cid)

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

            # 继续循环 → 再次调 AI

        # done：保存 assistant 消息
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
            "user_message_id": user_msg_id,
        }
        yield f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# ─── 端点 ─────────────────────────────────


@router.post("/{cid}/chat")
async def workspace_chat(cid: str, body: ChatRequest):
    """
    工作间聊天 → SSE 流式回复。
    和 /api/chat/{cid} 类似，但：
    - 不做世界书注入
    - 使用 workspace tools
    """
    conn = get_connection()
    conv = conn.execute(
        "SELECT * FROM conversations WHERE id = ?", (cid,)
    ).fetchone()
    if not conv:
        raise HTTPException(404, "对话不存在")

    msg_id = str(uuid.uuid4())[:8]
    provider, _ = _resolve_provider(conn, body.provider_id)
    msgs, tools = _build_workspace_messages(conn, cid, body.message)

    # 先存用户消息
    conn.execute(
        "INSERT INTO messages (id, conversation_id, role, content) VALUES (?, ?, 'user', ?)",
        (msg_id, cid, body.message),
    )
    conn.execute(
        "UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        (cid,),
    )
    conn.commit()

    return _workspace_stream_response(msgs, provider, cid, tools=tools,
                                       user_msg_id=msg_id)


@router.get("/tree")
def workspace_tree(path: str = Query("", description="相对于工作区根目录的路径")):
    """获取工作区目录树"""
    import os as _os
    target = _os.path.realpath(_os.path.join(WORKSPACE_ROOT, path.lstrip("/")))
    if not target.startswith(_os.path.realpath(WORKSPACE_ROOT)):
        raise HTTPException(403, "路径不在工作区内")

    if not _os.path.isdir(target):
        raise HTTPException(404, "目录不存在")

    items = []
    try:
        for entry in _os.scandir(target):
            info = {
                "name": entry.name,
                "type": "dir" if entry.is_dir() else "file",
            }
            if entry.is_file():
                info["size"] = entry.stat().st_size
            try:
                info["mtime"] = entry.stat().st_mtime
            except Exception:
                info["mtime"] = 0
            items.append(info)
        items.sort(key=lambda x: (0 if x["type"] == "dir" else 1, x["name"]))
    except PermissionError:
        raise HTTPException(403, "没有权限访问该目录")

    return {"path": path or "/", "items": items}


@router.post("/{cid}/git-diff")
def workspace_git_diff(cid: str):
    """获取工作区 git diff"""
    try:
        result = subprocess.run(
            ["git", "diff"],
            cwd=WORKSPACE_ROOT,
            capture_output=True, text=True, timeout=30,
        )
        staged = subprocess.run(
            ["git", "diff", "--cached"],
            cwd=WORKSPACE_ROOT,
            capture_output=True, text=True, timeout=30,
        )

        # git status --short
        status_result = subprocess.run(
            ["git", "status", "--short"],
            cwd=WORKSPACE_ROOT,
            capture_output=True, text=True, timeout=30,
        )

        return {
            "diff": result.stdout[:10000] + ("\n...(截断)" if len(result.stdout) > 10000 else ""),
            "staged": staged.stdout[:5000] + ("\n...(截断)" if len(staged.stdout) > 5000 else ""),
            "status": status_result.stdout.strip(),
        }
    except Exception as e:
        return {"diff": "", "staged": "", "status": "", "error": str(e)}


@router.post("/{cid}/exec")
def workspace_exec(cid: str, body: dict):
    """直接执行命令（非 tool 调用，供运行标签页使用）"""
    command = body.get("command", "")
    if not command:
        raise HTTPException(400, "命令不能为空")

    from services.workspace_tools import _check_safe_command
    try:
        _check_safe_command(command)
    except PermissionError as e:
        raise HTTPException(403, str(e))

    try:
        result = subprocess.run(
            command,
            shell=True,
            cwd=WORKSPACE_ROOT,
            capture_output=True,
            text=True,
            timeout=120,
        )
        return {
            "stdout": result.stdout[-10000:],
            "stderr": result.stderr[-5000:],
            "exit_code": result.returncode,
        }
    except subprocess.TimeoutExpired:
        raise HTTPException(408, "命令执行超时")
    except Exception as e:
        raise HTTPException(500, f"执行失败: {e}")


@router.get("/{cid}/pins")
def get_pins(cid: str):
    """获取钉板卡片（全局存储）"""
    conn = get_connection()
    row = conn.execute(
        "SELECT pins FROM global_config WHERE id = 1"
    ).fetchone()
    pins = []
    if row and row["pins"]:
        try:
            pins = json.loads(row["pins"]) if isinstance(row["pins"], str) else (row["pins"] or [])
        except (json.JSONDecodeError, TypeError):
            pins = []
    return {"pins": pins}


@router.put("/{cid}/pins")
def update_pins(cid: str, body: dict):
    """替换钉板所有卡片（全局存储）"""
    pins = body.get("pins", [])
    conn = get_connection()
    conn.execute(
        "UPDATE global_config SET pins = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1",
        (json.dumps(pins, ensure_ascii=False),),
    )
    conn.commit()
    return {"pins": pins}
