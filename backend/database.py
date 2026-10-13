"""
SQLite 初始化 + 连接管理
"""

import sqlite3
import os
from config import DB_PATH, DATA_DIR

# 单连接 — uvicorn 单进程多协程，check_same_thread=False + WAL 模式安全
_conn: sqlite3.Connection | None = None


def get_connection() -> sqlite3.Connection:
    """获取数据库连接（惰性初始化）"""
    global _conn
    if _conn is None:
        os.makedirs(DATA_DIR, exist_ok=True)
        _conn = sqlite3.connect(DB_PATH, check_same_thread=False)
        _conn.row_factory = sqlite3.Row
        _conn.execute("PRAGMA journal_mode=WAL")
        _conn.execute("PRAGMA foreign_keys=ON")
    return _conn


def init_db():
    """建表（幂等）"""
    conn = get_connection()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS conversations (
            id              TEXT PRIMARY KEY,
            title           TEXT NOT NULL DEFAULT '新对话',
            system_prompt   TEXT DEFAULT '',
            created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS messages (
            id              TEXT PRIMARY KEY,
            conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
            role            TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
            content         TEXT NOT NULL,
            created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS world_entries (
            id          TEXT PRIMARY KEY,
            title       TEXT NOT NULL,
            content     TEXT NOT NULL,
            keywords    TEXT NOT NULL,
            enabled     INTEGER DEFAULT 1,
            priority    INTEGER DEFAULT 0,
            category    TEXT DEFAULT '',
            position    TEXT DEFAULT 'system',
            created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS api_providers (
            id         TEXT PRIMARY KEY,
            name       TEXT NOT NULL,
            base_url   TEXT NOT NULL,
            api_key    TEXT NOT NULL,
            model      TEXT NOT NULL,
            is_default INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    """)

    # 迁移：world_entries 加 type 列（v2）
    try:
        conn.execute("ALTER TABLE world_entries ADD COLUMN type TEXT DEFAULT 'note'")
    except Exception:
        pass  # 列已存在

    # 迁移：messages 加 image_path 列（v3 - 图片持久化）
    try:
        conn.execute("ALTER TABLE messages ADD COLUMN image_path TEXT DEFAULT NULL")
    except Exception:
        pass  # 列已存在

    # 迁移：messages 加 tool_calls 列（v4 - 工具调用持久化）
    try:
        conn.execute("ALTER TABLE messages ADD COLUMN tool_calls TEXT DEFAULT NULL")
    except Exception:
        pass  # 列已存在

    # 迁移：messages 加 files 列（v5 - 文件附件）
    try:
        conn.execute("ALTER TABLE messages ADD COLUMN files TEXT DEFAULT NULL")
    except Exception:
        pass  # 列已存在

    # 迁移：conversations 加 summary 列（v6 - 自动总结）
    try:
        conn.execute("ALTER TABLE conversations ADD COLUMN summary TEXT DEFAULT NULL")
        conn.execute("ALTER TABLE conversations ADD COLUMN summary_updated_at TIMESTAMP DEFAULT NULL")
    except Exception:
        pass  # 列已存在

    # 迁移：global_config 表（v8 - 全局 persona）
    try:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS global_config (
                id INTEGER PRIMARY KEY,
                persona TEXT DEFAULT '',
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        # 确保 id=1 的行存在
        row = conn.execute("SELECT id FROM global_config WHERE id = 1").fetchone()
        if row is None:
            conn.execute("INSERT INTO global_config (id, persona) VALUES (1, '')")
        conn.commit()
    except Exception:
        pass  # 表已存在

    # 迁移：conversations 加 pins 列（v9 - 暂保留未用）
    try:
        conn.execute("ALTER TABLE conversations ADD COLUMN pins TEXT DEFAULT NULL")
    except Exception:
        pass  # 列已存在

    # 迁移：conversations 加 system_prompt 列（v14 - 漏掉的列）
    try:
        conn.execute("ALTER TABLE conversations ADD COLUMN system_prompt TEXT DEFAULT ''")
    except Exception:
        pass  # 列已存在

    # 迁移：world_entries 加 summary 列（v11 - 世界书摘要）
    try:
        conn.execute("ALTER TABLE world_entries ADD COLUMN summary TEXT DEFAULT ''")
    except Exception:
        pass  # 列已存在

    # 迁移：world_entries 加 hit_count 列（v12 - 世界书命中统计）
    try:
        conn.execute("ALTER TABLE world_entries ADD COLUMN hit_count INTEGER DEFAULT 0")
    except Exception:
        pass  # 列已存在

    # 迁移：world_entries 加 subcategory 列（v13 - 二级分类独立字段）
    try:
        conn.execute("ALTER TABLE world_entries ADD COLUMN subcategory TEXT DEFAULT ''")
    except Exception:
        pass  # 列已存在

    # 迁移已有数据：将 category 中的 "父/子" 拆分为 category + subcategory
    try:
        rows = conn.execute(
            "SELECT id, category FROM world_entries WHERE category LIKE '%/%'"
        ).fetchall()
        if rows:
            for r in rows:
                parts = r["category"].split("/", 1)
                conn.execute(
                    "UPDATE world_entries SET category = ?, subcategory = ? WHERE id = ?",
                    (parts[0].strip(), parts[1].strip(), r["id"]),
                )
            conn.commit()
            print(f"[migrate] 拆分 {len(rows)} 条二级分类数据")
    except Exception as e:
        print(f"[migrate] 拆分失败: {e}")

    # 迁移：空 summary 的旧条目自动用内容前 80 字填充
    try:
        cur = conn.execute("SELECT COUNT(*) FROM world_entries WHERE summary IS NULL OR summary = ''")
        empty_count = cur.fetchone()[0]
        if empty_count:
            conn.execute(
                "UPDATE world_entries SET summary = substr(content, 1, 80) WHERE summary IS NULL OR summary = ''"
            )
            conn.commit()
            print(f"[migrate] 自动填充 {empty_count} 条空 summary")
    except Exception as e:
        print(f"[migrate] 填充 summary 失败: {e}")

    # 迁移：cheese_library 表（v7 - 奶酪图书馆）
    conn.execute("""
        CREATE TABLE IF NOT EXISTS cheese_library (
            id         TEXT PRIMARY KEY,
            title      TEXT NOT NULL,
            content    TEXT NOT NULL,
            source_url TEXT DEFAULT '',
            folder     TEXT DEFAULT '',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # 迁移：聊天文件夹表（v15）
    conn.execute("""
        CREATE TABLE IF NOT EXISTS chat_folders (
            id         TEXT PRIMARY KEY,
            name       TEXT NOT NULL,
            sort_order INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    try:
        conn.execute("ALTER TABLE conversations ADD COLUMN folder_id TEXT DEFAULT NULL")
    except Exception:
        pass
    try:
        conn.execute("ALTER TABLE conversations ADD COLUMN sort_order INTEGER DEFAULT 0")
    except Exception:
        pass

    # 迁移：treasure_box 表（v16 - 宝箱）
    conn.execute("""
        CREATE TABLE IF NOT EXISTS treasure_box (
            id         TEXT PRIMARY KEY,
            content    TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    conn.commit()
