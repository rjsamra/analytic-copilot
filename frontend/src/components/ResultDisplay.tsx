import { lazy, Suspense, useMemo, useState } from "react";
import type { DisplayPayload, ResultViewMode } from "../types";
import {
  buildPlotlyFromTable,
  CHART_KIND_LABELS,
  suggestChartKind,
} from "../utils/chartFromTable";

const Plot = lazy(() => import("react-plotly.js"));

interface Props {
  displays: DisplayPayload[];
}

interface ResultGroup {
  table?: DisplayPayload;
  chart?: DisplayPayload;
  text?: DisplayPayload;
}

function groupDisplays(displays: DisplayPayload[]): ResultGroup[] {
  const groups: ResultGroup[] = [];
  let current: ResultGroup = {};

  for (const display of displays) {
    if (display.type === "text") {
      if (current.table || current.chart) {
        groups.push(current);
        current = {};
      }
      groups.push({ text: display });
      continue;
    }

    if (display.type === "table") {
      if (current.table || current.chart) {
        groups.push(current);
        current = {};
      }
      current.table = display;
      continue;
    }

    if (display.type === "chart") {
      current.chart = display;
      groups.push(current);
      current = {};
    }
  }

  if (current.table || current.chart) {
    groups.push(current);
  }

  return groups;
}

function ChartView({ display, fallbackTable }: { display?: DisplayPayload; fallbackTable?: DisplayPayload }) {
  const plotlySpec = useMemo(() => {
    if (display?.format === "plotly" && display.data) {
      try {
        return JSON.parse(display.data) as { data: unknown[]; layout: Record<string, unknown> };
      } catch {
        return null;
      }
    }
    if (fallbackTable) {
      return buildPlotlyFromTable(fallbackTable, display?.chartKind as never);
    }
    return null;
  }, [display, fallbackTable]);

  if (!plotlySpec) return null;

  return (
    <Suspense
      fallback={
        <div className="flex h-64 items-center justify-center text-sm text-slate-500">
          Loading chart…
        </div>
      }
    >
      <Plot
        data={plotlySpec.data as object[]}
        layout={{
          ...plotlySpec.layout,
          paper_bgcolor: "transparent",
          plot_bgcolor: "transparent",
          font: { color: "#cbd5e1", family: "DM Sans" },
          margin: { t: 40, r: 20, b: 40, l: 50 },
        }}
        config={{ responsive: true, displayModeBar: false }}
        style={{ width: "100%", height: 360 }}
        useResizeHandler
      />
    </Suspense>
  );
}

function TableView({ display }: { display: DisplayPayload }) {
  if (!display.columns || !display.rows) return null;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-surface-700 bg-surface-800/80">
            {display.columns.map((col) => (
              <th key={col} className="px-4 py-2.5 font-medium text-accent-glow">
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {display.rows.map((row, rowIdx) => (
            <tr
              key={rowIdx}
              className="border-b border-surface-800/80 even:bg-surface-800/30"
            >
              {display.columns!.map((col) => (
                <td key={col} className="px-4 py-2 text-slate-300">
                  {row[col]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ViewToggle({
  viewMode,
  onChange,
  hasChart,
  hasTable,
}: {
  viewMode: ResultViewMode;
  onChange: (mode: ResultViewMode) => void;
  hasChart: boolean;
  hasTable: boolean;
}) {
  const options: { id: ResultViewMode; label: string; show: boolean }[] = [
    { id: "auto", label: "Auto", show: hasChart || hasTable },
    { id: "chart", label: "Chart", show: hasChart },
    { id: "table", label: "Table", show: hasTable },
    { id: "both", label: "Both", show: hasChart && hasTable },
  ];

  return (
    <div className="flex flex-wrap gap-1">
      {options
        .filter((o) => o.show)
        .map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => onChange(option.id)}
            className={`rounded-lg px-3 py-1 text-xs font-medium transition ${
              viewMode === option.id
                ? "bg-accent/20 text-accent-glow ring-1 ring-accent/40"
                : "text-slate-400 hover:bg-surface-700 hover:text-slate-200"
            }`}
          >
            {option.label}
          </button>
        ))}
    </div>
  );
}

function ResultGroupView({ group }: { group: ResultGroup }) {
  const [viewMode, setViewMode] = useState<ResultViewMode>("auto");

  if (group.text) {
    return (
      <div className="overflow-hidden rounded-xl border border-surface-700 bg-surface-900/80">
        <p className="p-4 text-sm text-slate-300">{group.text.data}</p>
      </div>
    );
  }

  const table = group.table;
  const chart = group.chart;
  const canChart = !!chart || (table ? suggestChartKind(table) !== null : false);
  const hasTable = !!table;
  const chartKind = chart?.chartKind ?? (table ? suggestChartKind(table) : null);
  const chartLabel = chartKind ? CHART_KIND_LABELS[chartKind] ?? "Chart" : "Chart";

  const showChart =
    viewMode === "chart" ||
    viewMode === "both" ||
    (viewMode === "auto" && canChart);
  const showTable =
    viewMode === "table" ||
    viewMode === "both" ||
    (viewMode === "auto" && !canChart && hasTable);

  if (!hasTable && !canChart) return null;

  return (
    <div className="overflow-hidden rounded-xl border border-surface-700 bg-surface-900/80">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-surface-700 bg-surface-800/50 px-4 py-2">
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold uppercase tracking-wide text-slate-400">
            {chart?.title || (canChart ? chartLabel : "Results")}
          </p>
          {chart?.autoGenerated && (
            <p className="text-[11px] text-slate-500">AI-selected visualization</p>
          )}
        </div>
        {(canChart || hasTable) && (
          <ViewToggle
            viewMode={viewMode}
            onChange={setViewMode}
            hasChart={canChart}
            hasTable={hasTable}
          />
        )}
      </div>

      {showChart && (
        <div className={showTable ? "border-b border-surface-700" : ""}>
          {chart?.format === "matplotlib" && chart.data ? (
            <img
              src={`data:image/png;base64,${chart.data}`}
              alt="Analysis chart"
              className="w-full"
            />
          ) : (
            <ChartView display={chart} fallbackTable={table} />
          )}
        </div>
      )}

      {showTable && table && <TableView display={table} />}
    </div>
  );
}

export default function ResultDisplay({ displays }: Props) {
  const groups = useMemo(() => groupDisplays(displays), [displays]);

  if (!groups.length) return null;

  return (
    <div className="space-y-4">
      {groups.map((group, index) => (
        <ResultGroupView key={index} group={group} />
      ))}
    </div>
  );
}
