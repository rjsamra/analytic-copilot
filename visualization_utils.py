"""Heuristic chart selection and Plotly figure generation from tabular data."""

from __future__ import annotations

from typing import Any

import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
from plotly.graph_objects import Figure as PlotlyFigure


def _is_date_like(series: pd.Series) -> bool:
    if pd.api.types.is_datetime64_any_dtype(series):
        return True
    name = str(series.name or "").lower()
    if any(token in name for token in ("date", "time", "year", "month", "day", "period")):
        return True
    sample = series.dropna().astype(str).head(5)
    if sample.empty:
        return False
    return bool(sample.str.match(r"^\d{4}(-\d{2}){0,2}").mean() > 0.6)


def _numeric_columns(df: pd.DataFrame) -> list[str]:
    cols: list[str] = []
    for col in df.columns:
        series = pd.to_numeric(df[col], errors="coerce")
        if series.notna().sum() >= max(1, len(df) // 2):
            cols.append(col)
    return cols


def _categorical_columns(df: pd.DataFrame, numeric_cols: list[str]) -> list[str]:
    cats: list[str] = []
    for col in df.columns:
        if col in numeric_cols:
            continue
        unique = df[col].nunique(dropna=True)
        if unique <= max(20, len(df) // 2):
            cats.append(col)
    return cats


def suggest_chart_kind(df: pd.DataFrame) -> str | None:
    """Pick a chart type from data shape, or None when a table is best."""
    if df is None or df.empty:
        return None
    if len(df.columns) < 2:
        return None

    numeric_cols = _numeric_columns(df)
    categorical_cols = _categorical_columns(df, numeric_cols)

    if not numeric_cols:
        return None

    if len(numeric_cols) >= 2 and len(categorical_cols) == 0 and len(df) >= 3:
        return "scatter"

    date_cols = [col for col in df.columns if _is_date_like(df[col])]
    if date_cols and numeric_cols:
        return "line"

    if categorical_cols and numeric_cols:
        cat_col = categorical_cols[0]
        unique_count = df[cat_col].nunique(dropna=True)
        if unique_count <= 8 and len(numeric_cols) == 1 and len(df) <= 12:
            return "pie"
        return "bar"

    if len(df) == 1 and len(numeric_cols) == 1:
        return None

    return "bar" if len(df) <= 40 else None


def _chart_title(chart_kind: str, x_col: str, y_col: str | None) -> str:
    labels = {
        "bar": "Bar chart",
        "line": "Trend over time",
        "pie": "Share breakdown",
        "scatter": "Relationship plot",
    }
    base = labels.get(chart_kind, "Chart")
    if y_col:
        return f"{base}: {y_col} by {x_col}"
    return base


def build_plotly_figure(df: pd.DataFrame, chart_kind: str | None = None) -> PlotlyFigure | None:
    """Build a Plotly figure using heuristics when chart_kind is omitted."""
    if df is None or df.empty:
        return None

    plot_df = df.copy()
    chart_kind = chart_kind or suggest_chart_kind(plot_df)
    if not chart_kind:
        return None

    numeric_cols = _numeric_columns(plot_df)
    categorical_cols = _categorical_columns(plot_df, numeric_cols)
    date_cols = [col for col in plot_df.columns if _is_date_like(plot_df[col])]

    fig: PlotlyFigure | None = None

    if chart_kind == "line" and date_cols and numeric_cols:
        x_col = date_cols[0]
        y_col = numeric_cols[0]
        plot_df[x_col] = pd.to_datetime(plot_df[x_col], errors="coerce")
        fig = px.line(
            plot_df.sort_values(x_col),
            x=x_col,
            y=y_col,
            markers=True,
            title=_chart_title("line", x_col, y_col),
        )
    elif chart_kind == "pie" and categorical_cols and numeric_cols:
        cat_col = categorical_cols[0]
        val_col = numeric_cols[0]
        fig = px.pie(
            plot_df,
            names=cat_col,
            values=val_col,
            title=_chart_title("pie", cat_col, val_col),
        )
    elif chart_kind == "scatter" and len(numeric_cols) >= 2:
        fig = px.scatter(
            plot_df,
            x=numeric_cols[0],
            y=numeric_cols[1],
            title=_chart_title("scatter", numeric_cols[0], numeric_cols[1]),
        )
    elif chart_kind == "bar" and categorical_cols and numeric_cols:
        cat_col = categorical_cols[0]
        val_col = numeric_cols[0]
        sorted_df = plot_df.sort_values(val_col, ascending=False)
        fig = px.bar(
            sorted_df,
            x=cat_col,
            y=val_col,
            title=_chart_title("bar", cat_col, val_col),
        )
    elif chart_kind == "bar" and len(numeric_cols) == 1 and len(plot_df.columns) == 2:
        cols = [c for c in plot_df.columns if c not in numeric_cols]
        if cols:
            fig = px.bar(
                plot_df,
                x=cols[0],
                y=numeric_cols[0],
                title=_chart_title("bar", cols[0], numeric_cols[0]),
            )

    if fig is None:
        return None

    fig.update_layout(
        template="plotly_dark",
        paper_bgcolor="rgba(0,0,0,0)",
        plot_bgcolor="rgba(0,0,0,0)",
        margin=dict(t=48, r=16, b=48, l=48),
        legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="right", x=1),
    )
    return fig


def chart_display_payload(
    df: pd.DataFrame,
    chart_kind: str | None = None,
    *,
    auto: bool = True,
    title: str | None = None,
) -> dict[str, Any] | None:
    """Serialize a chart display dict for the API / frontend."""
    from plotly.io import to_json as plotly_to_json

    kind = chart_kind or (suggest_chart_kind(df) if auto else None)
    fig = build_plotly_figure(df, kind)
    if fig is None:
        return None

    resolved_kind = kind or suggest_chart_kind(df) or "bar"
    return {
        "type": "chart",
        "format": "plotly",
        "data": plotly_to_json(fig),
        "chartKind": resolved_kind,
        "title": title or (fig.layout.title.text if fig.layout.title else None),
        "autoGenerated": auto and chart_kind is None,
    }


def table_display_payload(df: pd.DataFrame, *, limit: int = 30) -> dict[str, Any]:
    preview = df.head(limit).fillna("").astype(str)
    return {
        "type": "table",
        "columns": list(preview.columns),
        "rows": preview.to_dict(orient="records"),
    }
