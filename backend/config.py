"""
全局配置常量
"""

import os

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
DB_PATH = os.path.join(DATA_DIR, "mouse.db")
FRONTEND_DIR = os.path.join(BASE_DIR, "frontend")

HOST = "127.0.0.1"
PORT = 8086

# 工作间（workspace）能碰的范围：默认就是项目根目录，可用环境变量指到别处
WORKSPACE_ROOT = os.environ.get("MOUSE_WORKSPACE_ROOT", BASE_DIR + os.sep)

# 默认 API 配置
DEFAULT_MODEL = "gpt-3.5-turbo"

# 上下文管理
MAX_HISTORY_MESSAGES = 50
MAX_CONTEXT_TOKENS = 200000

# 自动总结（当历史太多时，用 LLM 总结旧消息代替直接丢弃）
ENABLE_AUTO_SUMMARY = True
SUMMARY_TRIGGER_COUNT = 30       # 当消息总数超过此值时触发总结
KEEP_RECENT_MESSAGES = 15        # 总结后保留最近多少条完整消息
SUMMARY_TIMEOUT = 60             # 总结请求的超时秒数（短超时避免阻塞）
SUMMARY_PROMPT = ("请把以上对话中较旧的部分压缩成一份详细的中文摘要，"
                  "语气自然平实，就像在梳理之前聊过什么一样。\n"
                  "摘要要求：\n"
                  "- 保留关键决策、重要事实、定义的形成过程、情绪走向和长期项目的进展\n"
                  "- 记录具体细节和关键原话，不要只留结论\n"
                  "- 尽量详细，控制在600字以内")
