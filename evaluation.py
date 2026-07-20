"""Golden-set evaluation harness for classroom demos."""

from __future__ import annotations

import json
import re
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Optional

import pandas as pd

from copilot_utils import engine, extract_sql_query

EVAL_CASES_FILE = Path(__file__).parent / "data" / "eval_cases.json"

EvalStatus = str  # "passed" | "failed" | "error" | "pending" | "running"


@dataclass
class EvalCase:
    id: str
    question: str
    gold_sql: str
    must_contain: list[str] = field(default_factory=list)
    notes: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class EvalCaseResult:
    id: str
    question: str
    status: EvalStatus
    detail: str
    agent_sql: Optional[str] = None
    gold_sql: Optional[str] = None
    gold_rows: Optional[int] = None
    agent_rows: Optional[int] = None
    notes: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def load_cases(path: Path = EVAL_CASES_FILE) -> list[EvalCase]:
    if not path.exists():
        return []
    with open(path, "r", encoding="utf-8") as f:
        raw = json.load(f)
    cases: list[EvalCase] = []
    for item in raw:
        cases.append(
            EvalCase(
                id=item["id"],
                question=item["question"],
                gold_sql=item["gold_sql"],
                must_contain=list(item.get("must_contain") or []),
                notes=item.get("notes") or "",
            )
        )
    return cases


def extract_agent_sql(code: Optional[str]) -> Optional[str]:
    """Pull SQL from agent Python more robustly than triple-quote alone."""
    if not code:
        return None

    q = extract_sql_query(code)
    if q:
        return q

    for pattern in (
        r'execute_sql_query\s*\(\s*("""|\'\'\')(.*?)\1',
        r'execute_sql_query\s*\(\s*(["\'])(.*?)\1',
        r'"""(.*?)"""',
        r"'''(.*?)'''",
    ):
        match = re.search(pattern, code, re.DOTALL)
        if match:
            # last group is the SQL body for all patterns above
            body = match.group(match.lastindex).strip()
            if body and ("select" in body.lower() or "with" in body.lower()):
                return body
    return None


def _round_value(val: Any) -> Any:
    if val is None or (isinstance(val, float) and pd.isna(val)):
        return None
    if isinstance(val, (float, int)) and not isinstance(val, bool):
        return round(float(val), 2)
    if isinstance(val, str):
        try:
            return round(float(val), 2)
        except ValueError:
            return val.strip()
    return val


def normalize_df(df: pd.DataFrame) -> pd.DataFrame:
    if df is None or df.empty:
        return pd.DataFrame()
    out = df.copy()
    out.columns = [str(c).strip().lower().replace(" ", "_") for c in out.columns]
    for col in out.columns:
        out[col] = out[col].map(_round_value)
    out = out.reindex(sorted(out.columns), axis=1)
    out = out.sort_values(by=list(out.columns), kind="mergesort").reset_index(drop=True)
    return out


def _value_matrix(df: pd.DataFrame) -> list[tuple]:
    """Column-name-agnostic rows of rounded values, sorted."""
    if df is None or df.empty:
        return []
    rows: list[tuple] = []
    for _, row in df.iterrows():
        vals = tuple(sorted((_round_value(v) for v in row.tolist()), key=lambda x: str(x)))
        rows.append(vals)
    rows.sort(key=lambda r: str(r))
    return rows


def run_sql(sql: str) -> pd.DataFrame:
    return pd.read_sql_query(sql, engine)


def compare_results(gold_df: pd.DataFrame, agent_df: pd.DataFrame) -> dict[str, Any]:
    gold_n = normalize_df(gold_df)
    agent_n = normalize_df(agent_df)

    if gold_n.empty and agent_n.empty:
        return {
            "passed": True,
            "detail": "Both result sets are empty.",
            "gold_rows": 0,
            "agent_rows": 0,
        }

    if list(gold_n.columns) == list(agent_n.columns) and gold_n.equals(agent_n):
        return {
            "passed": True,
            "detail": f"Execution match: {len(gold_n)} row(s), columns {list(gold_n.columns)}.",
            "gold_rows": len(gold_n),
            "agent_rows": len(agent_n),
        }

    # Fallback: ignore column names; compare multiset of sorted value tuples
    gold_vals = _value_matrix(gold_df)
    agent_vals = _value_matrix(agent_df)
    if gold_vals == agent_vals and len(gold_vals) > 0:
        return {
            "passed": True,
            "detail": (
                f"Execution match on values ({len(gold_vals)} row(s)); "
                f"column names differed (gold={list(gold_n.columns)}, agent={list(agent_n.columns)})."
            ),
            "gold_rows": len(gold_n),
            "agent_rows": len(agent_n),
        }

    detail_parts = [
        f"Result mismatch: gold {len(gold_n)} row(s) {list(gold_n.columns)} "
        f"vs agent {len(agent_n)} row(s) {list(agent_n.columns)}."
    ]
    if len(gold_n) != len(agent_n):
        detail_parts.append("Row counts differ.")
    elif list(gold_n.columns) != list(agent_n.columns):
        detail_parts.append("Column names differ and values do not match.")
    else:
        detail_parts.append("Same shape/columns but cell values differ.")

    return {
        "passed": False,
        "detail": " ".join(detail_parts),
        "gold_rows": len(gold_n),
        "agent_rows": len(agent_n),
    }


def check_must_contain(agent_sql: str, tokens: list[str]) -> Optional[str]:
    sql_upper = agent_sql.upper()
    missing = [t for t in tokens if t.upper() not in sql_upper]
    if missing:
        return f"Agent SQL missing required token(s): {', '.join(missing)}."
    return None


def score_case(case: EvalCase, agent_sql: Optional[str]) -> EvalCaseResult:
    base = EvalCaseResult(
        id=case.id,
        question=case.question,
        status="failed",
        detail="",
        agent_sql=agent_sql,
        gold_sql=case.gold_sql,
        notes=case.notes,
    )

    if not agent_sql or not agent_sql.strip():
        base.status = "failed"
        base.detail = "Agent produced no extractable SQL."
        return base

    missing = check_must_contain(agent_sql, case.must_contain)
    if missing:
        base.status = "failed"
        base.detail = missing
        return base

    try:
        gold_df = run_sql(case.gold_sql)
    except Exception as exc:
        base.status = "error"
        base.detail = f"Gold SQL failed to execute: {exc}"
        return base

    try:
        agent_df = run_sql(agent_sql)
    except Exception as exc:
        base.status = "failed"
        base.detail = f"Agent SQL failed to execute: {exc}"
        return base

    cmp = compare_results(gold_df, agent_df)
    base.gold_rows = cmp["gold_rows"]
    base.agent_rows = cmp["agent_rows"]
    base.detail = cmp["detail"]
    base.status = "passed" if cmp["passed"] else "failed"
    return base
