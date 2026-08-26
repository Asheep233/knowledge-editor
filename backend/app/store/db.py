"""IndexStore：SQLite 索引的读写封装（集中索引，可重建）。

表结构：
- files        文件索引（rel_path 唯一，含内容 hash、标签、元信息）
- files_fts    FTS5 全文索引（trigram 分词，external content 关联 files）
              v2 起索引列：title, rel_path, tags, meta, content
- settings     键值设置（含 index_schema_version，用于无损升级 FTS 结构）
- recovery     崩溃恢复草稿登记

线程安全（P1-9）：FastAPI 线程池 + fs_watch 线程共用同一 Connection
（check_same_thread=False）。全部公开方法经 threading.RLock 串行化，
避免 Recursive use of cursors / 事务交错。批量重建经 batch() 上下文，
一次事务原子提交（P2-6）。
"""
from __future__ import annotations

import functools
import json
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Optional

from ..config import INDEX_DB_PATH

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


def _escape_like(q: str) -> str:
    """转义 LIKE 通配符（P3-6：% _ 不再被当作通配符）。"""
    return q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _locked(fn):
    """把方法体包进 IndexStore._lock（P1-9：单连接多线程串行化）。"""

    @functools.wraps(fn)
    def wrapper(self, *args, **kwargs):
        with self._lock:
            return fn(self, *args, **kwargs)

    return wrapper


class IndexStore:
    """SQLite 索引封装。线程安全策略：单连接 + RLock 串行化 + 每次操作 commit。"""

    def __init__(self, db_path: Path = INDEX_DB_PATH):
        self.db_path = Path(db_path)
        self.conn: Optional[sqlite3.Connection] = None
        # P1-9：跨线程共享 Connection 的互斥锁（fastapi 线程池 + watcher 线程）
        self._lock = threading.RLock()
        self._in_batch = False

    # ---------- 生命周期 ----------

    def connect(self) -> "IndexStore":
        with self._lock:
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

    @_locked
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

    @_locked
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
        self.conn.commit()

    @_locked
    def close(self) -> None:
        if self.conn is not None:
            self.conn.close()
            self.conn = None

    @contextmanager
    def batch(self):
        """批量写事务上下文（P2-6）：内部操作不逐条 commit，退出时一次提交。

        重建索引期间读方仍可看到旧数据（WAL 快照），提交后整体可见；
        中途异常回滚，索引不出现半成品。
        """
        with self._lock:
            prev = self._in_batch
            self._in_batch = True
            try:
                yield self
            except BaseException:
                if not prev and self.conn is not None:
                    self.conn.rollback()
                raise
            finally:
                self._in_batch = prev
                if not prev and self.conn is not None:
                    self.conn.commit()

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
        if not self._in_batch:
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
        if not self._in_batch:
            self.conn.commit()

    @_locked
    def delete_file(self, rel_path: str) -> None:
        assert self.conn is not None
        self.conn.execute("DELETE FROM files WHERE rel_path = ?", (rel_path,))
        if not self._in_batch:
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
        if not self._in_batch:
            self.conn.commit()

    @_locked
    def count_files(self, kind: Optional[str] = None) -> Optional[int]:
        """按 kind 统计文件数；kind 为 None 时返回总数。"""
        assert self.conn is not None
        if kind is None:
            row = self.conn.execute("SELECT COUNT(*) AS n FROM files").fetchone()
        else:
            row = self.conn.execute(
                "SELECT COUNT(*) AS n FROM files WHERE kind = ?", (kind,)
            ).fetchone()
        return int(row["n"]) if row else None

    # ---------- search ----------

    @_locked
    def search(self, query: str, limit: int = 50) -> list[dict[str, Any]]:
        """搜索（决策点 3：SQLite FTS5 集中索引；Phase 4.4 扩展字段）。

        索引列：title / rel_path / tags / meta / content。
        - 查询词 >= 3 字符：FTS5 trigram 跨全部索引列（文件名、路径、标签、
          frontmatter 元信息、正文均可命中），按 bm25 排序；
        - 查询词 < 3 字符：trigram 不命中短 token，降级为 LIKE 全表扫描
          （P3-6：LIKE 通配符转义，支持 2 字中文子串）；
        - 非法查询语法依次尝试短语引号包裹，仍失败则返回空结果，不抛异常。
        """
        assert self.conn is not None
        q = query.strip()
        if not q:
            return []
        if len(q) < 3:
            pattern = f"%{_escape_like(q)}%"
            try:
                rows = self.conn.execute(
                    """
                    SELECT id, rel_path, kind, title, updated_at,
                           substr(content, 1, 160) AS snippet
                    FROM files
                    WHERE content LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\'
                          OR rel_path LIKE ? ESCAPE '\\' OR tags LIKE ? ESCAPE '\\'
                    ORDER BY updated_at DESC
                    LIMIT ?
                    """,
                    (pattern, pattern, pattern, pattern, limit),
                ).fetchall()
            except sqlite3.OperationalError:
                return []
            return [dict(r) for r in rows]
        for attempt in (q, f'"{q}"'):
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
                    (attempt, limit),
                ).fetchall()
                return [dict(r) for r in rows]
            except sqlite3.OperationalError:
                continue
        return []

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
