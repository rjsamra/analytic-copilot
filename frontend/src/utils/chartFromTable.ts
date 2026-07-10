import type { DisplayPayload } from "../types";

export type ChartKind = "bar" | "line" | "pie" | "scatter";

function isNumericColumn(rows: Record<string, string>[], col: string): boolean {
  const values = rows.map((r) => r[col]).filter((v) => v !== "" && v != null);
  if (!values.length) return false;
  return values.every((v) => !Number.isNaN(Number(v)));
}

function isDateLikeColumn(rows: Record<string, string>[], col: string): boolean {
  const lower = col.toLowerCase();
  if (/(date|time|year|month|day|period)/.test(lower)) return true;
  const sample = rows.slice(0, 5).map((r) => r[col]);
  return sample.length > 0 && sample.every((v) => /^\d{4}(-\d{2}){0,2}/.test(v));
}

export function suggestChartKind(table: DisplayPayload): ChartKind | null {
  if (!table.columns?.length || !table.rows?.length || table.columns.length < 2) {
    return null;
  }

  const numericCols = table.columns.filter((c) => isNumericColumn(table.rows!, c));
  const categoricalCols = table.columns.filter(
    (c) => !numericCols.includes(c) && new Set(table.rows!.map((r) => r[c])).size <= 20,
  );

  if (!numericCols.length) return null;
  if (numericCols.length >= 2 && !categoricalCols.length && table.rows!.length >= 3) {
    return "scatter";
  }
  if (table.columns.some((c) => isDateLikeColumn(table.rows!, c)) && numericCols.length) {
    return "line";
  }
  if (categoricalCols.length && numericCols.length) {
    const unique = new Set(table.rows!.map((r) => r[categoricalCols[0]])).size;
    if (unique <= 8 && numericCols.length === 1 && table.rows!.length <= 12) return "pie";
    return "bar";
  }
  return table.rows!.length <= 40 ? "bar" : null;
}

export function buildPlotlyFromTable(
  table: DisplayPayload,
  chartKind?: ChartKind | null,
): { data: unknown[]; layout: Record<string, unknown> } | null {
  if (!table.columns?.length || !table.rows?.length) return null;

  const kind = chartKind ?? suggestChartKind(table);
  if (!kind) return null;

  const numericCols = table.columns.filter((c) => isNumericColumn(table.rows!, c));
  const categoricalCols = table.columns.filter((c) => !numericCols.includes(c));
  const dateCol = table.columns.find((c) => isDateLikeColumn(table.rows!, c));

  const layout: Record<string, unknown> = {
    template: "plotly_dark",
    paper_bgcolor: "transparent",
    plot_bgcolor: "transparent",
    margin: { t: 48, r: 16, b: 48, l: 48 },
    font: { color: "#cbd5e1", family: "DM Sans" },
  };

  if (kind === "line" && dateCol && numericCols[0]) {
    const points = [...table.rows!].sort((a, b) => a[dateCol].localeCompare(b[dateCol]));
    return {
      data: [
        {
          type: "scatter",
          mode: "lines+markers",
          x: points.map((r) => r[dateCol]),
          y: points.map((r) => Number(r[numericCols[0]])),
          name: numericCols[0],
        },
      ],
      layout: { ...layout, title: `${numericCols[0]} over time`, xaxis: { title: dateCol } },
    };
  }

  if (kind === "pie" && categoricalCols[0] && numericCols[0]) {
    return {
      data: [
        {
          type: "pie",
          labels: table.rows!.map((r) => r[categoricalCols[0]]),
          values: table.rows!.map((r) => Number(r[numericCols[0]])),
        },
      ],
      layout: { ...layout, title: `${numericCols[0]} by ${categoricalCols[0]}` },
    };
  }

  if (kind === "scatter" && numericCols.length >= 2) {
    return {
      data: [
        {
          type: "scatter",
          mode: "markers",
          x: table.rows!.map((r) => Number(r[numericCols[0]])),
          y: table.rows!.map((r) => Number(r[numericCols[1]])),
        },
      ],
      layout: {
        ...layout,
        title: `${numericCols[1]} vs ${numericCols[0]}`,
        xaxis: { title: numericCols[0] },
        yaxis: { title: numericCols[1] },
      },
    };
  }

  if (kind === "bar" && categoricalCols[0] && numericCols[0]) {
    const sorted = [...table.rows!].sort(
      (a, b) => Number(b[numericCols[0]]) - Number(a[numericCols[0]]),
    );
    return {
      data: [
        {
          type: "bar",
          x: sorted.map((r) => r[categoricalCols[0]]),
          y: sorted.map((r) => Number(r[numericCols[0]])),
        },
      ],
      layout: {
        ...layout,
        title: `${numericCols[0]} by ${categoricalCols[0]}`,
        xaxis: { title: categoricalCols[0] },
        yaxis: { title: numericCols[0] },
      },
    };
  }

  return null;
}

export const CHART_KIND_LABELS: Record<string, string> = {
  bar: "Bar chart",
  line: "Line chart",
  pie: "Pie chart",
  scatter: "Scatter plot",
  custom: "Custom chart",
};
