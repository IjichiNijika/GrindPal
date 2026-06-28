"""
SQLite 数据库操作层
- users 表：账号 + bcrypt 密码哈希 + 偏好 JSON
- history 表：功能使用记录（user_id 外键）
- 单例连接 + 轻量迁移机制

安全：所有 SQL 使用参数化查询防注入
"""

import aiosqlite
import asyncio
import os
import logging
from datetime import datetime

DB_PATH = os.environ.get("GRINDPAL_DB_PATH") or os.path.join(os.path.dirname(__file__), "smarttext.db")

_db: aiosqlite.Connection | None = None
_lock = asyncio.Lock()   # 全局写操作串行化（用户/模板/知识库等）
_init_lock = asyncio.Lock()  # 初始化保护
_conv_locks: dict[int, asyncio.Lock] = {}  # 按 conversation_id 细粒度锁
_conv_locks_lock = asyncio.Lock()  # 保护 _conv_locks 字典的并发访问

# 用于 row_factory 的共享锁（避免设置/重置交替导致的竞态）
_row_factory_lock = asyncio.Lock()


async def _with_row_factory(db: aiosqlite.Connection) -> aiosqlite.Connection:
    """设置 row_factory 并加锁保护，返回的 db 已锁定；
    必须配合 _reset_row_factory 成对使用。"""
    await _row_factory_lock.acquire()
    db.row_factory = aiosqlite.Row
    return db


def _reset_row_factory(db: aiosqlite.Connection) -> None:
    """重置 row_factory 并释放锁（必须与 _with_row_factory 成对）"""
    db.row_factory = None
    _row_factory_lock.release()

async def _get_db() -> aiosqlite.Connection:
    """获取单例数据库连接（线程安全初始化）"""
    global _db
    if _db is not None:
        return _db
    async with _init_lock:
        if _db is not None:
            return _db
        _db = await aiosqlite.connect(DB_PATH)
        await _db.execute("PRAGMA journal_mode=DELETE")
        await _db.execute("PRAGMA foreign_keys=ON")
        return _db

async def _get_conv_lock(conv_id: int) -> asyncio.Lock:
    """获取指定对话的写锁，按需创建"""
    if conv_id in _conv_locks:
        return _conv_locks[conv_id]
    async with _conv_locks_lock:
        if conv_id not in _conv_locks:
            _conv_locks[conv_id] = asyncio.Lock()
        return _conv_locks[conv_id]

# ---- 建表语句 ----

CREATE_USERS = """
CREATE TABLE IF NOT EXISTS users (
id INTEGER PRIMARY KEY AUTOINCREMENT,
username TEXT NOT NULL UNIQUE,
password_hash TEXT NOT NULL,
preferences TEXT DEFAULT '{}',
created_at TEXT NOT NULL
);
"""

CREATE_HISTORY_V2 = """
CREATE TABLE IF NOT EXISTS history_v2 (
id INTEGER PRIMARY KEY AUTOINCREMENT,
user_id INTEGER NOT NULL,
type TEXT NOT NULL,
input_text TEXT NOT NULL,
result_text TEXT NOT NULL,
created_at TEXT NOT NULL,
FOREIGN KEY (user_id) REFERENCES users(id)
);
"""

CREATE_TEMPLATES = """
CREATE TABLE IF NOT EXISTS templates (
id INTEGER PRIMARY KEY AUTOINCREMENT,
user_id INTEGER NOT NULL,
name TEXT NOT NULL,
modules TEXT NOT NULL DEFAULT '[]',
system_prompt TEXT NOT NULL DEFAULT '',
output_style TEXT NOT NULL DEFAULT 'paragraph',
is_default INTEGER NOT NULL DEFAULT 0,
created_at TEXT NOT NULL,
FOREIGN KEY (user_id) REFERENCES users(id)
);
"""

CREATE_KB_COLLECTIONS = """
CREATE TABLE IF NOT EXISTS kb_collections (
id INTEGER PRIMARY KEY AUTOINCREMENT,
user_id INTEGER NOT NULL,
name TEXT NOT NULL,
created_at TEXT NOT NULL,
FOREIGN KEY (user_id) REFERENCES users(id)
);
"""

CREATE_KB_DOCS = """
CREATE TABLE IF NOT EXISTS kb_documents (
id INTEGER PRIMARY KEY AUTOINCREMENT,
collection_id INTEGER NOT NULL,
filename TEXT NOT NULL,
file_type TEXT NOT NULL,
file_size INTEGER NOT NULL DEFAULT 0,
created_at TEXT NOT NULL,
FOREIGN KEY (collection_id) REFERENCES kb_collections(id) ON DELETE CASCADE
);
"""

CREATE_KB_CHUNKS = """
CREATE TABLE IF NOT EXISTS kb_chunks (
id INTEGER PRIMARY KEY AUTOINCREMENT,
doc_id INTEGER NOT NULL,
chunk_index INTEGER NOT NULL,
content TEXT,
FOREIGN KEY (doc_id) REFERENCES kb_documents(id) ON DELETE CASCADE
);
"""

CREATE_TODOS = """
CREATE TABLE IF NOT EXISTS todos (
id INTEGER PRIMARY KEY AUTOINCREMENT,
user_id INTEGER NOT NULL,
assignee TEXT DEFAULT '',
task TEXT NOT NULL,
deadline TEXT DEFAULT '',
status TEXT DEFAULT 'pending',
source_record_id INTEGER,
created_at TEXT NOT NULL,
FOREIGN KEY (user_id) REFERENCES users(id)
);
"""

