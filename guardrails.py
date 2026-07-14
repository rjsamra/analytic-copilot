"""Guardrail library, evaluation, and prompt injection for demo enforcement."""

from __future__ import annotations

import json
import re
import uuid
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Callable, Literal, Optional

GUARDRAILS_FILE = Path(__file__).parent / "data" / "guardrails.json"

GuardrailType = Literal[
    "sql_safety",
    "row_cap",
    "table_allowlist",
    "topic_block",
    "business_rule",
]

CheckStatus = Literal["passed", "blocked", "applied", "skipped", "capped"]

DANGEROUS_SQL_DEFAULT = [
    "DROP",
    "DELETE",
    "UPDATE",
    "INSERT",
    "ALTER",
    "TRUNCATE",
    "CREATE",
    "REPLACE",
]

# Common Northwind / SQL identifiers that appear after FROM/JOIN/INTO/UPDATE/etc.
_TABLE_REF_RE = re.compile(
    r"\b(?:FROM|JOIN|INTO|UPDATE|TABLE)\s+(\[?[A-Za-z0-9_\s]+\]?)",
    re.IGNORECASE,
)


@dataclass
class Guardrail:
    id: str
    name: str
    type: GuardrailType
    description: str
    config: dict[str, Any] = field(default_factory=dict)
    preset: bool = False

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class CheckResult:
    id: str
    name: str
    type: str
    status: CheckStatus
    detail: str

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class GuardrailStore:
    def __init__(self, path: Path = GUARDRAILS_FILE):
        self.path = path
        self._items: dict[str, Guardrail] = {}
        self.reload()

    def reload(self) -> None:
        self._items = {}
        if not self.path.exists():
            return
        with open(self.path, "r", encoding="utf-8") as f:
            raw = json.load(f)
        for item in raw:
            g = Guardrail(
                id=item["id"],
                name=item["name"],
                type=item["type"],
                description=item.get("description", ""),
                config=item.get("config") or {},
                preset=bool(item.get("preset", False)),
            )
            self._items[g.id] = g

    def _persist(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        payload = [g.to_dict() for g in self._items.values()]
        with open(self.path, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2)
            f.write("\n")

    def list(self) -> list[Guardrail]:
        return list(self._items.values())

    def get(self, guardrail_id: str) -> Optional[Guardrail]:
        return self._items.get(guardrail_id)

    def get_many(self, ids: list[str]) -> list[Guardrail]:
        return [self._items[i] for i in ids if i in self._items]

    def upsert(
        self,
        *,
        name: str,
        type: GuardrailType,
        description: str = "",
        config: Optional[dict[str, Any]] = None,
        guardrail_id: Optional[str] = None,
        preset: bool = False,
    ) -> Guardrail:
        gid = guardrail_id or str(uuid.uuid4())
        existing = self._items.get(gid)
        g = Guardrail(
            id=gid,
            name=name,
            type=type,
            description=description,
            config=config or {},
            preset=existing.preset if existing else preset,
        )
        self._items[gid] = g
        self._persist()
        return g

    def delete(self, guardrail_id: str) -> bool:
        g = self._items.get(guardrail_id)
        if not g:
            return False
        if g.preset:
            raise ValueError("Preset guardrails cannot be deleted")
        del self._items[guardrail_id]
        self._persist()
        return True


_store: Optional[GuardrailStore] = None


def get_store() -> GuardrailStore:
    global _store
    if _store is None:
        _store = GuardrailStore()
    return _store


def normalize_table_name(name: str) -> str:
    return name.strip().strip("[]").strip().lower().replace(" ", "")


def extract_sql_tables(sql: str) -> set[str]:
    tables: set[str] = set()
    for match in _TABLE_REF_RE.finditer(sql or ""):
        tables.add(normalize_table_name(match.group(1)))
    return tables


def _emit_checks(
    on_event: Optional[Callable[[str, dict], None]],
    results: list[CheckResult],
) -> None:
    if not on_event:
        return
    for r in results:
        on_event(
            "guardrail_check",
            {
                "id": r.id,
                "name": r.name,
                "guardrail_type": r.type,
                "status": r.status,
                "detail": r.detail,
            },
        )


def evaluate_question(
    question: str,
    attached: list[Guardrail],
    on_event: Optional[Callable[[str, dict], None]] = None,
) -> list[CheckResult]:
    """Pre-run checks (topic blocks). Returns all topic results; blocked if any blocked."""
    results: list[CheckResult] = []
    q = (question or "").lower()
    for g in attached:
        if g.type != "topic_block":
            continue
        keywords = [k.lower() for k in (g.config.get("keywords") or [])]
        hit = next((k for k in keywords if k in q), None)
        if hit:
            results.append(
                CheckResult(
                    id=g.id,
                    name=g.name,
                    type=g.type,
                    status="blocked",
                    detail=f"Question blocked: matched topic keyword '{hit}'.",
                )
            )
        else:
            results.append(
                CheckResult(
                    id=g.id,
                    name=g.name,
                    type=g.type,
                    status="passed",
                    detail="No blocked topics detected in the question.",
                )
            )
    _emit_checks(on_event, results)
    return results


def evaluate_sql(
    sql: str,
    attached: list[Guardrail],
    on_event: Optional[Callable[[str, dict], None]] = None,
) -> list[CheckResult]:
    """Hard checks for SQL safety and table allowlists."""
    results: list[CheckResult] = []
    sql_upper = sql or ""
    sql_norm = re.sub(r"\s+", " ", sql_upper)

    for g in attached:
        if g.type == "sql_safety":
            blocked = [k.upper() for k in (g.config.get("blocked_keywords") or DANGEROUS_SQL_DEFAULT)]
            hit = None
            for kw in blocked:
                if re.search(rf"\b{re.escape(kw)}\b", sql_norm, re.IGNORECASE):
                    hit = kw
                    break
            if hit:
                results.append(
                    CheckResult(
                        id=g.id,
                        name=g.name,
                        type=g.type,
                        status="blocked",
                        detail=f"Blocked dangerous SQL keyword: {hit}.",
                    )
                )
            else:
                results.append(
                    CheckResult(
                        id=g.id,
                        name=g.name,
                        type=g.type,
                        status="passed",
                        detail="SQL contains no blocked DDL/DML keywords.",
                    )
                )

        elif g.type == "table_allowlist":
            allowed_raw = g.config.get("allowed_tables") or []
            denied_raw = g.config.get("denied_tables") or []
            allowed = {normalize_table_name(t) for t in allowed_raw}
            denied = {normalize_table_name(t) for t in denied_raw}
            referenced = extract_sql_tables(sql_norm)

            if not referenced:
                results.append(
                    CheckResult(
                        id=g.id,
                        name=g.name,
                        type=g.type,
                        status="passed",
                        detail="No table references detected to validate.",
                    )
                )
                continue

            denied_hit = referenced & denied
            if denied_hit:
                results.append(
                    CheckResult(
                        id=g.id,
                        name=g.name,
                        type=g.type,
                        status="blocked",
                        detail=f"Denied table(s) referenced: {', '.join(sorted(denied_hit))}.",
                    )
                )
                continue

            if allowed:
                extras = referenced - allowed
                if extras:
                    results.append(
                        CheckResult(
                            id=g.id,
                            name=g.name,
                            type=g.type,
                            status="blocked",
                            detail=(
                                f"Table(s) outside allowlist: {', '.join(sorted(extras))}. "
                                f"Allowed: {', '.join(sorted(allowed))}."
                            ),
                        )
                    )
                else:
                    results.append(
                        CheckResult(
                            id=g.id,
                            name=g.name,
                            type=g.type,
                            status="passed",
                            detail=f"All tables within allowlist ({', '.join(sorted(referenced))}).",
                        )
                    )
            else:
                results.append(
                    CheckResult(
                        id=g.id,
                        name=g.name,
                        type=g.type,
                        status="passed",
                        detail="No denied tables referenced.",
                    )
                )

    _emit_checks(on_event, results)
    return results


def apply_row_cap(
    df,
    attached: list[Guardrail],
    on_event: Optional[Callable[[str, dict], None]] = None,
):
    """Cap DataFrame rows for attached row_cap guardrails. Returns (df, results)."""
    results: list[CheckResult] = []
    max_rows = None
    active: Optional[Guardrail] = None
    for g in attached:
        if g.type != "row_cap":
            continue
        cap = int(g.config.get("max_rows") or 0)
        if cap <= 0:
            continue
        if max_rows is None or cap < max_rows:
            max_rows = cap
            active = g

    if active is None or max_rows is None:
        return df, results

    original = len(df)
    if original > max_rows:
        df = df.head(max_rows)
        results.append(
            CheckResult(
                id=active.id,
                name=active.name,
                type=active.type,
                status="capped",
                detail=f"Result capped from {original} to {max_rows} rows.",
            )
        )
    else:
        results.append(
            CheckResult(
                id=active.id,
                name=active.name,
                type=active.type,
                status="passed",
                detail=f"Result has {original} rows (under cap of {max_rows}).",
            )
        )
    _emit_checks(on_event, results)
    return df, results


def mark_soft_rules_applied(
    attached: list[Guardrail],
    on_event: Optional[Callable[[str, dict], None]] = None,
) -> list[CheckResult]:
    """Emit 'applied' for business rules injected into the prompt."""
    results: list[CheckResult] = []
    for g in attached:
        if g.type != "business_rule":
            continue
        rule = g.config.get("rule") or g.description
        results.append(
            CheckResult(
                id=g.id,
                name=g.name,
                type=g.type,
                status="applied",
                detail=f"Business rule injected into agent prompt: {rule}",
            )
        )
    _emit_checks(on_event, results)
    return results


def prompt_addons(attached: list[Guardrail]) -> str:
    """Text appended to the system persona for soft / instructional guardrails."""
    sections: list[str] = []

    topic = [g for g in attached if g.type == "topic_block"]
    if topic:
        lines = []
        for g in topic:
            kws = ", ".join(g.config.get("keywords") or [])
            lines.append(f"- Refuse questions involving: {kws or g.description}")
        sections.append(
            "GUARDRAIL — Topic blocks (you MUST refuse politely without querying the DB):\n"
            + "\n".join(lines)
        )

    rules = [g for g in attached if g.type == "business_rule"]
    if rules:
        lines = [f"- {g.config.get('rule') or g.description}" for g in rules]
        sections.append(
            "GUARDRAIL — Business metric rules (you MUST follow these when writing SQL):\n"
            + "\n".join(lines)
        )

    safety = [g for g in attached if g.type == "sql_safety"]
    if safety:
        sections.append(
            "GUARDRAIL — SQL safety: Never generate DROP/DELETE/UPDATE/INSERT/ALTER/TRUNCATE/CREATE statements. "
            "Only SELECT queries are allowed."
        )

    allowlists = [g for g in attached if g.type == "table_allowlist"]
    if allowlists:
        lines = []
        for g in allowlists:
            allowed = g.config.get("allowed_tables") or []
            denied = g.config.get("denied_tables") or []
            if denied:
                lines.append(f"- Do NOT query these tables: {', '.join(denied)}. Prefer: {', '.join(allowed)}")
            else:
                lines.append(f"- Only query these tables: {', '.join(allowed)}")
        sections.append("GUARDRAIL — Table scope:\n" + "\n".join(lines))

    caps = [g for g in attached if g.type == "row_cap"]
    if caps:
        max_rows = min(int(g.config.get("max_rows") or 100) for g in caps)
        sections.append(
            f"GUARDRAIL — Row cap: Prefer SQL with LIMIT {max_rows}; results will be capped to {max_rows} rows."
        )

    if not sections:
        return ""
    return "\n\n## Active Guardrails (mandatory)\n" + "\n\n".join(sections)


def any_blocked(results: list[CheckResult]) -> bool:
    return any(r.status == "blocked" for r in results)
