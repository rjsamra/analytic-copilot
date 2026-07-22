"""14-day user-approved query cache with embedding similarity."""

from __future__ import annotations

import json
import sqlite3
import struct
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Callable, Optional

CACHE_DB = Path(__file__).parent / "data" / "query_cache.db"
CACHE_TTL_DAYS = 14
SIMILARITY_THRESHOLD = 0.92


def _connect() -> sqlite3.Connection:
    CACHE_DB.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(CACHE_DB))
    conn.row_factory = sqlite3.Row
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS cache_entries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_profile_id TEXT NOT NULL,
            metric_id TEXT NOT NULL,
            params_hash TEXT NOT NULL,
            natural_language TEXT NOT NULL,
            sql TEXT NOT NULL,
            assumptions_json TEXT,
            approved_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            embedding BLOB
        )
        """
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_cache_lookup ON cache_entries(user_profile_id, metric_id, params_hash)"
    )
    conn.commit()
    return conn


def _pack_embedding(vec: list[float]) -> bytes:
    return struct.pack(f"{len(vec)}f", *vec)


def _unpack_embedding(blob: bytes) -> list[float]:
    n = len(blob) // 4
    return list(struct.unpack(f"{n}f", blob))


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    if len(a) != len(b) or not a:
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = sum(x * x for x in a) ** 0.5
    nb = sum(x * x for x in b) ** 0.5
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


class QueryCache:
    def __init__(self, embed_fn: Callable[[str], list[float]] | None = None):
        self.embed_fn = embed_fn

    def lookup(
        self,
        user_profile_id: str,
        metric_id: str,
        params_hash: str,
        natural_language: str = "",
    ) -> Optional[dict[str, Any]]:
        now = datetime.utcnow().isoformat()
        conn = _connect()
        try:
            row = conn.execute(
                """
                SELECT * FROM cache_entries
                WHERE user_profile_id = ? AND metric_id = ? AND params_hash = ?
                  AND expires_at > ?
                ORDER BY approved_at DESC LIMIT 1
                """,
                (user_profile_id, metric_id, params_hash, now),
            ).fetchone()
            if row:
                return dict(row)

            if natural_language and self.embed_fn:
                rows = conn.execute(
                    """
                    SELECT * FROM cache_entries
                    WHERE user_profile_id = ? AND metric_id = ? AND expires_at > ?
                    """,
                    (user_profile_id, metric_id, now),
                ).fetchall()
                if rows:
                    q_emb = self.embed_fn(natural_language)
                    best = None
                    best_sim = 0.0
                    for r in rows:
                        if r["embedding"]:
                            sim = _cosine_similarity(q_emb, _unpack_embedding(r["embedding"]))
                            if sim > best_sim:
                                best_sim = sim
                                best = r
                    if best and best_sim >= SIMILARITY_THRESHOLD:
                        result = dict(best)
                        result["similarity"] = best_sim
                        return result
            return None
        finally:
            conn.close()

    def store(
        self,
        user_profile_id: str,
        metric_id: str,
        params_hash: str,
        natural_language: str,
        sql: str,
        assumptions: list[str] | None = None,
    ) -> dict[str, Any]:
        now = datetime.utcnow()
        expires = now + timedelta(days=CACHE_TTL_DAYS)
        embedding = None
        if self.embed_fn:
            try:
                embedding = _pack_embedding(self.embed_fn(natural_language))
            except Exception:
                embedding = None

        conn = _connect()
        try:
            conn.execute(
                """
                INSERT INTO cache_entries
                (user_profile_id, metric_id, params_hash, natural_language, sql,
                 assumptions_json, approved_at, expires_at, embedding)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    user_profile_id,
                    metric_id,
                    params_hash,
                    natural_language,
                    sql,
                    json.dumps(assumptions or []),
                    now.isoformat(),
                    expires.isoformat(),
                    embedding,
                ),
            )
            conn.commit()
        finally:
            conn.close()

        return {
            "user_profile_id": user_profile_id,
            "metric_id": metric_id,
            "params_hash": params_hash,
            "approved_at": now.isoformat(),
            "expires_at": expires.isoformat(),
        }

    def invalidate(
        self,
        user_profile_id: str,
        metric_id: str | None = None,
        params_hash: str | None = None,
    ) -> int:
        conn = _connect()
        try:
            if params_hash and metric_id:
                cur = conn.execute(
                    "DELETE FROM cache_entries WHERE user_profile_id = ? AND metric_id = ? AND params_hash = ?",
                    (user_profile_id, metric_id, params_hash),
                )
            elif metric_id:
                cur = conn.execute(
                    "DELETE FROM cache_entries WHERE user_profile_id = ? AND metric_id = ?",
                    (user_profile_id, metric_id),
                )
            else:
                cur = conn.execute(
                    "DELETE FROM cache_entries WHERE user_profile_id = ?",
                    (user_profile_id,),
                )
            conn.commit()
            return cur.rowcount
        finally:
            conn.close()


_cache: QueryCache | None = None


def get_query_cache(embed_fn: Callable[[str], list[float]] | None = None) -> QueryCache:
    global _cache
    if _cache is None:
        _cache = QueryCache(embed_fn=embed_fn)
    elif embed_fn and _cache.embed_fn is None:
        _cache.embed_fn = embed_fn
    return _cache