# ---- 迁移列表（版本号, SQL） ----
# 已执行的迁移版本存于 _db_version 表
_migrations = [
(1, "ALTER TABLE kb_documents ADD COLUMN preview TEXT DEFAULT ''"),
(2, "ALTER TABLE history_v2 ADD COLUMN parent_id INTEGER DEFAULT NULL"),
(3, "ALTER TABLE history_v2 ADD COLUMN tokens INTEGER DEFAULT 0"),
(4, "ALTER TABLE users ADD COLUMN security_question TEXT DEFAULT ''"),
(5, "ALTER TABLE users ADD COLUMN security_answer_hash TEXT DEFAULT ''"),
(6, "ALTER TABLE users ADD COLUMN login_attempts INTEGER DEFAULT 0"),
(7, "ALTER TABLE users ADD COLUMN locked_until TEXT DEFAULT ''"),
(8, "ALTER TABLE messages ADD COLUMN kb_chunks TEXT DEFAULT NULL"),
(9, "ALTER TABLE attachments ADD COLUMN message_id INTEGER DEFAULT NULL"),
]

async def init_db():
    """初始化数据库 + 顺序执行迁移"""
    db = await _get_db()

    # 基础建表
    await db.execute("CREATE TABLE IF NOT EXISTS _db_version (version INTEGER PRIMARY KEY)")
    await db.execute(CREATE_USERS)
    await db.execute(CREATE_HISTORY_V2)
    await db.execute(CREATE_TEMPLATES)
    await db.execute(CREATE_KB_COLLECTIONS)
    await db.execute(CREATE_KB_DOCS)
    await db.execute(CREATE_KB_CHUNKS)
    await db.execute(CREATE_TODOS)
    await db.execute(CREATE_CONVERSATIONS)
    await db.execute(CREATE_MESSAGES)
    await db.execute(CREATE_ATTACHMENTS)
    await db.execute(CREATE_MESSAGES_FTS)

    # FTS5 触发器：自动同步 messages 表变更
    await db.execute("""
        CREATE TRIGGER IF NOT EXISTS messages_fts_insert AFTER INSERT ON messages BEGIN
            INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
        END;
    """)
    await db.execute("""
        CREATE TRIGGER IF NOT EXISTS messages_fts_delete AFTER DELETE ON messages BEGIN
            INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.id, old.content);
        END;
    """)
    await db.execute("""
        CREATE TRIGGER IF NOT EXISTS messages_fts_update AFTER UPDATE ON messages BEGIN
            INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.id, old.content);
            INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
        END;
    """)

    # 检测并修复旧 FTS5 虚拟表 kb_chunks
    cur = await db.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='kb_chunks'")
    row = await cur.fetchone()
    if row and row[0] and 'VIRTUAL' in row[0].upper():
        await db.execute("DROP TABLE IF EXISTS kb_chunks")
        await db.execute(CREATE_KB_CHUNKS)

    # 顺序执行未执行的迁移
    cur = await db.execute("SELECT MAX(version) FROM _db_version")
    current = (await cur.fetchone())[0] or 0
    for ver, sql in _migrations:
        if ver > current:
            try:
                await db.execute(sql)
                await db.execute("INSERT INTO _db_version (version) VALUES (?)", (ver,))
            except Exception as e:
                import sys
                print(f"[WARN] 数据库迁移 v{ver} 失败: {e}", file=sys.stderr)
                pass  # 列已存在等情况，跳过但不静默
    await db.commit()

    # 创建常用查询索引
    await db.execute("CREATE INDEX IF NOT EXISTS idx_history_user_type ON history_v2(user_id, type, created_at)")
    await db.execute("CREATE INDEX IF NOT EXISTS idx_templates_user ON templates(user_id)")
    await db.execute("CREATE INDEX IF NOT EXISTS idx_todos_user ON todos(user_id)")
    await db.execute("CREATE INDEX IF NOT EXISTS idx_kb_docs_col ON kb_documents(collection_id)")
    await db.execute("CREATE INDEX IF NOT EXISTS idx_kb_chunks_doc ON kb_chunks(doc_id)")
    await db.execute("CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id, updated_at)")
    await db.execute("CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at)")

# ---- 用户操作 ----

async def create_user(username: str, password_hash: str) -> int | None:
    """创建用户，返回 user_id；用户名已存在返回 None"""
    now = datetime.now().isoformat()
    try:
        db = await _get_db()
        async with _lock:
            cursor = await db.execute(
                "INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)",
                (username.strip(), password_hash, now),
            )
            await db.commit()
            return cursor.lastrowid
    except aiosqlite.IntegrityError:
        return None

async def get_user_by_username(username: str) -> dict | None:
    """根据用户名查询用户"""
    db = await _get_db()
    db = await _with_row_factory(db)
    try:
        cursor = await db.execute(
        "SELECT * FROM users WHERE username = ?", (username.strip(),)
        )
        row = await cursor.fetchone()
        return dict(row) if row else None
    finally:
        _reset_row_factory(db)

async def get_user_by_id(user_id: int) -> dict | None:
    """根据 ID 查询用户"""
    db = await _get_db()
    db = await _with_row_factory(db)
    try:
        cursor = await db.execute("SELECT * FROM users WHERE id = ?", (user_id,))
        row = await cursor.fetchone()
        return dict(row) if row else None
    finally:
        _reset_row_factory(db)

async def update_user_preferences(user_id: int, preferences: str) -> bool:
    """更新用户偏好 JSON"""
    db = await _get_db()
    async with _lock:
        cursor = await db.execute(
        "UPDATE users SET preferences = ? WHERE id = ?",
        (preferences, user_id),
        )
        await db.commit()
        return cursor.rowcount > 0

