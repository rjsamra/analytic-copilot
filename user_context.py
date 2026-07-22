"""User profile loading and mandatory scope filters for the semantic layer."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

PROFILES_FILE = Path(__file__).parent / "data" / "user_profiles.json"
DIMENSIONS_FILE = Path(__file__).parent / "data" / "semantic_layer" / "dimensions.json"


@dataclass
class UserProfile:
    id: str
    display_name: str
    role: str
    region: str
    territory_ids: list[str] = field(default_factory=list)
    timezone: str = "UTC"
    metric_defaults: dict[str, str] = field(default_factory=dict)
    mandatory_filters: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "display_name": self.display_name,
            "role": self.role,
            "region": self.region,
            "territory_ids": self.territory_ids,
            "timezone": self.timezone,
            "metric_defaults": self.metric_defaults,
            "mandatory_filters": self.mandatory_filters,
        }


class UserProfileStore:
    def __init__(self, path: Path = PROFILES_FILE):
        self.path = path
        self._profiles: dict[str, UserProfile] = {}
        self.reload()

    def reload(self) -> None:
        self._profiles = {}
        if not self.path.exists():
            return
        with open(self.path, "r", encoding="utf-8") as f:
            raw = json.load(f)
        for item in raw.get("profiles", []):
            p = UserProfile(
                id=item["id"],
                display_name=item["display_name"],
                role=item["role"],
                region=item["region"],
                territory_ids=item.get("territory_ids") or [],
                timezone=item.get("timezone") or "UTC",
                metric_defaults=item.get("metric_defaults") or {},
                mandatory_filters=item.get("mandatory_filters") or {},
            )
            self._profiles[p.id] = p

    def list(self) -> list[UserProfile]:
        return list(self._profiles.values())

    def get(self, profile_id: str) -> Optional[UserProfile]:
        return self._profiles.get(profile_id)

    def get_or_default(self, profile_id: str | None) -> UserProfile:
        if profile_id and profile_id in self._profiles:
            return self._profiles[profile_id]
        if self._profiles:
            return next(iter(self._profiles.values()))
        return UserProfile(
            id="default",
            display_name="Default User",
            role="Analyst",
            region="Global",
        )


_store: UserProfileStore | None = None


def get_profile_store() -> UserProfileStore:
    global _store
    if _store is None:
        _store = UserProfileStore()
    return _store


def load_dimensions() -> dict[str, Any]:
    if not DIMENSIONS_FILE.exists():
        return {}
    with open(DIMENSIONS_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def build_scope_filters(profile: UserProfile) -> tuple[list[str], list[str], list[str]]:
    """Return (extra_joins, where_clauses, extra_tables) for persona scope."""
    dims = load_dimensions()
    region_maps = dims.get("region_mappings") or {}
    mf = profile.mandatory_filters or {}
    ftype = mf.get("type", "none")

    if ftype == "none":
        return [], [], []

    region_key = mf.get("region_key") or profile.region
    mapping = region_maps.get(region_key, {})

    if ftype == "territory":
        tids = profile.territory_ids or mapping.get("territory_ids") or []
        if not tids:
            return [], [], []
        join = mapping.get("join_clause", "")
        tid_list = ", ".join(f"'{t}'" for t in tids)
        filt = (mapping.get("filter_template") or "et.TerritoryID IN ({territory_ids})").format(
            territory_ids=tid_list
        )
        extra_tables = ["employeeTerritories", "employees"] if join else []
        return ([join] if join else []), [filt], extra_tables

    if ftype == "ship_country":
        countries = mapping.get("ship_countries") or ["USA"]
        country_list = ", ".join(f"'{c}'" for c in countries)
        filt = (mapping.get("filter_template") or "o.ShipCountry IN ({ship_countries})").format(
            ship_countries=country_list
        )
        return [], [filt], []

    return [], [], []
