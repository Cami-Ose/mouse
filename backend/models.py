"""
Pydantic 数据模型
"""

import json
from pydantic import BaseModel, Field, field_validator
from typing import Optional


# ─── API 线路 ─────────────────────────────────────────────

class ProviderCreate(BaseModel):
    name: str
    base_url: str
    api_key: str
    model: str


class ProviderUpdate(BaseModel):
    name: Optional[str] = None
    base_url: Optional[str] = None
    api_key: Optional[str] = None
    model: Optional[str] = None


class ProviderResponse(BaseModel):
    id: str
    name: str
    base_url: str
    api_key: str
    model: str
    is_default: bool
    created_at: str


# ─── 世界书 ───────────────────────────────────────────────

class WorldEntryCreate(BaseModel):
    title: str
    content: str
    summary: str = ""
    keywords: list[str] = Field(default_factory=list)
    enabled: bool = True
    priority: int = 0
    category: str = ""
    subcategory: str = ""
    position: str = "system"
    type: str = "note"


class WorldEntryUpdate(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    summary: Optional[str] = None
    keywords: Optional[list[str]] = None
    enabled: Optional[bool] = None
    priority: Optional[int] = None
    category: Optional[str] = None
    subcategory: Optional[str] = None
    position: Optional[str] = None
    type: Optional[str] = None


class WorldEntryResponse(BaseModel):
    id: str
    title: str
    content: str
    summary: str = ""
    keywords: list[str]
    enabled: bool
    priority: int
    category: str
    subcategory: str = ""
    position: str
    type: str = "note"
    created_at: str
    updated_at: str
    hit_count: int = 0

    @field_validator("keywords", mode="before")
    @classmethod
    def parse_keywords(cls, v):
        if isinstance(v, str):
            try:
                return json.loads(v)
            except (json.JSONDecodeError, TypeError):
                return [v] if v else []
        return v or []


class MatchTestRequest(BaseModel):
    text: str


class MatchTestResult(BaseModel):
    matched_entries: list[dict]


# ─── 对话 ─────────────────────────────────────────────────

DEFAULT_SYSTEM_PROMPT = """你是一个聊天助手。请如实回答，不确定就说不确定，不要把推测讲成事实；不替用户改写他的话，有不同理解时说明「这是我的理解」。语气自然平实，别用模板化安慰和说教。回复长短随内容，能一句话说完就一句话。"""


class ConversationCreate(BaseModel):
    title: str = "新对话"
    # 对话自己的 system_prompt；留空则用全局 persona（global_config.persona → DEFAULT_SYSTEM_PROMPT）
    system_prompt: str = ""


class ConversationUpdate(BaseModel):
    title: Optional[str] = None
    system_prompt: Optional[str] = None


class ConversationResponse(BaseModel):
    id: str
    title: str
    system_prompt: str
    folder_id: Optional[str] = None
    created_at: str
    updated_at: str


# ─── 聊天文件夹 ────────────────────────────────────────────────

class ChatFolderCreate(BaseModel):
    name: str
    sort_order: int = 0


class ChatFolderUpdate(BaseModel):
    name: Optional[str] = None
    sort_order: Optional[int] = None


class ChatFolderResponse(BaseModel):
    id: str
    name: str
    sort_order: int
    created_at: str
    updated_at: str


# ─── 消息 ─────────────────────────────────────────────────

class MessageResponse(BaseModel):
    id: str
    conversation_id: str
    role: str
    content: str
    created_at: str


class MessageUpdate(BaseModel):
    content: str


# ─── 聊天 ─────────────────────────────────────────────────

class ChatRequest(BaseModel):
    message: str = ""
    provider_id: Optional[str] = None
    image: Optional[str] = None  # base64 编码的图片数据（旧版单图，兼容）
    images: Optional[list[str]] = None  # 多图 base64 数组
    files: Optional[list[dict]] = None  # [{url, name, type, size}] 文件附件
    user_msg_id: Optional[str] = None  # 编辑后重新生成时，指定编辑的是哪条用户消息
    world_entry_ids: Optional[list[str]] = None  # 手动携带的世界书条目 ID（有值则只用这些，跳过自动匹配）