async def update_user_password(user_id: int, password_hash: str) -> bool:
    """更新用户密码哈希"""
    db = await _get_db()
    async with _lock:
        cursor = await db.execute(
        "UPDATE users SET password_hash = ? WHERE id = ?",
        (password_hash, user_id),
        )
        await db.commit()
        return cursor.rowcount > 0

async def set_security_question(user_id: int, question: str, answer_hash: str) -> bool:
    """设置密保问题和答案"""
    db = await _get_db()
    async with _lock:
        cursor = await db.execute(
            "UPDATE users SET security_question = ?, security_answer_hash = ? WHERE id = ?",
            (question, answer_hash, user_id),
        )
        await db.commit()
        return cursor.rowcount > 0

async def get_security_question(username: str) -> str | None:
    """根据用户名获取密保问题（不返回答案）"""
    db = await _get_db()
    db = await _with_row_factory(db)
    try:
        cursor = await db.execute(
            "SELECT security_question FROM users WHERE username = ?",
            (username.strip(),),
        )
        row = await cursor.fetchone()
        if row and row["security_question"]:
            return row["security_question"]
        return None
    finally:
        _reset_row_factory(db)

async def verify_security_answer(username: str, answer_hash: str) -> bool:
    """验证密保答案（answer_hash 应是用 bcrypt hashpw 处理过的密文）"""
    import bcrypt
    db = await _get_db()
    db = await _with_row_factory(db)
    try:
        cursor = await db.execute(
            "SELECT security_answer_hash FROM users WHERE username = ?",
            (username.strip(),),
        )
        row = await cursor.fetchone()
        if row and row["security_answer_hash"]:
            try:
                return bcrypt.checkpw(answer_hash.encode("utf-8"), row["security_answer_hash"].encode("utf-8"))
            except Exception:
                return False
        return False
    finally:
        _reset_row_factory(db)

async def reset_password(username: str, new_password_hash: str) -> bool:
    """通过密保重置密码"""
    db = await _get_db()
    async with _lock:
        cursor = await db.execute(
            "UPDATE users SET password_hash = ? WHERE username = ?",
            (new_password_hash, username),
        )
        await db.commit()
        return cursor.rowcount > 0

async def record_login_failed(username: str) -> dict:
    """记录登录失败，返回 {attempts, locked_until} 供前端展示"""
    db = await _get_db()
    async with _lock:
        cur = await db.execute(
            "SELECT login_attempts FROM users WHERE username = ?",
            (username.strip(),),
        )
        row = await cur.fetchone()
        if not row:
            return {"attempts": 0, "locked_until": ""}
        attempts = (row[0] or 0) + 1
        locked_until = ""
        if attempts >= 5:
            from datetime import timedelta
            locked_until = (datetime.now() + timedelta(minutes=15)).isoformat()
        await db.execute(
            "UPDATE users SET login_attempts = ?, locked_until = ? WHERE username = ?",
            (attempts, locked_until, username.strip()),
        )
        await db.commit()
        return {"attempts": attempts, "locked_until": locked_until}

async def record_login_success(username: str) -> None:
    """登录成功后清零失败计数和锁定"""
    db = await _get_db()
    async with _lock:
        await db.execute(
            "UPDATE users SET login_attempts = 0, locked_until = '' WHERE username = ?",
            (username.strip(),),
        )
        await db.commit()

async def check_login_locked(username: str) -> dict | None:
    """检查账户是否被锁定。已过期则自动解锁并返回 None；仍在锁定中返回 {locked_until, remaining_minutes}"""
    db = await _get_db()
    db = await _with_row_factory(db)
    try:
        cur = await db.execute(
            "SELECT locked_until FROM users WHERE username = ?",
            (username.strip(),),
        )
        row = await cur.fetchone()
        if not row or not row["locked_until"]:
            return None
        try:
            locked_dt = datetime.fromisoformat(row["locked_until"])
            if datetime.now() >= locked_dt:
                # 锁定已过期，自动解锁
                async with _lock:
                    _reset_row_factory(db)  # 临时释放 row_factory 锁以执行写操作
                    await db.execute(
                        "UPDATE users SET login_attempts = 0, locked_until = '' WHERE username = ?",
                        (username.strip(),),
                    )
                    await db.commit()
                    db = await _with_row_factory(db)
                return None
            remaining = locked_dt - datetime.now()
            minutes = max(1, int(remaining.total_seconds() / 60) + 1)
            return {"locked_until": row["locked_until"], "remaining_minutes": minutes}
        except (ValueError, TypeError):
            return None
    finally:
        _reset_row_factory(db)

async def delete_user(user_id: int) -> bool:
    """注销账号：级联删除用户所有数据"""
    db = await _get_db()
    async with _lock:
        # 知识库：先删分块→文档→集合（不依赖 CASCADE，主动删避免残留）
        user_cols = await (await db.execute("SELECT id FROM kb_collections WHERE user_id=?", (user_id,))).fetchall()
        for (col_id,) in user_cols:
            docs = await (await db.execute("SELECT id FROM kb_documents WHERE collection_id=?", (col_id,))).fetchall()
            for (doc_id,) in docs:
                await db.execute("DELETE FROM kb_chunks WHERE doc_id=?", (doc_id,))
                await db.execute("DELETE FROM kb_documents WHERE id=?", (doc_id,))
            await db.execute("DELETE FROM kb_collections WHERE id=?", (col_id,))
        # 模板、待办、历史
        await db.execute("DELETE FROM templates WHERE user_id = ?", (user_id,))
        await db.execute("DELETE FROM todos WHERE user_id = ?", (user_id,))
        await db.execute("DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE user_id = ?)", (user_id,))
        await db.execute("DELETE FROM conversations WHERE user_id = ?", (user_id,))
        await db.execute("DELETE FROM history_v2 WHERE user_id = ?", (user_id,))
        # 最后删用户
        cursor = await db.execute("DELETE FROM users WHERE id = ?", (user_id,))
        await db.commit()
        return cursor.rowcount > 0

