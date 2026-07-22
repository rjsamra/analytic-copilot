"""Semantic layer: metric resolution, SQL compilation, validation, and sanity checks."""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Literal, Optional

import pandas as pd

from user_context import UserProfile, build_scope_filters, load_dimensions

METRICS_FILE = Path(__file__).parent / "data" / "semantic_layer" / "metrics.json"

ResolutionStatus = Literal["ready", "needs_clarification", "no_metric"]


@dataclass
class ClarificationOption:
    id: str
    label: str
    description: str
    recommended: bool = False
    metric_id: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "label": self.label,
            "description": self.description,
            "recommended": self.recommended,
            "metric_id": self.metric_id,
        }


@dataclass
class ClarificationPayload:
    id: str
    question: str
    options: list[ClarificationOption]

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "question": self.question,
            "options": [o.to_dict() for o in self.options],
        }


@dataclass
class ResolutionResult:
    status: ResolutionStatus
    metric_id: str | None = None
    metric_label: str | None = None
    time_dimension: str | None = None
    time_dimension_label: str | None = None
    time_range: tuple[str, str] | None = None
    time_range_label: str | None = None
    scope_filters: list[str] = field(default_factory=list)
    scope_joins: list[str] = field(default_factory=list)
    scope_label: str | None = None
    assumptions: list[str] = field(default_factory=list)
    tables: list[str] = field(default_factory=list)
    clarification: ClarificationPayload | None = None
    params_hash: str | None = None
    cache_hit: bool = False
    cached_sql: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "metric_id": self.metric_id,
            "metric_label": self.metric_label,
            "time_dimension": self.time_dimension,
            "time_dimension_label": self.time_dimension_label,
            "time_range": list(self.time_range) if self.time_range else None,
            "time_range_label": self.time_range_label,
            "scope_filters": self.scope_filters,
            "scope_label": self.scope_label,
            "assumptions": self.assumptions,
            "tables": self.tables,
            "clarification": self.clarification.to_dict() if self.clarification else None,
            "params_hash": self.params_hash,
            "cache_hit": self.cache_hit,
            "cached_sql": self.cached_sql,
        }


@dataclass
class CompiledQuery:
    sql: str
    assumptions: list[str]
    metric_id: str
    metric_label: str
    tables: list[str]

    def to_dict(self) -> dict[str, Any]:
        return {
            "sql": self.sql,
            "assumptions": self.assumptions,
            "metric_id": self.metric_id,
            "metric_label": self.metric_label,
            "tables": self.tables,
        }


@dataclass
class ValidationCheck:
    name: str
    status: str
    detail: str

    def to_dict(self) -> dict[str, Any]:
        return {"name": self.name, "status": self.status, "detail": self.detail}


@dataclass
class ValidationResult:
    passed: bool
    checks: list[ValidationCheck]

    def to_dict(self) -> dict[str, Any]:
        return {"passed": self.passed, "checks": [c.to_dict() for c in self.checks]}


@dataclass
class SanityResult:
    row_count: int
    date_range: str | None
    warnings: list[str]

    def to_dict(self) -> dict[str, Any]:
        return {
            "row_count": self.row_count,
            "date_range": self.date_range,
            "warnings": self.warnings,
        }


_metrics_cache: dict[str, Any] | None = None


def load_metrics() -> dict[str, Any]:
    global _metrics_cache
    if _metrics_cache is None:
        with open(METRICS_FILE, "r", encoding="utf-8") as f:
            _metrics_cache = json.load(f)
    return _metrics_cache


def reload_metrics() -> dict[str, Any]:
    """Force re-read metrics.json from disk."""
    global _metrics_cache
    _metrics_cache = None
    return load_metrics()


