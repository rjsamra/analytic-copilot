"""FAISS-backed schema catalog for scoped table/column/scenario search."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Callable, Optional

import faiss
import numpy as np

METADATA_FILE = Path(__file__).parent / "data" / "metadata.json"
INDEX_FILE = Path(__file__).parent / "data" / "schema_catalog.faiss"
SIDECAR_FILE = Path(__file__).parent / "data" / "schema_catalog.json"


class SchemaCatalog:
    def __init__(self):
        self._index: faiss.IndexFlatIP | None = None
        self._entries: list[dict[str, Any]] = []
        self._dim: int = 0
        self._load()

    def _load(self) -> None:
        if INDEX_FILE.exists() and SIDECAR_FILE.exists():
            self._index = faiss.read_index(str(INDEX_FILE))
            with open(SIDECAR_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
            self._entries = data.get("entries", [])
            self._dim = data.get("dim", 0)

    @property
    def ready(self) -> bool:
        return self._index is not None and len(self._entries) > 0

    def build(self, embed_fn: Callable[[str], list[float]]) -> int:
        meta_path = os.getenv("META_DATA_FILE", str(METADATA_FILE))
        with open(meta_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        entries: list[dict[str, Any]] = []
        texts: list[str] = []

        for table_name, table_info in data.get("tables", {}).items():
            desc = table_info.get("description", "")
            cols = ", ".join(table_info.get("columns", []))
            text = f"Table {table_name}: {desc}. Columns: {cols}"
            entries.append({"table": table_name, "text": text, "type": "table"})
            texts.append(text)

        for rel in data.get("table_relationships", []):
            if len(rel) >= 3:
                text = f"Relationship: {rel[0]} to {rel[1]} — {rel[2]}"
                entries.append({"table": rel[0], "related": rel[1], "text": text, "type": "relationship"})
                texts.append(text)

        for scenario_name, scenario_info in data.get("analytic_scenarios", {}).items():
            desc = scenario_info.get("description", "")
            rules = scenario_info.get("rules", [])
            rules_text = "; ".join(str(r) for r in rules)
            text = f"Scenario {scenario_name}: {desc}. Rules: {rules_text}"
            entries.append({
                "scenario": scenario_name,
                "table": "",
                "text": text,
                "type": "scenario",
            })
            texts.append(text)

        if not texts:
            return 0

        vectors = [embed_fn(t) for t in texts]
        self._dim = len(vectors[0])
        matrix = np.array(vectors, dtype=np.float32)
        faiss.normalize_L2(matrix)

        index = faiss.IndexFlatIP(self._dim)
        index.add(matrix)

        faiss.write_index(index, str(INDEX_FILE))
        with open(SIDECAR_FILE, "w", encoding="utf-8") as f:
            json.dump({"dim": self._dim, "entries": entries}, f, indent=2)

        self._index = index
        self._entries = entries
        return len(entries)

    def search(
        self,
        query: str,
        embed_fn: Callable[[str], list[float]],
        allowed_tables: list[str] | None = None,
        top_k: int = 5,
        type_filter: str | list[str] | None = None,
    ) -> list[dict[str, Any]]:
        if not self.ready:
            return []

        allowed_norm = {t.lower().replace("[", "").replace("]", "").replace(" ", "") for t in (allowed_tables or [])}
        type_set: set[str] | None = None
        if isinstance(type_filter, str):
            type_set = {type_filter}
        elif isinstance(type_filter, list):
            type_set = set(type_filter)

        q_vec = np.array([embed_fn(query)], dtype=np.float32)
        faiss.normalize_L2(q_vec)
        k = min(max(top_k * 5, top_k), len(self._entries))
        scores, indices = self._index.search(q_vec, k)

        results: list[dict[str, Any]] = []
        seen_tables: set[str] = set()
        seen_scenarios: set[str] = set()
        for score, idx in zip(scores[0], indices[0]):
            if idx < 0 or idx >= len(self._entries):
                continue
            entry = self._entries[idx]
            entry_type = entry.get("type", "")
            if type_set is not None and entry_type not in type_set:
                continue

            if entry_type == "scenario":
                scenario = entry.get("scenario", "")
                if not scenario or scenario in seen_scenarios:
                    continue
                seen_scenarios.add(scenario)
                results.append({**entry, "score": float(score)})
            else:
                table = entry.get("table", "")
                tnorm = table.lower().replace("[", "").replace("]", "").replace(" ", "")
                if allowed_tables and tnorm not in allowed_norm:
                    related = entry.get("related", "")
                    rnorm = related.lower().replace("[", "").replace("]", "").replace(" ", "") if related else ""
                    if rnorm not in allowed_norm:
                        continue
                if table and table in seen_tables:
                    continue
                if table:
                    seen_tables.add(table)
                results.append({**entry, "score": float(score)})

            if len(results) >= top_k:
                break

        return results


_catalog: SchemaCatalog | None = None


def get_schema_catalog() -> SchemaCatalog:
    global _catalog
    if _catalog is None:
        _catalog = SchemaCatalog()
    return _catalog