# ---- 历史记录操作 (V2，带 user_id) ----

async def add_history(user_id: int, type_: str, input_text: str, result_text: str,
    parent_id: int | None = None, tokens: int = 0) -> int:
    """插入历史记录，支持 parent_id 形成对话链，tokens 记录消耗"""
    now = datetime.now().isoformat()
    db = await _get_db()
    async with _lock:
        cursor = await db.execute(
        "INSERT INTO history_v2 (user_id, type, input_text, result_text, created_at, parent_id, tokens) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (user_id, type_, input_text, result_text, now, parent_id, tokens),
        )
        await db.commit()
        # 每个用户每种类型只保留最近 10 条
        await db.execute(
        """
        DELETE FROM history_v2 WHERE id NOT IN (
        SELECT id FROM history_v2 WHERE user_id = ? AND type = ? ORDER BY created_at DESC LIMIT 10
        ) AND user_id = ? AND type = ?
        """,
        (user_id, type_, user_id, type_),
        )
        await db.commit()
        return cursor.lastrowid

async def get_history(user_id: int, type_: str | None = None, limit: int = 10,
    offset: int = 0) -> list[dict]:
    """查询用户历史记录，支持分页"""
    db = await _get_db()
    db = await _with_row_factory(db)
    try:
        if type_:
            cursor = await db.execute(
            "SELECT * FROM history_v2 WHERE user_id = ? AND type = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
            (user_id, type_, limit, offset),
            )
        else:
            cursor = await db.execute(
            "SELECT * FROM history_v2 WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
            (user_id, limit, offset),
            )
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]
    finally:
        _reset_row_factory(db)

async def get_history_by_id(record_id: int, user_id: int) -> dict | None:
    """根据ID查询单条历史记录（仅限本人）"""
    db = await _get_db()
    db = await _with_row_factory(db)
    try:
        cursor = await db.execute(
        "SELECT * FROM history_v2 WHERE id = ? AND user_id = ?",
        (record_id, user_id),
        )
        row = await cursor.fetchone()
        return dict(row) if row else None
    finally:
        _reset_row_factory(db)

async def delete_history(record_id: int, user_id: int) -> bool:
    """删除历史记录（仅限本人）"""
    db = await _get_db()
    async with _lock:
        cursor = await db.execute(
        "DELETE FROM history_v2 WHERE id = ? AND user_id = ?",
        (record_id, user_id),
        )
        await db.commit()
        return cursor.rowcount > 0

# ---- 模板操作 ----

async def get_templates(user_id: int) -> list[dict]:
    """获取用户所有模板"""
    db = await _get_db()
    db = await _with_row_factory(db)
    try:
        cursor = await db.execute("SELECT * FROM templates WHERE user_id = ? ORDER BY created_at DESC", (user_id,))
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]
    finally:
        _reset_row_factory(db)

async def create_template(user_id: int, name: str, modules: str, system_prompt: str,
    output_style: str, is_default: int) -> int | None:
    """创建模板，返回 id"""
    import json as _json
    now = datetime.now().isoformat()
    try:
        db = await _get_db()
        async with _lock:
            if is_default:
                mods = _json.loads(modules)
                for m in mods:
                    safe_m = m.replace('%', r'\%').replace('_', r'\_')
                    await db.execute(
                        "UPDATE templates SET is_default=0 WHERE user_id=? AND modules LIKE ?",
                        (user_id, f'%"{safe_m}"%'))
            cursor = await db.execute(
                "INSERT INTO templates (user_id,name,modules,system_prompt,output_style,is_default,created_at) VALUES (?,?,?,?,?,?,?)",
                (user_id, name, modules, system_prompt, output_style, is_default, now))
            await db.commit()
            return cursor.lastrowid
    except Exception:
        return None

async def update_template(template_id: int, user_id: int, **kwargs) -> bool:
    """更新模板（仅限本人）"""
    import json as _json
    sets = []
    vals = []
    for k in ('name', 'modules', 'system_prompt', 'output_style', 'is_default'):
        if k in kwargs:
            sets.append(f"{k}=?")
            vals.append(kwargs[k])

    if not sets:
        return False

    vals.extend([template_id, user_id])
    db = await _get_db()
    async with _lock:
        if kwargs.get('is_default'):
            mods = _json.loads(kwargs.get('modules', '[]'))
            for m in mods:
                safe_m = m.replace('%', r'\%').replace('_', r'\_')
                await db.execute(
                    "UPDATE templates SET is_default=0 WHERE user_id=? AND id!=? AND modules LIKE ?",
                    (user_id, template_id, f'%"{safe_m}"%'))
        cursor = await db.execute(
            f"UPDATE templates SET {', '.join(sets)} WHERE id=? AND user_id=?",
            vals)
        await db.commit()
        return cursor.rowcount > 0

async def delete_template(template_id: int, user_id: int) -> bool:
    """删除模板（仅限本人）"""
    db = await _get_db()
    async with _lock:
        cursor = await db.execute("DELETE FROM templates WHERE id=? AND user_id=?", (template_id, user_id))
        await db.commit()
        return cursor.rowcount > 0

# ---- 知识库操作 ----
KB_CHUNK_SIZE = 800
KB_OVERLAP = 100

async def kb_create_collection(user_id: int, name: str) -> int | None:
    now = datetime.now().isoformat()
    try:
        db = await _get_db()
        async with _lock:
            c = await db.execute("INSERT INTO kb_collections(user_id,name,created_at) VALUES(?,?,?)", (user_id, name, now))
            await db.commit()
            return c.lastrowid
    except Exception:
        return None

