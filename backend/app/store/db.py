"""IndexStore：SQLite 索引的读写封装（集中索引，可重建）。

表结构：
- files        文件索引（rel_path 唯一，含内容 hash、标签、元信息）
- files_fts    FTS5 全文索引（trigram 分词，external content 关联 files）
              v2 起索引列：title, rel_path, tags, meta, content
- settings     键值设置（含 index_schema_version，用于无损升级 FTS 结构）
- recovery     崩溃恢复草稿登记
"""
from __future__ import annotations

import functools
import json
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Iterable, Optional, TypeVar

from ..config import INDEX_DB_PATH

_F = TypeVar("_F", bound=Callable)


def _locked(method: _F) -> _F:
    """包装 IndexStore 的 DB 方法：同一 RLock 下串行执行（P1-9）。

    FastAPI 线程池与 fs_watch 线程共用同一 sqlite3.Connection
    （check_same_thread=False），无锁时会产生 Recursive use of cursors
    与事务交错；RLock 可重入，connect 内嵌套调用 _init_schema 等安全。
    """

    @functools.wraps(method)
    def wrapper(self, *args, **kwargs):
        with self._lock:
            return method(self, *args, **kwargs)

    return wrapper

# 当前 FTS 结构版本：修改 files_fts 列定义时必须递增并触发重建
_FTS_SCHEMA_VERSION = 2

_SCHEMA_BASE = """
CREATE TABLE IF NOT EXISTS files (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  rel_path     TEXT NOT NULL UNIQUE,
  kind         TEXT NOT NULL DEFAULT 'document',   -- document | module | attachment
  title        TEXT NOT NULL DEFAULT '',
  tags         TEXT NOT NULL DEFAULT '[]',
  meta         TEXT NOT NULL DEFAULT '{}',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  content      TEXT NOT NULL DEFAULT '',
  content_hash TEXT NOT NULL DEFAULT '',
  size         INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS recovery (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_path   TEXT NOT NULL,
  draft_path TEXT NOT NULL,
  saved_at   TEXT NOT NULL,
  session_id TEXT NOT NULL DEFAULT ''
);
"""

_FTS_COLUMNS = "title, rel_path, tags, meta, content"

_FTS_SQL = f"""
CREATE VIRTUAL TABLE files_fts USING fts5(
  {_FTS_COLUMNS},
  content='files', content_rowid='id',
  tokenize='trigram'
);

CREATE TRIGGER IF NOT EXISTS files_ai AFTER INSERT ON files BEGIN
  INSERT INTO files_fts(rowid, title, rel_path, tags, meta, content)
  VALUES (new.id, new.title, new.rel_path, new.tags, new.meta, new.content);
END;
CREATE TRIGGER IF NOT EXISTS files_ad AFTER DELETE ON files BEGIN
  INSERT INTO files_fts(files_fts, rowid, title, rel_path, tags, meta, content)
  VALUES ('delete', old.id, old.title, old.rel_path, old.tags, old.meta, old.content);
END;
CREATE TRIGGER IF NOT EXISTS files_au AFTER UPDATE ON files BEGIN
  INSERT INTO files_fts(files_fts, rowid, title, rel_path, tags, meta, content)
  VALUES ('delete', old.id, old.title, old.rel_path, old.tags, old.meta, old.content);
  INSERT INTO files_fts(rowid, title, rel_path, tags, meta, content)
  VALUES (new.id, new.title, new.rel_path, new.tags, new.meta, new.content);
END;
"""


def utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class IndexStore:
    """SQLite 索引封装。线程安全策略：单连接 + 每次操作 commit。"""

    def __init__(self, db_path: Path = INDEX_DB_PATH):
        self.db_path = Path(db_path)
        self.conn: Optional[sqlite3.Connection] = None
        self._lock = threading.RLock()

    # ---------- 生命周期 ----------

    @_locked
    def connect(self) -> "IndexStore":
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(str(self.db_path), check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        try:
            self.conn.execute("PRAGMA journal_mode=WAL")
            self.conn.execute("PRAGMA synchronous=NORMAL")
            self._init_schema()
        except Exception:
            # 初始化失败（如索引文件损坏）时关闭已创建的连接，避免遗留文件句柄
            # 阻塞调用方删除损坏文件（Windows 文件锁）
            try:
                self.conn.close()
            except Exception:
                pass
            self.conn = None
            raise
        return self

    def _init_schema(self) -> None:
        assert self.conn is not None
        self.conn.executescript(_SCHEMA_BASE)
        # files.meta 列（v2 新增；老库补列，幂等）
        try:
            self.conn.execute(
                "ALTER TABLE files ADD COLUMN meta TEXT NOT NULL DEFAULT '{}'"
            )
        except sqlite3.OperationalError:
            pass  # 列已存在
        self._ensure_fts()
        self.conn.commit()

    def _ensure_fts(self) -> None:
        """按 index_schema_version 保证 files_fts 结构为当前版本。

        v2：索引列 title/rel_path/tags/meta/content。结构升级时删除旧
        FTS 重建；files 表数据不受影响，启动时全量 rebuild 会重灌 FTS。
        """
        assert self.conn is not None
        ver = 0
        row = self.conn.execute(
            "SELECT value FROM settings WHERE key = 'index_schema_version'"
        ).fetchone()
        if row:
            try:
                ver = int(row["value"])
            except ValueError:
                ver = 0
        if ver >= _FTS_SCHEMA_VERSION:
            return
        self.conn.execute("DROP TRIGGER IF EXISTS files_ai")
        self.conn.execute("DROP TRIGGER IF EXISTS files_ad")
        self.conn.execute("DROP TRIGGER IF EXISTS files_au")
        self.conn.execute("DROP TABLE IF EXISTS files_fts")
        self.conn.executescript(_FTS_SQL)
        self.conn.execute(
            "INSERT INTO settings(key, value) VALUES('index_schema_version', ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (str(_FTS_SCHEMA_VERSION),),
        )

    @_locked
    def close(self) -> None:
        if self.conn is not None:
            self.conn.close()
            self.conn = None

    # ---------- settings ----------

    @_locked
    def get_setting(self, key: str) -> Optional[str]:
        assert self.conn is not None
        row = self.conn.execute(
            "SELECT value FROM settings WHERE key = ?", (key,)
        ).fetchone()
        return row["value"] if row else None

    @_locked
    def set_setting(self, key: str, value: str) -> None:
        assert self.conn is not None
        self.conn.execute(
            "INSERT INTO settings(key, value) VALUES(?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, value),
        )
        self.conn.commit()

    # ---------- files ----------

    @_locked
    def upsert_file(
        self,
        rel_path: str,
        kind: str,
        title: str,
        content: str,
        content_hash: str,
        size: int,
        tags: Optional[list[str]] = None,
        meta: Optional[dict[str, Any]] = None,
    ) -> None:
        assert self.conn is not None
        now = utcnow_iso()
        tags_json = json.dumps(tags or [], ensure_ascii=False)
        meta_json = json.dumps(meta or {}, ensure_ascii=False)
        self.conn.execute(
            """
            INSERT INTO files(rel_path, kind, title, tags, meta, created_at, updated_at,
                              content, content_hash, size)
            VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(rel_path) DO UPDATE SET
              kind = excluded.kind,
              title = excluded.title,
              tags = excluded.tags,
              meta = excluded.meta,
              updated_at = excluded.updated_at,
              content = excluded.content,
              content_hash = excluded.content_hash,
              size = excluded.size
            """,
            (
                rel_path, kind, title, tags_json, meta_json, now, now,
                content, content_hash, size,
            ),
        )
        self.conn.commit()

    @_locked
    def delete_file(self, rel_path: str) -> None:
        assert self.conn is not None
        self.conn.execute("DELETE FROM files WHERE rel_path = ?", (rel_path,))
        self.conn.commit()

    @staticmethod
    def _row_to_dict(row) -> dict[str, Any]:
        out = dict(row)
        try:
            out["tags"] = json.loads(out.get("tags") or "[]")
        except ValueError:
            out["tags"] = []
        try:
            out["meta"] = json.loads(out.get("meta") or "{}")
        except ValueError:
            out["meta"] = {}
        return out

    @_locked
    def get_file(self, rel_path: str) -> Optional[dict[str, Any]]:
        assert self.conn is not None
        row = self.conn.execute(
            "SELECT * FROM files WHERE rel_path = ?", (rel_path,)
        ).fetchone()
        return self._row_to_dict(row) if row else None

    @_locked
    def list_files(
        self, kind: Optional[str] = None, prefix: Optional[str] = None
    ) -> list[dict[str, Any]]:
        assert self.conn is not None
        where: list[str] = []
        params: list[Any] = []
        if kind:
            where.append("kind = ?")
            params.append(kind)
        if prefix:
            where.append("(rel_path = ? OR rel_path LIKE ?)")
            params.extend([prefix, f"{prefix}/%"])
        sql = "SELECT * FROM files"
        if where:
            sql += " WHERE " + " AND ".join(where)
        sql += " ORDER BY updated_at DESC"
        rows = self.conn.execute(sql, params).fetchall()
        return [self._row_to_dict(r) for r in rows]

    @_locked
    def clear_files(self) -> None:
        """清空文件索引（供全量重建）。"""
        assert self.conn is not None
        self.conn.execute("DELETE FROM files")
        self.conn.execute("INSERT INTO files_fts(files_fts) VALUES('rebuild')")
        self.conn.commit()

    # ---------- search ----------

    @_locked
    def search(self, query: str, limit: int = 50) -> list[dict[str, Any]]:
        """搜索（决策点 3：SQLite FTS5 集中索引；Phase 4.4 扩展字段）。

        索引列：title / rel_path / tags / meta / content。
        - 查询词 >= 3 字符：FTS5 trigram 跨全部索引列（文件名、路径、标签、
          frontmatter 元信息、正文均可命中），按 bm25 排序；
        - 查询词 < 3 字符：trigram 不命中短 token，降级为 LIKE 全表扫描；
        - 非法查询语法降级为空结果，不抛异常。
        """
        assert self.conn is not None
        q = query.strip()
        if not q:
            return []
        if len(q) < 3:
            pattern = f"%{q}%"
            try:
                rows = self.conn.execute(
                    """
                    SELECT id, rel_path, kind, title, updated_at,
                           substr(content, 1, 160) AS snippet
                    FROM files
                    WHERE content LIKE ? OR title LIKE ? OR rel_path LIKE ?
                          OR tags LIKE ?
                    ORDER BY updated_at DESC
                    LIMIT ?
                    """,
                    (pattern, pattern, pattern, pattern, limit),
                ).fetchall()
            except sqlite3.OperationalError:
                return []
            return [dict(r) for r in rows]
        try:
            rows = self.conn.execute(
                """
                SELECT f.id, f.rel_path, f.kind, f.title, f.updated_at,
                       snippet(files_fts, 4, '[', ']', '…', 24) AS snippet
                FROM files_fts
                JOIN files f ON f.id = files_fts.rowid
                WHERE files_fts MATCH ?
                ORDER BY bm25(files_fts)
                LIMIT ?
                """,
                (q, limit),
            ).fetchall()
        except sqlite3.OperationalError:
            return []
        return [dict(r) for r in rows]

    @_locked
    def list_by_tag(self, tag: str, limit: int = 200) -> list[dict[str, Any]]:
        """按标签精确筛选文件（tags 存 JSON 数组，json_each 精确匹配）。"""
        assert self.conn is not None
        try:
            rows = self.conn.execute(
                """
                SELECT id, rel_path, kind, title, updated_at, tags
                FROM files, json_each(files.tags)
                WHERE json_each.value = ?
                ORDER BY updated_at DESC
                LIMIT ?
                """,
                (tag, limit),
            ).fetchall()
        except sqlite3.OperationalError:
            # 极端环境无 JSON1：退化为 LIKE 匹配（含引号避免子串误命中）
            rows = self.conn.execute(
                """
                SELECT id, rel_path, kind, title, updated_at, tags
                FROM files
                WHERE tags LIKE ?
                ORDER BY updated_at DESC
                LIMIT ?
                """,
                (f'%"{tag}"%', limit),
            ).fetchall()
        return [dict(r) for r in rows]

    @_locked
    def list_tags(self) -> list[dict[str, Any]]:
        """聚合全部标签：{name, count}，按使用次数降序。"""
        assert self.conn is not None
        try:
            rows = self.conn.execute(
                """
                SELECT value AS name, COUNT(*) AS count
                FROM files, json_each(files.tags)
                GROUP BY value
                ORDER BY count DESC, name ASC
                """
            ).fetchall()
        except sqlite3.OperationalError:
            return []
        return [dict(r) for r in rows]

    # ---------- recovery ----------

    @_locked
    def add_recovery(self, doc_path: str, draft_path: str, session_id: str = "") -> None:
        """登记恢复点（Phase 6.2 起为 upsert：每份文档只保留最新一条）。"""
        assert self.conn is not None
        self.conn.execute("DELETE FROM recovery WHERE doc_path = ?", (doc_path,))
        self.conn.execute(
            "INSERT INTO recovery(doc_path, draft_path, saved_at, session_id) "
            "VALUES(?, ?, ?, ?)",
            (doc_path, draft_path, utcnow_iso(), session_id),
        )
        self.conn.commit()

    @_locked
    def get_recovery(self, doc_path: str) -> dict[str, Any] | None:
        assert self.conn is not None
        row = self.conn.execute(
            "SELECT * FROM recovery WHERE doc_path = ?", (doc_path,)
        ).fetchone()
        return self._row_to_dict(row) if row else None

    @_locked
    def list_recovery(self) -> list[dict[str, Any]]:
        assert self.conn is not None
        rows = self.conn.execute(
            "SELECT * FROM recovery ORDER BY saved_at DESC"
        ).fetchall()
        return [dict(r) for r in rows]

    @_locked
    def clear_recovery(self, doc_path: str) -> None:
        assert self.conn is not None
        self.conn.execute("DELETE FROM recovery WHERE doc_path = ?", (doc_path,))
        self.conn.commit()
