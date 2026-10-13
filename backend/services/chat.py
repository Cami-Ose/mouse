"""
对话 CRUD + 聊天 SSE
"""

import uuid
import json
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from database import get_connection
from models import (
    ConversationCreate,
    ConversationUpdate,
    ChatRequest,
)
from services.chat_history import build_messages
from services.llm_service import LLMClient
from services.worldbook_match import build_worldbook_system_text
from services.worldbook_tools import WORDBOOK_TOOLS, execute_tool

router = APIRouter(prefix="/api", tags=["chat"])


def _conv_row(row) -> dict:
    return {
        "id": row["id"],
        "title": row["title"],
        "system_prompt": row["system_prompt"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def _msg_row(row) -> dict:
    return {
        "id": row["id"],
        "conversation_id": row["conversation_id"],
        "role": row["role"],
        "content": row["content"],
        "created_at": row["created_at"],
    }


# ─── 对话 CRUD ────────────────────────────────────────────

@router.get("/conversations")
def list_conversations():
    conn = get_connection()
    rows = conn.execute(
        "SELECT * FROM conversations ORDER BY updated_at DESC"
    ).fetchall()
    return [_conv_row(r) for r in rows]


@router.post("/conversations")
def create_conversation(body: ConversationCreate):
    conn = get_connection()
    cid = str(uuid.uuid4())[:8]
    conn.execute(
        "INSERT INTO conversations (id, title, system_prompt) VALUES (?, ?, ?)",
        (cid, body.title, body.system_prompt),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM conversations WHERE id = ?", (cid,)).fetchone()
    return _conv_row(row)


@router.put("/conversations/{cid}")
def update_conversation(cid: str, body: ConversationUpdate):
    conn = get_connection()
    existing = conn.execute(
        "SELECT * FROM conversations WHERE id = ?", (cid,)
    ).fetchone()
    if not existing:
        raise HTTPException(404, "对话不存在")

    updates = body.model_dump(exclude_unset=True)
    if not updates:
        return _conv_row(existing)

    # 更新字段 + 时间戳（CURRENT_TIMESTAMP 是 SQL 函数，不能做参数绑定）
    field_clauses = [f"{k} = ?" for k in updates] + ["updated_at = CURRENT_TIMESTAMP"]
    fields = ", ".join(field_clauses)
    values = list(updates.values()) + [cid]
    conn.execute(f"UPDATE conversations SET {fields} WHERE id = ?", values)
    conn.commit()
    row = conn.execute("SELECT * FROM conversations WHERE id = ?", (cid,)).fetchone()
    return _conv_row(row)


@router.delete("/conversations/{cid}")
def delete_conversation(cid: str):
    conn = get_connection()
    existing = conn.execute(
        "SELECT * FROM conversations WHERE id = ?", (cid,)
    ).fetchone()
    if not existing:
        raise HTTPException(404, "对话不存在")
    conn.execute("DELETE FROM conversations WHERE id = ?", (cid,))
    conn.commit()
    return {"ok": True}


# ─── 消息 CRUD ────────────────────────────────────────────

@router.get("/conversations/{cid}/messages")
def list_messages(cid: str, limit: int = 100, offset: int = 0):
    conn = get_connection()
    conv = conn.execute(
        "SELECT * FROM conversations WHERE id = ?", (cid,)
    ).fetchone()
    if not conv:
        raise HTTPException(404, "对话不存在")

    rows = conn.execute(
        """SELECT * FROM messages
           WHERE conversation_id = ?
           ORDER BY created_at ASC
           LIMIT ? OFFSET ?""",
        (cid, limit, offset),
    ).fetchall()
    return [_msg_row(r) for r in rows]


@router.delete("/conversations/{cid}/messages/{mid}")
def delete_message(cid: str, mid: str):
    conn = get_connection()
    existing = conn.execute(
        "SELECT * FROM messages WHERE id = ? AND conversation_id = ?", (mid, cid)
    ).fetchone()
    if not existing:
        raise HTTPException(404, "消息不存在")
    conn.execute("DELETE FROM messages WHERE id = ?", (mid,))
    conn.commit()
    return {"ok": True}


# ─── 聊天 SSE ─────────────────────────────────────────────

def _resolve_provider(conn, provider_id: str | None) -> tuple:
    """确定 API 线路，返回 (provider_row, provider_id)。"""
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


def _build_chat_messages(conn, cid: str, text: str, exclude_last_user: bool = False) -> tuple[list[dict], list | None]:
    """世界书匹配（含上下文扫描）+ 上下文拼接，返回 (messages, tools) 元组。"""
    worldbook_extra = build_worldbook_system_text(text, conversation_id=cid)
    msgs = build_messages(cid, text, worldbook_extra, exclude_last_user=exclude_last_user)
    if not msgs:
        raise HTTPException(500, "消息构建失败")

    # 有对话历史才给 AI 工具权限
    has_history = len([m for m in msgs if m["role"] in ("user", "assistant")]) > 0
    tools = WORDBOOK_TOOLS if has_history else None
    return msgs, tools


def _stream_response(messages: list[dict], provider, cid: str, tools: list | None = None,
                     user_msg_id: str | None = None, user_text: str | None = None):
    """
    创建 SSE StreamingResponse。
    - 如有工具调用：执行工具 → 非流式二次调用 → yield 最终回复 → 存库
    - 如无工具调用：流式 yield → done → 存库
    在 done 事件中一并保存 user 消息（如为新发）和 assistant 回复到 DB。
    """
    client = LLMClient(
        base_url=provider["base_url"],
        api_key=provider["api_key"],
        model=provider["model"],
    )

    async def event_stream():
        assistant_msg_id = str(uuid.uuid4())[:8]
        full_reply = ""
        tool_calls_result = None

        # 第一轮：流式请求（可能返回 tool_calls 或文字）
        async for event in client.chat_stream(messages, tools=tools):
            if event["type"] == "token":
                full_reply += event["content"]
                yield f"data: {json.dumps({'type': 'token', 'content': event['content']}, ensure_ascii=False)}\n\n"
            elif event["type"] == "tool_calls":
                tool_calls_result = event["calls"]
                yield f"data: {json.dumps({'type': 'tool_status', 'content': '🔧 正在操作世界书…'}, ensure_ascii=False)}\n\n"
            elif event["type"] == "done":
                full_reply = event["content"]
            elif event["type"] == "error":
                yield f"data: {json.dumps({'type': 'error', 'content': event['content']}, ensure_ascii=False)}\n\n"

        # 如果有工具调用，执行并二次请求
        if tool_calls_result:
            msgs_tool = list(messages)  # 复制原消息
            for tc in tool_calls_result:
                try:
                    args = json.loads(tc["arguments"])
                except json.JSONDecodeError:
                    args = {}
                conn2 = get_connection()
                result = execute_tool(tc["name"], args, conn2)
                # assistant 的 tool_calls 消息
                msgs_tool.append({
                    "role": "assistant",
                    "tool_calls": [{
                        "id": tc["id"],
                        "type": "function",
                        "function": {"name": tc["name"], "arguments": tc["arguments"]}
                    }],
                })
                # tool 的结果消息
                msgs_tool.append({
                    "role": "tool",
                    "tool_call_id": tc["id"],
                    "content": result,
                })

            # 二次调用（非流式），拿最终文字回复
            final_reply = await client.chat_once(msgs_tool)
            full_reply = final_reply
            # 拆成小块 yield，保持前端流式渲染
            chunk_size = 10
            for i in range(0, len(final_reply), chunk_size):
                yield f"data: {json.dumps({'type': 'token', 'content': final_reply[i:i+chunk_size]}, ensure_ascii=False)}\n\n"

        # done：存库
        conn2 = get_connection()
        if user_msg_id and user_text:
            conn2.execute(
                "INSERT INTO messages (id, conversation_id, role, content) VALUES (?, ?, 'user', ?)",
                (user_msg_id, cid, user_text),
            )
        conn2.execute(
            "INSERT INTO messages (id, conversation_id, role, content) VALUES (?, ?, 'assistant', ?)",
            (assistant_msg_id, cid, full_reply),
        )
        conn2.execute(
            "UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (cid,),
        )
        conn2.commit()
        payload = {
            "type": "done",
            "message_id": assistant_msg_id,
        }
        if user_msg_id:
            payload["user_message_id"] = user_msg_id
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


@router.post("/chat/{cid}")
async def chat_stream(cid: str, body: ChatRequest):
    """
    发送消息 → SSE 流式回复。
    用户消息不预先写库（等流式完成后再和 assistant 回复一起持久化），
    避免 build_messages 从 DB 读到刚存的用户消息而导致重复。
    """
    conn = get_connection()
    conv = conn.execute(
        "SELECT * FROM conversations WHERE id = ?", (cid,)
    ).fetchone()
    if not conv:
        raise HTTPException(404, "对话不存在")

    # 生成用户消息 ID（先不写库，交给 _stream_response 的 done 事件）
    msg_id = str(uuid.uuid4())[:8]

    provider, _ = _resolve_provider(conn, body.provider_id)
    messages = _build_chat_messages(conn, cid, body.message)
    return _stream_response(messages, provider, cid,
                            user_msg_id=msg_id, user_text=body.message)


@router.post("/chat/{cid}/regenerate")
async def regenerate(cid: str, body: ChatRequest):
    """
    重新生成最后一条回复。
    删除最后一条 assistant 消息 → 取最后一条用户消息 → SSE 流式回复。
    不会重复 INSERT 用户消息（与 chat_stream 的关键区别）。
    """
    conn = get_connection()
    conv = conn.execute(
        "SELECT * FROM conversations WHERE id = ?", (cid,)
    ).fetchone()
    if not conv:
        raise HTTPException(404, "对话不存在")

    # 删除最后一条 assistant 消息
    last_assistant = conn.execute(
        """SELECT id FROM messages
           WHERE conversation_id = ? AND role = 'assistant'
           ORDER BY created_at DESC LIMIT 1""",
        (cid,),
    ).fetchone()
    if last_assistant:
        conn.execute("DELETE FROM messages WHERE id = ?", (last_assistant["id"],))
        conn.commit()

    # 取最后一条用户消息（不 INSERT）
    last_user = conn.execute(
        """SELECT content FROM messages
           WHERE conversation_id = ? AND role = 'user'
           ORDER BY created_at DESC LIMIT 1""",
        (cid,),
    ).fetchone()
    if not last_user:
        raise HTTPException(400, "没有找到用户消息，无法重新生成")

    user_text = last_user["content"]
    provider, _ = _resolve_provider(conn, body.provider_id)
    # 传 exclude_last_user=True：用户消息已在 DB 中，
    # build_messages 不应再从历史中读它然后 append 两次
    messages = _build_chat_messages(conn, cid, user_text, exclude_last_user=True)
    return _stream_response(messages, provider, cid)