async def kb_list_collections(user_id: int) -> list[dict]:
    db = await _get_db()
    db = await _with_row_factory(db)
    try:
        c = await db.execute("SELECT * FROM kb_collections WHERE user_id=? ORDER BY created_at DESC", (user_id,))
        rows = await c.fetchall()
        return [dict(r) for r in rows]
    finally:
        _reset_row_factory(db)

async def kb_delete_collection(col_id: int, user_id: int) -> bool:
    db = await _get_db()
    async with _lock:
        # 先验证所有权
        owner_check = await (await db.execute(
        "SELECT id FROM kb_collections WHERE id=? AND user_id=?", (col_id, user_id)
        )).fetchone()
        if not owner_check:
            return False
        # 级联删除文档和分块（利用建表时的 ON DELETE CASCADE）
        await db.execute("DELETE FROM kb_collections WHERE id=?", (col_id,))
        await db.commit()
        return True

async def kb_list_docs(col_id: int, user_id: int) -> list[dict]:
    """列出知识库中的文档（仅限本人）"""
    db = await _get_db()
    db = await _with_row_factory(db)
    try:
        c = await db.execute(
        """SELECT kd.* FROM kb_documents kd
        JOIN kb_collections kc ON kd.collection_id = kc.id
        WHERE kd.collection_id = ? AND kc.user_id = ?
        ORDER BY kd.created_at DESC""", (col_id, user_id))
        rows = await c.fetchall()
        return [dict(r) for r in rows]
    finally:
        _reset_row_factory(db)

async def kb_add_document(collection_id: int, filename: str, file_type: str,
    file_size: int, chunks: list[str], user_id: int = None) -> int | None:
    now = datetime.now().isoformat()
    preview = '\n'.join(chunks)[:300] if chunks else ''
    db = await _get_db()
    async with _lock:
        # 验证所有权（如果提供了 user_id）
        if user_id is not None:
            owner = await (await db.execute(
            "SELECT id FROM kb_collections WHERE id=? AND user_id=?", (collection_id, user_id)
            )).fetchone()
            if not owner:
                return None
        c = await db.execute("INSERT INTO kb_documents(collection_id,filename,file_type,file_size,preview,created_at) VALUES(?,?,?,?,?,?)",
            (collection_id, filename, file_type, file_size, preview, now))
        doc_id = c.lastrowid
        for i, chunk in enumerate(chunks):
            await db.execute("INSERT INTO kb_chunks(doc_id,chunk_index,content) VALUES(?,?,?)", (doc_id, i, chunk))
        await db.commit()
        return doc_id

async def kb_search(user_id: int, query_keywords: str, limit: int = 3, collection_ids: list[int] | None = None) -> list[dict]:
    """关键词检索（按命中数打分排序），返回相关 chunk 及来源文件名。
    collection_ids 支持单个或多个集合 ID 列表，为 None 时搜该用户所有集合。"""
    if not query_keywords or not query_keywords.strip():
        return []
    db = await _get_db()
    db = await _with_row_factory(db)
    try:
        keywords = query_keywords.split(" OR ")

        # 构造打分 SQL：每个关键词命中 +1 分
        score_exprs = []
        like_params = []
        for kw in keywords:
            score_exprs.append(f"CASE WHEN kc.content LIKE ? THEN 1 ELSE 0 END")
            like_params.append(f"%{kw}%")
        score_sql = " + ".join(score_exprs)

        params = like_params + [user_id]  # LIKE 参数在前（SELECT 子句），user_id 在后（WHERE 子句）

        if collection_ids:
            placeholders = ",".join("?" for _ in collection_ids)
            col_filter = f"AND kd.collection_id IN ({placeholders})"
            params += collection_ids
        else:
            col_filter = ""

        # 多关键词时要求足够命中数，避免常见词误匹配（WHERE 里重复 score_sql 需额外参数）
        if len(keywords) >= 4:
            min_filter = f"AND ({score_sql}) >= 3"
            params += like_params  # min_filter 里的 LIKE 参数
        elif len(keywords) >= 2:
            min_filter = f"AND ({score_sql}) >= 2"
            params += like_params
        else:
            min_filter = ""

        params.append(limit)
        rows = await db.execute(
        f"""SELECT kc.content, kd.filename, kc.doc_id, ({score_sql}) AS score
        FROM kb_chunks kc
        JOIN kb_documents kd ON kc.doc_id = kd.id
        JOIN kb_collections kcol ON kd.collection_id = kcol.id
        WHERE kcol.user_id = ? {col_filter} {min_filter}
        ORDER BY score DESC
        LIMIT ?""",
        params)
        result = [dict(r) for r in await rows.fetchall()]
        return result
    finally:
        _reset_row_factory(db)

async def kb_delete_document(doc_id: int, user_id: int) -> bool:
    """删除知识库中的单个文档（仅限本人）"""
    db = await _get_db()
    async with _lock:
        c = await db.execute(
        """DELETE FROM kb_documents WHERE id = ? AND collection_id IN
        (SELECT id FROM kb_collections WHERE user_id = ?)""",
        (doc_id, user_id))
        if c.rowcount > 0:
            await db.execute("DELETE FROM kb_chunks WHERE doc_id = ?", (doc_id,))
            await db.commit()
            return c.rowcount > 0

def _chunk_text(text: str) -> list[str]:
    """简单分块：每 KB_CHUNK_SIZE 字一块，重叠 KB_OVERLAP 字"""
    chunks = []
    start = 0
    while start < len(text):
        end = min(start + KB_CHUNK_SIZE, len(text))
        chunks.append(text[start:end])
        if end >= len(text):
            break
        start = end - KB_OVERLAP
    return chunks

