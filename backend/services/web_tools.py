"""
AI 可调用的联网工具定义 + 执行
"""

import re
import httpx
from urllib.parse import urljoin, urlparse
from bs4 import BeautifulSoup

# ─── 工具定义（OpenAI tool calling 格式）───────────

WEB_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "fetch_webpage",
            "description": "获取一个网页的文本内容（去除 HTML/CSS/JS），并提取页面上的所有链接。AI 可以通过这些链接继续浏览，实现类似点击跳转的效果。适用于阅读文章、文档、新闻等。",
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {
                        "type": "string",
                        "description": "要读取的完整 URL，包含 https://"
                    }
                },
                "required": ["url"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "search_web",
            "description": "搜索互联网，返回相关结果的标题、摘要和链接。适用于查找最新的信息、新闻、百科等。",
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
            "name": "view_image",
            "description": "查看一张图片的内容。AI 通过这个工具可以像眼睛一样看到图片并描述它。适用于：分析网页截图、查看图片详情、识别图片中的文字等。",
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {
                        "type": "string",
                        "description": "图片的完整 URL"
                    },
                    "question": {
                        "type": "string",
                        "description": "针对图片的问题，如「这张图里有什么？」"
                    }
                },
                "required": ["url"]
            }
        }
    },
]


# ─── 执行函数 ──────────────────────────────

_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/125.0.0.0 Safari/537.36"
)


def _extract_text(html: str, base_url: str = "") -> tuple[str, list[dict], list[dict]]:
    """从 HTML 提取可读文本 + 页面内链接列表 + 图片列表"""
    soup = BeautifulSoup(html, "html.parser")

    # 去掉无用元素
    for tag in soup(["script", "style", "nav", "footer", "header",
                     "noscript", "iframe", "svg", "form", "input",
                     "button", "select", "textarea"]):
        tag.decompose()

    # 提取有意义的文本块
    lines = []
    for tag in soup.find_all(["p", "h1", "h2", "h3", "h4", "h5", "h6",
                               "li", "blockquote", "pre", "td", "th",
                               "div", "span", "article", "section"]):
        text = tag.get_text(strip=True)
        if text and len(text) > 15:
            lines.append(text)

    # 取标题
    title = soup.title.string.strip() if soup.title and soup.title.string else ""
    body = "\n\n".join(lines)

    # 去重行（相邻重复）
    unique = []
    prev = ""
    for line in body.split("\n\n"):
        if line != prev:
            unique.append(line)
            prev = line
    body = "\n\n".join(unique)

    result = title + "\n\n" + body if title else body

    # 提取链接
    links = []
    seen = set()
    for a in soup.find_all("a", href=True):
        href = a["href"].strip()
        if not href or href.startswith(("#", "javascript:", "mailto:")):
            continue
        full_url = urljoin(base_url, href)
        if not full_url.startswith(("http://", "https://")):
            continue
        normalized = full_url.rstrip("/")
        if normalized in seen:
            continue
        seen.add(normalized)
        text = a.get_text(strip=True)[:80]
        links.append({"url": full_url, "text": text or full_url})

    # 提取图片
    images = []
    seen_img = set()
    for img in soup.find_all("img", src=True):
        src = img["src"].strip()
        if not src:
            continue
        full_url = urljoin(base_url, src)
        if not full_url.startswith(("http://", "https://")):
            continue
        if full_url in seen_img:
            continue
        seen_img.add(full_url)
        alt = img.get("alt", "").strip()[:80]
        width = img.get("width", "")
        images.append({"url": full_url, "alt": alt or "(无描述)", "width": width})

    return result[:30000], links[:50], images[:30]


