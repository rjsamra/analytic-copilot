"""Pending metric proposals (Layer B) awaiting analyst approval."""

from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from guardrails import extract_sql_tables
from semantic_layer import load_metrics, promote_metric

PENDING_FILE = Path(__file__).parent / "data" / "semantic_layer" / "pending_metrics.json"

REQUIRED_DRAFT_FIELDS = ("id", "label", "expression", "from_clause", "select_label")

_FROM_JOIN_RE = re.compile(
    r"\b(?:FROM|JOIN)\s+(\[[^\]]+\]|[A-Za-z_][\w]*)",
    re.IGNORECASE,
)


def _tables_from_sql(sql: str) -> list[str]:
    tables: list[str] = []
    seen: set[str] = set()
    for match in _FROM_JOIN_RE.finditer(sql or ""):
        name = match.group(1).strip()
        key = name.lower().replace("[", "").replace("]", "").replace(" ", "")
        if key and key not in seen:
            seen.add(key)
            tables.append(name)
    if tables:
        return tables
    # Fallback to guardrails extractor
    return sorted(extract_sql_tables(sql))


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _load() -> dict[str, Any]:
    if not PENDING_FILE.exists():
        return {"proposals": []}
    with open(PENDING_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)
    if "proposals" not in data:
        data["proposals"] = []
    return data


def _save(data: dict[str, Any]) -> None:
    PENDING_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(PENDING_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
        f.write("\n")


def _slugify(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")
    return slug[:48] or "new_metric"


def draft_metric_from_sql(question: str, sql: str) -> dict[str, Any]:
    """Best-effort metric draft; analyst fills expression/from_clause as needed."""
    base = _slugify(question)
    existing = set(load_metrics().get("metrics", {}).keys())
    metric_id = base
    n = 2
    while metric_id in existing:
        metric_id = f"{base}_{n}"
        n += 1

    tables = _tables_from_sql(sql)
    table_labels = tables

    synonyms = []
    words = [w for w in re.findall(r"[a-zA-Z]+", question.lower()) if len(w) > 3]
    for w in words[:5]:
        if w not in synonyms:
            synonyms.append(w)

    label = question.strip()
    if len(label) > 60:
        label = label[:57] + "..."

    return {
        "id": metric_id,
        "label": label.title() if label.islower() else label,
        "description": f"Proposed from question: {question}",
        "expression": "",
        "from_clause": "",
        "time_dimension": "",
        "time_dimension_label": "",
        "required_filters": [],
        "tables": table_labels,
        "synonyms": synonyms,
        "ambiguities": [],
        "select_label": metric_id,
    }


def create_proposal(
    question: str,
    proposed_sql: str,
    profile_id: str = "",
    scenario_hits: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    data = _load()
    proposal_id = f"pend-{hashlib.md5(f'{question}|{proposed_sql}|{_now()}'.encode()).hexdigest()[:10]}"
    now = _now()
    proposal = {
        "id": proposal_id,
        "status": "pending",
        "question": question,
        "proposed_sql": proposed_sql,
        "draft_metric": draft_metric_from_sql(question, proposed_sql),
        "scenario_hits": scenario_hits or [],
        "profile_id": profile_id,
        "created_at": now,
        "updated_at": now,
        "reject_reason": None,
    }
    data["proposals"].insert(0, proposal)
    _save(data)
    return proposal


def list_proposals(status: str | None = None) -> list[dict[str, Any]]:
    proposals = _load().get("proposals", [])
    if status:
        return [p for p in proposals if p.get("status") == status]
    return proposals


def get_proposal(proposal_id: str) -> Optional[dict[str, Any]]:
    for p in _load().get("proposals", []):
        if p.get("id") == proposal_id:
            return p
    return None


def update_proposal(
    proposal_id: str,
    *,
    proposed_sql: str | None = None,
    draft_metric: dict[str, Any] | None = None,
) -> dict[str, Any]:
    data = _load()
    for p in data["proposals"]:
        if p.get("id") != proposal_id:
            continue
        if p.get("status") != "pending":
            raise ValueError("Only pending proposals can be edited")
        if proposed_sql is not None:
            p["proposed_sql"] = proposed_sql
        if draft_metric is not None:
            merged = {**(p.get("draft_metric") or {}), **draft_metric}
            p["draft_metric"] = merged
        p["updated_at"] = _now()
        _save(data)
        return p
    raise KeyError(f"Proposal '{proposal_id}' not found")


def approve_proposal(proposal_id: str) -> dict[str, Any]:
    data = _load()
    for p in data["proposals"]:
        if p.get("id") != proposal_id:
            continue
        if p.get("status") != "pending":
            raise ValueError("Only pending proposals can be approved")
        draft = p.get("draft_metric") or {}
        metric_id = (draft.get("id") or "").strip()
        if not metric_id:
            raise ValueError("draft_metric.id is required")
        missing = [k for k in REQUIRED_DRAFT_FIELDS if k != "id" and not draft.get(k)]
        if missing:
            raise ValueError(f"Missing required draft fields: {', '.join(missing)}")

        promote_metric(metric_id, draft)
        p["status"] = "approved"
        p["updated_at"] = _now()
        p["approved_metric_id"] = metric_id
        _save(data)
        return p
    raise KeyError(f"Proposal '{proposal_id}' not found")


def reject_proposal(proposal_id: str, reason: str = "") -> dict[str, Any]:
    data = _load()
    for p in data["proposals"]:
        if p.get("id") != proposal_id:
            continue
        if p.get("status") != "pending":
            raise ValueError("Only pending proposals can be rejected")
        p["status"] = "rejected"
        p["reject_reason"] = reason or ""
        p["updated_at"] = _now()
        _save(data)
        return p
    raise KeyError(f"Proposal '{proposal_id}' not found")


def pending_count() -> int:
    return len(list_proposals(status="pending"))