# ---- 待办操作 ----

async def add_todo(user_id: int, assignee: str, task: str, deadline: str,
    source_record_id: int | None) -> int | None:
    now = datetime.now().isoformat()
    db = await _get_db()
    async with _lock:
        c = await db.execute(
        "INSERT INTO todos(user_id,assignee,task,deadline,source_record_id,created_at) VALUES(?,?,?,?,?,?)",
        (user_id, assignee, task, deadline, source_record_id, now))
        await db.commit()
        return c.lastrowid

async def get_todos(user_id: int) -> list[dict]:
    db = await _get_db()
    db = await _with_row_factory(db)
    try:
        c = await db.execute("SELECT * FROM todos WHERE user_id=? ORDER BY created_at DESC", (user_id,))
        rows = await c.fetchall()
        return [dict(r) for r in rows]
    finally:
        _reset_row_factory(db)

async def update_todo_status(todo_id: int, user_id: int, status: str) -> bool:
    db = await _get_db()
    async with _lock:
        c = await db.execute("UPDATE todos SET status=? WHERE id=? AND user_id=?", (status, todo_id, user_id))
        await db.commit()
        return c.rowcount > 0

async def update_todo(todo_id: int, user_id: int, task: str, assignee: str, deadline: str) -> bool:
    """编辑待办内容"""
    db = await _get_db()
    async with _lock:
        c = await db.execute(
        "UPDATE todos SET task=?, assignee=?, deadline=? WHERE id=? AND user_id=?",
        (task, assignee, deadline, todo_id, user_id))
        await db.commit()
        return c.rowcount > 0

async def delete_todo(todo_id: int, user_id: int) -> bool:
    """删除待办"""
    db = await _get_db()
    async with _lock:
        c = await db.execute("DELETE FROM todos WHERE id=? AND user_id=?", (todo_id, user_id))
        await db.commit()
        return c.rowcount > 0

# ---- 多轮对话 ----

async def get_history_chain(record_id: int, user_id: int, max_depth: int = 3) -> list[dict]:
    """回溯对话链，最多 max_depth 层"""
    chain = []
    current_id = record_id
    db = await _get_db()
    db = await _with_row_factory(db)
    try:
        for _ in range(max_depth):
            c = await db.execute(
            "SELECT * FROM history_v2 WHERE id=? AND user_id=?", (current_id, user_id))
            row = await c.fetchone()
            if not row:
                break
            r = dict(row)
            chain.insert(0, r)
            next_id = r.get("parent_id")
            if not next_id:
                break
            current_id = next_id
    finally:
        _reset_row_factory(db)
    return chain


# ============================================================
#  自由对话（conversations + messages）
# ============================================================

CREATE_CONVERSATIONS = """
CREATE TABLE IF NOT EXISTS conversations (
id INTEGER PRIMARY KEY AUTOINCREMENT,
user_id INTEGER NOT NULL,
title TEXT NOT NULL DEFAULT '新对话',
created_at TEXT NOT NULL,
updated_at TEXT NOT NULL,
FOREIGN KEY (user_id) REFERENCES users(id)
);
"""

CREATE_MESSAGES = """
CREATE TABLE IF NOT EXISTS messages (
id INTEGER PRIMARY KEY AUTOINCREMENT,
conversation_id INTEGER NOT NULL,
role TEXT NOT NULL,
content TEXT NOT NULL,
created_at TEXT NOT NULL,
FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);
"""

CREATE_ATTACHMENTS = """
CREATE TABLE IF NOT EXISTS attachments (
id INTEGER PRIMARY KEY AUTOINCREMENT,
conversation_id INTEGER NOT NULL,
filename TEXT NOT NULL,
file_type TEXT NOT NULL DEFAULT 'document',
file_path TEXT NOT NULL,
preview TEXT DEFAULT '',
created_at TEXT NOT NULL,
FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);
"""

# FTS5 全文搜索虚拟表（用于对话消息搜索）
CREATE_MESSAGES_FTS = """
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
    content,
    content_rowid='id',
    content='messages',
    tokenize='unicode61'
);
"""

async def create_conversation(user_id: int, title: str = "新对话") -> int | None:
    """创建新对话，返回 conversation_id"""
    now = datetime.now().isoformat()
    try:
        db = await _get_db()
        async with _lock:
            c = await db.execute(
                "INSERT INTO conversations (user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
                (user_id, title, now, now),
            )
            await db.commit()
            return c.lastrowid
    except Exception:
        return None


async def list_conversations(user_id: int, limit: int = 100, offset: int = 0) -> list[dict]:
    """列出用户的所有对话，按 updated_at 降序"""
    db = await _get_db()
    db = await _with_row_factory(db)
    try:
        c = await db.execute(
            """SELECT c.*,
               (SELECT content FROM messages WHERE conversation_id = c.id AND role = 'user' ORDER BY created_at ASC LIMIT 1) AS first_message,
               (SELECT content FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_message,
               (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id) AS message_count
               FROM conversations c WHERE c.user_id = ? ORDER BY c.updated_at DESC LIMIT ? OFFSET ?""",
            (user_id, limit, offset),
        )
        rows = await c.fetchall()
        return [dict(r) for r in rows]
    finally:
        _reset_row_factory(db)


async def get_conversation(conv_id: int, user_id: int) -> dict | None:
    """获取单条对话（仅限本人）"""
    db = await _get_db()
    db = await _with_row_factory(db)
    try:
        c = await db.execute(
            "SELECT * FROM conversations WHERE id = ? AND user_id = ?",
            (conv_id, user_id),
        )
        row = await c.fetchone()
        return dict(row) if row else None
    finally:
        _reset_row_factory(db)


