"""
OpenAI 兼容 API 调用 + 流式解析
"""

import json
import httpx
from typing import AsyncGenerator


class LLMClient:
    """轻量 OpenAI 兼容 API 客户端"""

    def __init__(self, base_url: str, api_key: str, model: str):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model = model

    async def chat_stream(
        self, messages: list[dict], tools: list | None = None, timeout: int = 120
    ) -> AsyncGenerator[dict, None]:
        """
        流式调用 chat completions，逐 token 产出：
          {"type": "token", "content": "..."}
          {"type": "tool_calls", "calls": [...]}  — AI 请求调用工具
          {"type": "done", "content": "完整回复"}
          {"type": "error", "content": "错误信息"}
        """
        url = f"{self.base_url}/chat/completions"
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": self.model,
            "messages": messages,
            "stream": True,
        }
        if tools:
            payload["tools"] = tools

        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(timeout)) as client:
                async with client.stream("POST", url, json=payload, headers=headers) as resp:
                    if resp.status_code != 200:
                        error_body = await resp.aread()
                        yield {"type": "error", "content": f"API 返回 {resp.status_code}: {error_body.decode('utf-8', errors='replace')[:500]}"}
                        return

                    full_content = ""
                    tool_calls_map = {}  # index → {"name": "", "arguments": "", "id": ""}
                    has_tool_calls = False

                    async for line in resp.aiter_lines():
                        if not line.startswith("data: "):
                            continue
                        data_str = line[6:].strip()
                        if data_str == "[DONE]":
                            break
                        try:
                            chunk = json.loads(data_str)
                            choices = chunk.get("choices")
                            if not choices:
                                continue
                            delta = choices[0].get("delta", {})
                            content = delta.get("content", "")
                            if content:
                                full_content += content
                                yield {"type": "token", "content": content}

                            # 累积 tool_calls（流式 arguments 分片到达）
                            if "tool_calls" in delta:
                                has_tool_calls = True
                                for tc in delta["tool_calls"]:
                                    idx = tc["index"]
                                    if idx not in tool_calls_map:
                                        tool_calls_map[idx] = {"name": "", "arguments": "", "id": tc.get("id") or ""}
                                    if tc.get("function", {}).get("name"):
                                        tool_calls_map[idx]["name"] += tc["function"]["name"]
                                    if tc.get("function", {}).get("arguments"):
                                        tool_calls_map[idx]["arguments"] += tc["function"]["arguments"]
                        except json.JSONDecodeError:
                            continue

                    if has_tool_calls:
                        calls = [
                            {"id": v["id"], "name": v["name"], "arguments": v["arguments"]}
                            for _, v in sorted(tool_calls_map.items())
                        ]
                        yield {"type": "tool_calls", "calls": calls}
                        return

                    yield {"type": "done", "content": full_content}

        except httpx.TimeoutException:
            yield {"type": "error", "content": "请求超时，请检查 API 线路是否可用"}
        except httpx.ConnectError:
            yield {"type": "error", "content": "连接失败，请检查 API 线路地址"}
        except Exception as e:
            yield {"type": "error", "content": f"请求异常: {str(e)}"}

    async def chat_once(self, messages: list[dict], tools: list | None = None, timeout: int = 120) -> str:
        """非流式调用，返回完整文字回复。用于 tool_call 二次请求。"""
        url = f"{self.base_url}/chat/completions"
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": self.model,
            "messages": messages,
            "stream": False,
        }
        if tools:
            payload["tools"] = tools

        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(timeout)) as client:
                resp = await client.post(url, json=payload, headers=headers)
                if resp.status_code != 200:
                    body = await resp.aread()
                    return f"[API 错误: {resp.status_code}: {body.decode('utf-8', errors='replace')[:200]}]"
                data = resp.json()
                choices = data.get("choices", [])
                if not choices:
                    return "[AI 未返回结果]"
                msg = choices[0].get("message", {})
                return msg.get("content") or ""
        except Exception as e:
            return f"[请求异常: {e}]"
