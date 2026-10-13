"""
关键词匹配引擎 — 两级匹配

- 精确命中 ✅: 关键词命中 / 正则 / token≥2
- 可能关联 🔗: token≥1 或标题 2 字匹配 或同父分类辅助
"""

import re
import json
import uuid
from database import get_connection


def _split_tokens(text: str) -> list[str]:
    """提取文本中的有意义的 token：中文词（2+字）、拉丁单词、数字"""
    tokens = []
    tokens.extend(re.findall(r'[一-鿿]{3,}', text))  # 中文连续 3+ 字
    tokens.extend(re.findall(r'[a-zA-Z]\w*', text))          # 英文单词
    return tokens


def match_world_entries_detailed(text: str, conversation_id: str | None = None) -> dict:
    """
    两级匹配，返回 {'exact': [...], 'fuzzy': [...]}

    exact: 精确命中（关键词/正则/token≥2）— 全文注入
    fuzzy: 可能关联（token≥1/标题2字/同父分类）— 提示关联
    """
    conn = get_connection()
    rows = conn.execute(
        "SELECT * FROM world_entries WHERE enabled = 1 ORDER BY priority DESC"
    ).fetchall()

    # 用更多文本辅助匹配
    match_text = text
    if conversation_id:
        ctx = conn.execute(
            """SELECT content FROM messages
               WHERE conversation_id = ? AND role IN ('user', 'assistant')
               ORDER BY created_at DESC LIMIT 6""",
            (conversation_id,),
        ).fetchall()
        context_parts = [r["content"] for r in reversed(ctx)]
        context_parts.append(text)
        match_text = "\n".join(context_parts)

    text_lower = match_text.lower()
    input_tokens = _split_tokens(text_lower)

    exact_hits = []
    fuzzy_hits = []
    exact_ids = set()
    fuzzy_ids = set()

    # 先扫一遍精确命中，记下命中的父分类
    hit_parent_categories = set()
    for row in rows:
        try:
            keywords = json.loads(row["keywords"])
        except (json.JSONDecodeError, TypeError):
            keywords = []

        matched = False

        # a) / c) 关键词匹配（精确或正则）
        for kw in keywords:
            kw = kw.strip()
            if not kw:
                continue
            if kw.startswith("/") and kw.endswith("/") and len(kw) > 1:
                try:
                    pattern = kw[1:-1]
                    if re.search(pattern, text):
                        matched = True
                        break
                except re.error:
                    continue
            else:
                if kw.lower() in text_lower:
                    matched = True
                    break

        # b) 输入中的 token 出现在标题或内容里（≥2 命中）
        if not matched and input_tokens:
            title_content = (row["title"] + " " + (row["summary"] or "")).lower()
            match_count = sum(1 for token in input_tokens if token in title_content)
            if match_count >= 2:
                matched = True

        if matched:
            _increment_hit(conn, row["id"])
            exact_hits.append(_entry_dict(row, "exact"))
            exact_ids.add(row["id"])
            # 记录命中的父分类
            if row["category"]:
                hit_parent_categories.add(row["category"])

    # 第二遍：可能关联
    for row in rows:
        if row["id"] in exact_ids:
            continue  # 已精确命中，跳过

        title_lower = row["title"].lower()
        content_lower = (row["content"] + " " + (row["summary"] or "")).lower()
        summary_lower = (row["summary"] or "").lower()

        f_matched = False
        f_reason = ""

        # 条件1: 输入中的任意 token 出现在标题/内容中（放宽到≥1）
        if input_tokens:
            token_match = sum(1 for token in input_tokens
                              if token in title_lower or token in content_lower)
            if token_match >= 1:
                f_matched = True
                f_reason = "token命中"

        # 条件2: 条目标题中任意连续 2 字出现在输入中
        if not f_matched:
            title_bigrams = set()
            for i in range(len(row["title"]) - 1):
                bigram = row["title"][i:i+2]
                if re.search(r'[一-鿿]', bigram):  # 只中文
                    title_bigrams.add(bigram)
            for bigram in title_bigrams:
                if bigram in text:
                    f_matched = True
                    f_reason = f"标题字匹配「{bigram}」"
                    break

        # 条件3: 同父分类下已有精确命中条目
        if not f_matched and row["category"]:
            if row["category"] in hit_parent_categories:
                f_matched = True
                f_reason = "同分类关联"

        if f_matched:
            _increment_hit(conn, row["id"])
            fuzzy_hits.append(_entry_dict(row, "fuzzy", f_reason))
            fuzzy_ids.add(row["id"])

    # 可能关联最多 5 条
    fuzzy_hits = fuzzy_hits[:5]

    return {"exact": exact_hits, "fuzzy": fuzzy_hits}