async def rename_conversation(conv_id: int, user_id: int, title: str) -> bool:
    """重命名对话"""
    db = await _get_db()
    lock = await _get_conv_lock(conv_id)
    async with lock:
        c = await db.execute(
            "UPDATE conversations SET title = ? WHERE id = ? AND user_id = ?",
            (title, conv_id, user_id),
        )
        await db.commit()
        return c.rowcount > 0


async def delete_conversation(conv_id: int, user_id: int) -> bool:
    """删除对话及其所有消息（仅限本人）"""
    db = await _get_db()
    async with _lock:
        await db.execute("DELETE FROM messages WHERE conversation_id = ?", (conv_id,))
        c = await db.execute(
            "DELETE FROM conversations WHERE id = ? AND user_id = ?",
            (conv_id, user_id),
        )
        await db.commit()
        return c.rowcount > 0


async def _touch_conversation(conv_id: int) -> None:
    """更新对话的 updated_at 时间戳（调用者需持有 _lock）"""
    db = await _get_db()
    now = datetime.now().isoformat()
    await db.execute(
        "UPDATE conversations SET updated_at = ? WHERE id = ?",
        (now, conv_id),
    )


async def add_message(conv_id: int, role: str, content: str, kb_chunks: str | None = None) -> int | None:
    """向对话中添加一条消息，返回 message_id"""
    now = datetime.now().isoformat()
    try:
        db = await _get_db()
        async with _lock:
            c = await db.execute(
                "INSERT INTO messages (conversation_id, role, content, kb_chunks, created_at) VALUES (?, ?, ?, ?, ?)",
                (conv_id, role, content, kb_chunks, now),
            )
            await db.commit()
            await _touch_conversation(conv_id)
        rowid = c.lastrowid
        logger = logging.getLogger("grindpal.db")
        if rowid:
            logger.info(f"add_message OK conv={conv_id} role={role} msg_id={rowid}")
        else:
            logger.error(f"add_message lastrowid is None/0 conv={conv_id} role={role}")
        return rowid
    except Exception:
        logger = logging.getLogger("grindpal.db")
        logger.exception(f"add_message failed conv={conv_id} role={role}")
        return None


async def update_message_content(msg_id: int, content: str, kb_chunks: str | None = None, final: bool = False) -> bool:
    """更新消息内容（用于流式输出过程中保存部分内容）。
    final=True 时直接覆盖 kb_chunks（允许清空），否则用 COALESCE 保留旧值。
    """
    try:
        db = await _get_db()
        async with _lock:
            if final:
                await db.execute(
                    "UPDATE messages SET content = ?, kb_chunks = ? WHERE id = ?",
                    (content, kb_chunks, msg_id),
                )
            else:
                await db.execute(
                    "UPDATE messages SET content = ?, kb_chunks = COALESCE(?, kb_chunks) WHERE id = ?",
                    (content, kb_chunks, msg_id),
                )
            await db.commit()
        return True
    except Exception:
        logger = logging.getLogger("grindpal.db")
        logger.exception(f"update_message_content failed msg_id={msg_id}")
        return False


async def get_messages(conv_id: int, limit: int = 200, offset: int = 0) -> list[dict]:
    """获取对话的所有消息，按创建时间升序，支持分页"""
    db = await _get_db()
    db = await _with_row_factory(db)
    try:
        c = await db.execute(
            "SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT ? OFFSET ?",
            (conv_id, limit, offset),
        )
        rows = await c.fetchall()
        return [dict(r) for r in rows]
    finally:
        _reset_row_factory(db)


async def add_attachment(conv_id: int, filename: str, file_type: str, file_path: str, preview: str = "") -> int | None:
    """添加聊天附件，返回 attachment_id"""
    now = datetime.now().isoformat()
    try:
        db = await _get_db()
        c = await db.execute(
            "INSERT INTO attachments (conversation_id, filename, file_type, file_path, preview, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (conv_id, filename, file_type, file_path, preview, now),
        )
        await db.commit()
        return c.lastrowid
    except Exception:
        return None


async def get_attachments(conv_id: int, att_ids: list[int] | None = None) -> list[dict]:
    """获取对话附件，可按 ID 列表筛选"""
    db = await _get_db()
    db = await _with_row_factory(db)
    try:
        if att_ids:
            placeholders = ','.join('?' * len(att_ids))
            c = await db.execute(
                f"SELECT * FROM attachments WHERE id IN ({placeholders}) AND conversation_id = ?",
                (*att_ids, conv_id),
            )
        else:
            c = await db.execute(
                "SELECT * FROM attachments WHERE conversation_id = ? ORDER BY created_at ASC",
                (conv_id,),
            )
        rows = await c.fetchall()
        return [dict(r) for r in rows]
    finally:
        _reset_row_factory(db)


async def link_attachments_to_message(conv_id: int, message_id: int, att_ids: list[int]) -> None:
    """将附件关联到指定消息"""
    if not att_ids:
        return
    db = await _get_db()
    placeholders = ','.join('?' * len(att_ids))
    try:
        await db.execute(
            f"UPDATE attachments SET message_id = ? WHERE id IN ({placeholders}) AND conversation_id = ?",
            (message_id, *att_ids, conv_id),
        )
        await db.commit()
    except Exception:
        logger = logging.getLogger("grindpal.db")
        logger.exception("link_attachments_to_message failed")