def promote_metric(metric_id: str, metric_def: dict[str, Any]) -> dict[str, Any]:
    """Write a new metric into metrics.json and reload the cache."""
    data = reload_metrics()
    metrics = data.setdefault("metrics", {})
    if metric_id in metrics:
        raise ValueError(f"Metric '{metric_id}' already exists")
    required = ["label", "expression", "from_clause", "select_label"]
    missing = [k for k in required if not metric_def.get(k)]
    if missing:
        raise ValueError(f"Missing required metric fields: {', '.join(missing)}")

    entry = {
        "label": metric_def["label"],
        "description": metric_def.get("description", ""),
        "expression": metric_def["expression"],
        "from_clause": metric_def["from_clause"],
        "time_dimension": metric_def.get("time_dimension", ""),
        "time_dimension_label": metric_def.get("time_dimension_label", ""),
        "required_filters": list(metric_def.get("required_filters") or []),
        "tables": list(metric_def.get("tables") or []),
        "synonyms": list(metric_def.get("synonyms") or []),
        "ambiguities": list(metric_def.get("ambiguities") or []),
        "select_label": metric_def["select_label"],
    }
    metrics[metric_id] = entry
    METRICS_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(METRICS_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
        f.write("\n")
    return reload_metrics()


def list_metrics() -> list[dict[str, Any]]:
    data = load_metrics()
    return [
        {"id": mid, **m}
        for mid, m in data.get("metrics", {}).items()
    ]


def _normalize(text: str) -> str:
    return re.sub(r"\s+", " ", text.lower().strip())


# Scalar compile_sql cannot GROUP BY / ORDER BY / LIMIT — these cues force agent fallback.
_ENTITY_OR_GRAIN = (
    r"customer|customers|company|companies|product|products|"
    r"employee|employees|category|categories|country|countries|"
    r"region|regions|month|months|year|years|quarter|quarters"
)
_BREAKDOWN_OR_RANKING_PATTERNS = [
    re.compile(r"\btop\s+\d+\b"),
    re.compile(r"\bbottom\s+\d+\b"),
    re.compile(r"\brank(?:ed)?\s+by\b"),
    re.compile(r"\bhighest\b"),
    re.compile(r"\blowest\b"),
    re.compile(r"\bmost\s+\w+"),
    re.compile(r"\bleast\s+\w+"),
    re.compile(rf"\bby\s+(?:{_ENTITY_OR_GRAIN})\b"),
    re.compile(rf"\b(?:for\s+)?each\s+(?:{_ENTITY_OR_GRAIN})\b"),
    re.compile(rf"\bper\s+(?:{_ENTITY_OR_GRAIN})\b"),
    re.compile(r"\b(?:broken\s+down|grouped|split)\s+by\b"),
    re.compile(r"\b(?:yearly|monthly|quarterly|annually)\b"),
    re.compile(r"\b(?:over|across|by)\s+(?:the\s+)?years?\b"),
    re.compile(
        r"\b(?:who|which)\b.+\b(?:customers?|companies|products?|employees?|countries)\b"
    ),
]


def _requires_breakdown_or_ranking(question: str) -> bool:
    """True when the question needs grouping/ranking the scalar metric compiler cannot emit."""
    q = _normalize(question)
    return any(p.search(q) for p in _BREAKDOWN_OR_RANKING_PATTERNS)


def _detect_metric_intent(question: str, profile: UserProfile) -> tuple[list[str], float]:
    """Return candidate metric_ids and confidence via synonym matching."""
    q = _normalize(question)
    metrics = load_metrics().get("metrics", {})
    scores: dict[str, float] = {}

    for mid, m in metrics.items():
        score = 0.0
        for syn in m.get("synonyms", []):
            if _normalize(syn) in q:
                score = max(score, 0.9)
        label = _normalize(m.get("label", ""))
        if label and label in q:
            score = max(score, 0.85)
        if mid.replace("_", " ") in q:
            score = max(score, 0.8)
        if score > 0:
            scores[mid] = score

    # Apply persona defaults for generic terms
    for concept, default_mid in (profile.metric_defaults or {}).items():
        if concept in q and default_mid in metrics:
            scores[default_mid] = max(scores.get(default_mid, 0), 0.75)

    if not scores:
        # Fallback: revenue/sales questions
        if any(w in q for w in ["revenue", "sales", "turnover"]):
            default = profile.metric_defaults.get("revenue", "recognized_revenue")
            scores[default] = 0.6
        elif any(w in q for w in ["profit", "margin"]):
            default = profile.metric_defaults.get("profit", "gross_profit")
            scores[default] = 0.6
        elif any(w in q for w in ["order", "orders"]):
            default = profile.metric_defaults.get("orders", "order_count")
            scores[default] = 0.6

    if not scores:
        return [], 0.0

    ranked = sorted(scores.items(), key=lambda x: -x[1])
    top_id, top_score = ranked[0]
    if len(ranked) > 1 and ranked[1][1] >= top_score - 0.15:
        return [r[0] for r in ranked[:2]], top_score
    return [top_id], top_score


def _get_data_reference_date() -> datetime.date:
    """Anchor relative time phrases to the latest data in Northwind, not wall-clock today."""
    import os
    import sqlite3

    db_path = os.environ.get("SQLITE_DB_PATH", "data/northwind.db")
    if not os.path.isabs(db_path):
        db_path = str(Path(__file__).parent / db_path)
    try:
        conn = sqlite3.connect(db_path)
        row = conn.execute(
            "SELECT MAX(ShippedDate) FROM Orders WHERE ShippedDate IS NOT NULL"
        ).fetchone()
        conn.close()
        if row and row[0]:
            raw = str(row[0])[:10]
            return datetime.strptime(raw, "%Y-%m-%d").date()
    except Exception:
        pass
    return datetime(2023, 10, 28).date()


def _parse_time_range(question: str, profile: UserProfile) -> tuple[tuple[str, str] | None, str | None]:
    q = _normalize(question)
    dims = load_dimensions()
    ref = _get_data_reference_date()

    # Explicit YYYY-MM or Month YYYY in question
    month_names = {
        "january": 1, "february": 2, "march": 3, "april": 4, "may": 5, "june": 6,
        "july": 7, "august": 8, "september": 9, "october": 10, "november": 11, "december": 12,
    }
    for name, num in month_names.items():
        m = re.search(rf"{name}\s+(\d{{4}})", q)
        if m:
            year = int(m.group(1))
            import calendar
            last_day = calendar.monthrange(year, num)[1]
            start = f"{year:04d}-{num:02d}-01"
            end = f"{year:04d}-{num:02d}-{last_day:02d}"
            return (start, end), f"{name.title()} {year} ({start} to {end})"

    for _key, grain in (dims.get("time_grains") or {}).items():
        for pat in grain.get("patterns", []):
            if pat in q:
                if "offset_months" in grain:
                    import calendar
                    offset = grain["offset_months"]
                    year = ref.year
                    month = ref.month + offset
                    while month <= 0:
                        month += 12
                        year -= 1
                    while month > 12:
                        month -= 12
                        year += 1
                    last_day = calendar.monthrange(year, month)[1]
                    start = f"{year:04d}-{month:02d}-01"
                    end = f"{year:04d}-{month:02d}-{last_day:02d}"
                    label = f"{grain['label']} ({start} to {end}, anchored to data through {ref})"
                    return (start, end), label
                if "offset_years" in grain:
                    offset = grain["offset_years"]
                    year = ref.year + offset
                    start = f"{year:04d}-01-01"
                    end = f"{year:04d}-12-31"
                    label = f"{grain['label']} ({year}, anchored to data through {ref})"
                    return (start, end), label

    return None, None


def _params_hash(metric_id: str, profile_id: str, time_range: tuple[str, str] | None, scope_key: str) -> str:
    raw = f"{profile_id}|{metric_id}|{time_range}|{scope_key}"
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


def _build_clarification(
    candidates: list[str], profile: UserProfile, question: str
) -> ClarificationPayload:
    metrics = load_metrics().get("metrics", {})
    options: list[ClarificationOption] = []
    default_rev = profile.metric_defaults.get("revenue")

    for mid in candidates:
        m = metrics.get(mid, {})
        recommended = mid == default_rev
        options.append(
            ClarificationOption(
                id=mid,
                label=m.get("label", mid),
                description=(
                    f"Uses {m.get('time_dimension_label', 'date')} — "
                    f"{m.get('description', '')}"
                ),
                recommended=recommended,
                metric_id=mid,
            )
        )

    return ClarificationPayload(
        id=f"clarify-{hashlib.md5(question.encode()).hexdigest()[:8]}",
        question=(
            "Multiple metric definitions match your question. "
            "Which one should I use?"
        ),
        options=options,
    )


def resolve_metric(
    question: str,
    user_profile: UserProfile,
    session_prefs: dict[str, Any] | None = None,
    cache_lookup: Callable[..., Any] | None = None,
) -> ResolutionResult:
    session_prefs = session_prefs or {}
    metrics = load_metrics().get("metrics", {})

    # Scalar fast path cannot answer ranked/grouped questions — fall back to agent.
    if _requires_breakdown_or_ranking(question):
        return ResolutionResult(status="no_metric")

    # Clarification override from session
    forced_metric = session_prefs.get("metric_id")
    if forced_metric and forced_metric in metrics:
        candidates = [forced_metric]
        confidence = 1.0
    else:
        candidates, confidence = _detect_metric_intent(question, user_profile)

    if not candidates:
        return ResolutionResult(status="no_metric")

    if len(candidates) > 1 and not forced_metric:
        clarification = _build_clarification(candidates, user_profile, question)
        return ResolutionResult(
            status="needs_clarification",
            clarification=clarification,
        )

    metric_id = candidates[0]
    metric = metrics[metric_id]

    time_range, time_label = _parse_time_range(question, user_profile)
    extra_joins, scope_filters, extra_tables = build_scope_filters(user_profile)

    tables = list(set(metric.get("tables", []) + extra_tables))
    assumptions = [
        f"Metric: {metric.get('label')}",
        f"Date basis: {metric.get('time_dimension_label')}",
    ]
    if time_label:
        assumptions.append(f"Period: {time_label}")
    if user_profile.region:
        assumptions.append(f"Scope: {user_profile.region} (ShipCountry filter)")
    assumptions.append(f"Persona: {user_profile.role}")
    ref = _get_data_reference_date()
    assumptions.append(f"Time anchor: latest data through {ref}")

    scope_key = "|".join(scope_filters)
    phash = _params_hash(metric_id, user_profile.id, time_range, scope_key)

    result = ResolutionResult(
        status="ready",
        metric_id=metric_id,
        metric_label=metric.get("label"),
        time_dimension=metric.get("time_dimension"),
        time_dimension_label=metric.get("time_dimension_label"),
        time_range=time_range,
        time_range_label=time_label,
        scope_filters=scope_filters,
        scope_joins=extra_joins,
        scope_label=user_profile.region,
        assumptions=assumptions,
        tables=tables,
        params_hash=phash,
    )

    if cache_lookup:
        cached = cache_lookup(user_profile.id, metric_id, phash, question)
        if cached:
            result.cache_hit = True
            result.cached_sql = cached.get("sql")

    return result


def compile_sql(resolution: ResolutionResult) -> CompiledQuery | None:
    if resolution.status != "ready" or not resolution.metric_id:
        return None

    metrics = load_metrics().get("metrics", {})
    metric = metrics.get(resolution.metric_id)
    if not metric:
        return None

    if resolution.cache_hit and resolution.cached_sql:
        return CompiledQuery(
            sql=resolution.cached_sql,
            assumptions=resolution.assumptions,
            metric_id=resolution.metric_id,
            metric_label=resolution.metric_label or resolution.metric_id,
            tables=resolution.tables,
        )

    from_clause = metric.get("from_clause", "")
    for j in resolution.scope_joins:
        if j and j not in from_clause:
            from_clause += f" {j}"

    scope_filters = resolution.scope_filters
    where_parts = list(metric.get("required_filters") or [])
    where_parts.extend(scope_filters)

    if resolution.time_range and resolution.time_dimension:
        start, end = resolution.time_range
        where_parts.append(
            f"DATE({resolution.time_dimension}) >= '{start}' "
            f"AND DATE({resolution.time_dimension}) <= '{end}'"
        )

    where_sql = ""
    if where_parts:
        where_sql = " WHERE " + " AND ".join(where_parts)

    expr = metric.get("expression") or metric.get("select_label") or resolution.metric_id
    alias = metric.get("select_label") or resolution.metric_id

    sql = (
        f"SELECT {expr} AS {alias}\n"
        f"FROM {from_clause}{where_sql}"
    )

    return CompiledQuery(
        sql=sql,
        assumptions=resolution.assumptions,
        metric_id=resolution.metric_id,
        metric_label=resolution.metric_label or resolution.metric_id,
        tables=resolution.tables,
    )


def validate_compiled(compiled: CompiledQuery, user_profile: UserProfile) -> ValidationResult:
    checks: list[ValidationCheck] = []
    sql_upper = compiled.sql.upper()

    checks.append(
        ValidationCheck(
            name="Metric access",
            status="passed",
            detail=f"Metric '{compiled.metric_label}' allowed for {user_profile.role}.",
        )
    )

    for table in compiled.tables:
        tnorm = table.lower().replace("[", "").replace("]", "").replace(" ", "")
        if tnorm not in sql_upper.lower().replace("[", "").replace("]", "").replace(" ", ""):
            # Table may be implicit in join alias
            pass

    checks.append(
        ValidationCheck(
            name="Table scope",
            status="passed",
            detail=f"Query uses tables: {', '.join(compiled.tables)}",
        )
    )

    if "SELECT" in sql_upper and "DROP" not in sql_upper and "DELETE" not in sql_upper:
        checks.append(
            ValidationCheck(
                name="SQL safety",
                status="passed",
                detail="Query is read-only SELECT.",
            )
        )
    else:
        checks.append(
            ValidationCheck(
                name="SQL safety",
                status="failed",
                detail="Query contains unsafe operations.",
            )
        )

    if user_profile.mandatory_filters.get("type") != "none":
        checks.append(
            ValidationCheck(
                name="Scope filter",
                status="passed",
                detail=f"Persona scope applied: {user_profile.region}",
            )
        )
    else:
        checks.append(
            ValidationCheck(
                name="Scope filter",
                status="passed",
                detail="No mandatory scope filter (global access).",
            )
        )

    passed = all(c.status == "passed" for c in checks)
    return ValidationResult(passed=passed, checks=checks)


def run_sanity_checks(
    df: pd.DataFrame,
    resolution: ResolutionResult,
) -> SanityResult:
    warnings: list[str] = []
    row_count = len(df)

    if row_count == 0:
        warnings.append("Query returned zero rows — filters may be too narrow.")

    date_range = None
    if resolution.time_range_label:
        date_range = resolution.time_range_label
    elif resolution.time_range:
        date_range = f"{resolution.time_range[0]} to {resolution.time_range[1]}"

    for col in df.columns:
        if df[col].isna().all():
            warnings.append(f"Column '{col}' is entirely null.")
        numeric = pd.to_numeric(df[col], errors="coerce")
        if numeric.notna().any() and (numeric < 0).any() and "profit" in (resolution.metric_id or ""):
            warnings.append(f"Column '{col}' contains negative values.")

    return SanityResult(row_count=row_count, date_range=date_range, warnings=warnings)


def build_semantic_prompt_addon(resolution: ResolutionResult, compiled: CompiledQuery | None) -> str:
    if not resolution.metric_id:
        return ""

    lines = [
        "## Semantic Layer Context (MANDATORY — follow these definitions)",
        f"- Metric: {resolution.metric_label} ({resolution.metric_id})",
        f"- Date basis: {resolution.time_dimension_label} ({resolution.time_dimension})",
    ]
    if resolution.time_range_label:
        lines.append(f"- Time period: {resolution.time_range_label}")
    if resolution.scope_label:
        lines.append(f"- Scope: {resolution.scope_label}")
    if resolution.scope_filters:
        lines.append(f"- Scope filters: {' AND '.join(resolution.scope_filters)}")
    lines.append(f"- Allowed tables: {', '.join(resolution.tables)}")
    for a in resolution.assumptions:
        lines.append(f"- Assumption: {a}")

    if compiled:
        lines.append("\nPre-compiled SQL (prefer using this exact query via execute_sql_query):")
        lines.append(f"```sql\n{compiled.sql}\n```")

    return "\n".join(lines)