def match_world_entries(text: str) -> list[dict]:
    """兼容旧接口：返回所有匹配条目（精确+可能）"""
    result = match_world_entries_detailed(text)
    return result["exact"] + result["fuzzy"]


def build_worldbook_system_text(text: str, conversation_id: str | None = None) -> str:
    """
    组装 system prompt 注入文本。
    persona/root 类型：全文注入
    其他类型：提示关联
    """
    result = match_world_entries_detailed(text, conversation_id)
    parts = []
    seen = set()

    # 精确命中 → 全文注入（persona 类型也在这）
    for e in result["exact"]:
        if e["id"] not in seen:
            seen.add(e["id"])
            parts.append(f"[世界书] {e['title']}：{e['content']}")

    # 可能关联 → 提示关联
    for e in result["fuzzy"]:
        if e["id"] not in seen:
            seen.add(e["id"])
            summary_text = e["summary"] or e["content"][:60]
            parts.append(f"📌 世界书关联：{e['title']} — {summary_text}（可查阅详情）")

    return "\n\n".join(parts)


def inject_world_entries(text: str, conversation_id: str, source_msg_id: str | None = None) -> list[dict]:
    """
    匹配世界书条目，将新匹配（尚未注入过的）条目作为 system 消息写入对话历史。
    返回新注入的条目列表。
    source_msg_id: 触发这条注入的用户消息 ID，用于编辑时精确清理。
    """
    result = match_world_entries_detailed(text)
    all_matched = result["exact"] + result["fuzzy"]
    if not all_matched:
        return []

    already_injected = get_already_injected_ids(conversation_id)
    fresh = [e for e in all_matched if e["id"] not in already_injected]
    if not fresh:
        return []

    conn = get_connection()
    output = []
    for e in fresh:
        mid = str(uuid.uuid4())[:8]
        if e["match_type"] == "exact":
            content = f"[世界书注入:{e['id']}] {e['title']}\n\n{e['content']}"
        else:
            summary_text = e.get("summary") or e.get("content", "")[:60]
            content = f"[世界书注入:{e['id']}] 📌 关联：{e['title']} — {summary_text}"
        if source_msg_id:
            content += f"\nmsg:{source_msg_id}"
        conn.execute(
            "INSERT INTO messages (id, conversation_id, role, content) VALUES (?, ?, 'system', ?)",
            (mid, conversation_id, content),
        )
        output.append({"id": e["id"], "title": e["title"], "match_type": e["match_type"]})

    conn.commit()
    return output


def get_already_injected_ids(conversation_id: str) -> set[str]:
    """获取当前对话中已注入的世界书条目 ID。"""
    conn = get_connection()
    rows = conn.execute(
        """SELECT content FROM messages
           WHERE conversation_id = ? AND role = 'system'
           AND content LIKE '[世界书注入:%'""",
        (conversation_id,),
    ).fetchall()
    ids = set()
    for row in rows:
        content = row["content"]
        if content.startswith("[世界书注入:") and "]" in content:
            entry_id = content[len("[世界书注入:"):content.index("]")]
            ids.add(entry_id)
    return ids


# ─── 辅助 ──────────────────────────────

def _entry_dict(row, match_type: str, reason: str = "") -> dict:
    rk = row.keys()
    return {
        "id": row["id"],
        "title": row["title"],
        "content": row["content"],
        "summary": row["summary"] if "summary" in rk and row["summary"] else "",
        "keywords": row["keywords"],
        "priority": row["priority"],
        "category": row["category"],
        "subcategory": row["subcategory"] if "subcategory" in rk and row["subcategory"] else "",
        "position": row["position"],
        "type": row["type"] if "type" in rk else "note",
        "hit_count": row["hit_count"] if "hit_count" in rk else 0,
        "match_type": match_type,
        "match_reason": reason,
    }


def _increment_hit(conn, entry_id: str):
    """命中计数 +1（静默，catch 异常）"""
    try:
        conn.execute(
            "UPDATE world_entries SET hit_count = COALESCE(hit_count, 0) + 1 WHERE id = ?",
            (entry_id,),
        )
        conn.commit()
    except Exception:
        pass