async def get_attachments_by_msg_ids(conv_id: int, msg_ids: list[int]) -> dict[int, list[dict]]:
    """按消息 ID 批量获取附件，返回 {message_id: [attachment, ...]}"""
    if not msg_ids:
        return {}
    db = await _get_db()
    db = await _with_row_factory(db)
    try:
        placeholders = ','.join('?' * len(msg_ids))
        c = await db.execute(
            f"SELECT * FROM attachments WHERE conversation_id = ? AND message_id IN ({placeholders}) ORDER BY created_at ASC",
            (conv_id, *msg_ids),
        )
        rows = await c.fetchall()
        result = {}
        for r in rows:
            d = dict(r)
            mid = d.get("message_id")
            if mid:
                result.setdefault(mid, []).append(d)
        return result
    finally:
        _reset_row_factory(db)


async def search_messages(user_id: int, query: str, limit: int = 20) -> list[dict]:
    """全文搜索用户的所有对话消息，返回匹配结果（含对话标题）"""
    db = await _get_db()
    db = await _with_row_factory(db)
    try:
        # 使用 FTS5 的 highlight 获取匹配片段
        c = await db.execute(
            """SELECT m.id, m.conversation_id, m.role, m.content,
                      c.title AS conversation_title,
                      snippet(messages_fts, 1, '<<<', '>>>', '...', 32) AS snippet
               FROM messages_fts fts
               JOIN messages m ON m.id = fts.rowid
               JOIN conversations c ON c.id = m.conversation_id
               WHERE c.user_id = ? AND messages_fts MATCH ?
               ORDER BY rank
               LIMIT ?""",
            (user_id, query, limit),
        )
        rows = await c.fetchall()
        return [dict(r) for r in rows]
    finally:
        _reset_row_factory(db)


async def delete_last_assistant_message(conv_id: int) -> bool:
    """删除对话中最后一条 assistant 消息（用于重新生成）"""
    db = await _get_db()
    c = await db.execute(
        "SELECT id FROM messages WHERE conversation_id = ? AND role = 'assistant' ORDER BY created_at DESC LIMIT 1",
        (conv_id,),
    )
    row = await c.fetchone()
    if row:
        await db.execute("DELETE FROM messages WHERE id = ?", (row[0],))
        await db.commit()
        return True
    return False


async def delete_last_message_pair(conv_id: int) -> int:
    """删除对话中最后一条 user→assistant 消息对（用于 regenerate 回退）。
    按时间顺序取最后两条，仅当它们构成 user→assistant 对时才删除。
    避免对话以单条 user 结尾时误删上一轮消息。
    """
    db = await _get_db()
    c = await db.execute(
        "SELECT id, role FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 2",
        (conv_id,),
    )
    rows = await c.fetchall()
    if len(rows) < 2:
        return 0
    # rows[0] 是最新的，rows[1] 是倒数第二
    newer_role, newer_id = rows[0][1], rows[0][0]
    older_role, older_id = rows[1][1], rows[1][0]
    if older_role == "user" and newer_role == "assistant":
        await db.execute("DELETE FROM messages WHERE id = ?", (newer_id,))
        await db.execute("DELETE FROM messages WHERE id = ?", (older_id,))
        await db.commit()
        return 2
    return 0


async def truncate_messages_after(conv_id: int, after_index: int) -> int:
    """[已废弃] 删除对话中第 after_index 条之后的所有消息（0-based）。
    请改用 truncate_messages_from(conv_id, from_msg_id) 基于消息 ID 精确截断。"""
    db = await _get_db()
    c = await db.execute(
        "SELECT id FROM messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT ? OFFSET ?",
        (conv_id, 10000, after_index),
    )
    ids = [row[0] for row in await c.fetchall()]
    for mid in ids:
        await db.execute("DELETE FROM messages WHERE id = ?", (mid,))
    if ids:
        await db.commit()
    return len(ids)


async def truncate_messages_from(conv_id: int, from_msg_id: int, inclusive: bool = True) -> int:
    """删除对话中指定消息及其之后的所有消息（基于消息 ID 精确截断）。
    若 inclusive=False，则仅删除 from_msg_id 之后的消息（不含 from_msg_id 本身）。
    返回删除条数；若消息不存在则返回 0。"""
    db = await _get_db()
    c = await db.execute(
        "SELECT created_at FROM messages WHERE id = ? AND conversation_id = ?",
        (from_msg_id, conv_id),
    )
    row = await c.fetchone()
    if not row:
        return 0
    ts = row[0]
    op = ">=" if inclusive else ">"
    ids_exclude = [from_msg_id] if not inclusive else []
    c2 = await db.execute(
        f"SELECT id FROM messages WHERE conversation_id = ? AND created_at {op} ?",
        (conv_id, ts),
    )
    ids = [r[0] for r in await c2.fetchall()]
    ids = [mid for mid in ids if mid not in ids_exclude]
    for mid in ids:
        await db.execute("DELETE FROM messages WHERE id = ?", (mid,))
    if ids:
        await db.commit()
    return len(ids)


async def delete_message_by_id(conv_id: int, msg_id: int) -> bool:
    """根据消息 ID 精确删除（避免竞态），返回是否成功"""
    db = await _get_db()
    c = await db.execute(
        "DELETE FROM messages WHERE id = ? AND conversation_id = ?",
        (msg_id, conv_id),
    )
    await db.commit()
    return c.rowcount > 0


async def get_conversation_title(conv_id: int) -> str | None:
    """根据第一条用户消息自动生成标题（取前30字）"""
    db = await _get_db()
    db = await _with_row_factory(db)
    try:
        c = await db.execute(
            "SELECT content FROM messages WHERE conversation_id = ? AND role = 'user' ORDER BY created_at ASC LIMIT 1",
            (conv_id,),
        )
        row = await c.fetchone()
        if row:
            text = row["content"].strip()[:30]
            if len(text) == 30:
                text += "…"
            return text or "新对话"
        return "新对话"
    finally:
        _reset_row_factory(db)