def _search_bing(query: str) -> str:
    """通过 Bing HTML 搜索获取结果（国内可访问）"""
    url = "https://cn.bing.com/search"
    # 强制 IPv4，避免异步环境 DNS 解析问题
    transport = httpx.HTTPTransport(local_address="0.0.0.0", retries=2)
    try:
        with httpx.Client(timeout=15, follow_redirects=True, transport=transport) as client:
            resp = client.get(url, params={"q": query, "cc": "cn"}, headers={
                "User-Agent": _USER_AGENT,
            })
            resp.raise_for_status()

        soup = BeautifulSoup(resp.text, "html.parser")
        results = []

        for item in soup.select("li.b_algo"):
            title_el = item.select_one("h2 a")
            if not title_el:
                continue
            title = title_el.get_text(strip=True)
            link = title_el.get("href", "")
            snippet_el = item.select_one(".b_caption p")
            snippet = snippet_el.get_text(strip=True) if snippet_el else ""
            results.append(f"{title}\n    {snippet}\n    {link}")

        if not results:
            return f"搜索「{query}」没有找到结果"

        return f"搜索「{query}」共 {len(results)} 条结果：\n\n" + "\n\n".join(results[:10])

    except Exception as e:
        return f"搜索失败: {e}"


def execute_web_tool(tool_name: str, args: dict, provider: dict | None = None) -> str:
    """执行联网工具，返回文本结果"""

    if tool_name == "fetch_webpage":
        url = args["url"]
        if not url.startswith(("http://", "https://")):
            return "❌ URL 必须以 http:// 或 https:// 开头"

        try:
            transport = httpx.HTTPTransport(local_address="0.0.0.0", retries=2)
            with httpx.Client(timeout=20, follow_redirects=True, transport=transport) as client:
                resp = client.get(url, headers={"User-Agent": _USER_AGENT})
                resp.raise_for_status()
            text, links, images = _extract_text(resp.text, url)
            output = f"📄 {url}\n\n{text}"
            if images:
                output += "\n\n━━━ 页面图片 ━━━\n"
                for i, img in enumerate(images, 1):
                    w = f" [{img['width']}px]" if img['width'] else ""
                    output += f"{i}. {img['alt']}{w}\n   {img['url']}\n"
            if links:
                output += "\n\n━━━ 页面链接 ━━━\n"
                for i, lnk in enumerate(links, 1):
                    output += f"{i}. {lnk['text']}\n   {lnk['url']}\n"
            return output
        except Exception as e:
            return f"❌ 读取网页失败: {e}"

    elif tool_name == "search_web":
        query = args["query"]
        return _search_bing(query)

    elif tool_name == "view_image":
        url = args["url"]
        question = args.get("question", "请详细描述这张图片的内容")
        if not provider:
            return "❌ 查看图片需要 API 线路配置"
        try:
            # 下载图片
            transport_img = httpx.HTTPTransport(local_address="0.0.0.0", retries=2)
            with httpx.Client(timeout=15, follow_redirects=True, transport=transport_img) as client:
                resp = client.get(url, headers={"User-Agent": _USER_AGENT})
                resp.raise_for_status()
            import base64
            img_b64 = base64.b64encode(resp.content).decode()
            content_type = resp.headers.get("content-type", "image/jpeg")

            # 调用 vision API
            vision_payload = {
                "model": provider["model"],
                "messages": [
                    {"role": "user", "content": [
                        {"type": "text", "text": question},
                        {"type": "image_url", "image_url": {"url": f"data:{content_type};base64,{img_b64}"}},
                    ]},
                ],
                "stream": False,
            }
            with httpx.Client(timeout=30) as client:
                vr = client.post(
                    f"{provider['base_url'].rstrip('/')}/chat/completions",
                    json=vision_payload,
                    headers={"Authorization": f"Bearer {provider['api_key']}", "Content-Type": "application/json"},
                )
                vr.raise_for_status()
                result = vr.json()
            description = result["choices"][0]["message"]["content"]
            return f"📷 {url}\n\n{description}"
        except Exception as e:
            return f"❌ 查看图片失败: {e}"

    return f"❌ 未知工具: {tool_name}"
