import { formatKpiValue, objectiveReading, objectiveVisible, pointValue, type KpiPayload, type PlantView } from "./kpiView";

type ExcelModule = typeof import("exceljs");

/** Objectives and the 12-month series for the plant currently on screen. */
export async function downloadKpiWorkbook(payload: KpiPayload, plant: PlantView): Promise<void> {
  const loaded = (await import("exceljs")) as ExcelModule & { default?: ExcelModule };
  const ExcelJS = loaded.default ?? loaded;
  const book = new ExcelJS.Workbook();
  const plantName = plant === "all" ? "All plants" : payload.plants.find((item) => item.id === plant)?.name ?? "Plant";

  const objectives = book.addWorksheet("Objectives");
  objectives.addRow(["Name", "Metric", "Plant scope", "Target", "Direction", "Amber", "Owner", "Frequency", "Actual", "Status", "% of target", "Period", "Notes"]);
  objectives.getRow(1).font = { bold: true };
  for (const objective of payload.objectives.filter((item) => item.active)) {
    const reading = objectiveReading(objective, plant, payload.plants);
    const metric = payload.metrics.find((item) => item.id === objective.metric);
    objectives.addRow([
      objective.name,
      metric?.label ?? objective.metric,
      objective.plantScope,
      objective.target,
      objective.direction,
      objective.amberThreshold,
      objective.ownerName ?? "",
      objective.reviewFrequency,
      reading.actual ?? "",
      reading.status,
      reading.percentOfTarget ?? "",
      objective.periodLabel,
      objective.notes,
    ]);
  }

  const series = book.addWorksheet("Monthly");
  series.addRow(["Area", "KPI", "Month", plantName, "Target"]);
  series.getRow(1).font = { bold: true };
  for (const chart of payload.charts) {
    const metric = payload.metrics.find((item) => item.id === chart.metricId);
    if (!metric) continue;
    const target = payload.objectives.find((objective) => objective.active && objective.metric === chart.metricId && objectiveVisible(objective, plant, payload.plants) && !chart.compareMetricId)?.target ?? "";
    metric.points.forEach((point, index) => {
      const value = pointValue(point, metric.plantSplit ? plant : "all", metric.plantSplit);
      const compare = chart.compareMetricId ? payload.metrics.find((item) => item.id === chart.compareMetricId) : undefined;
      const comparePoint = compare?.points[index];
      const compareValue = compare && comparePoint ? pointValue(comparePoint, compare.plantSplit ? plant : "all", compare.plantSplit) : null;
      series.addRow([
        chart.area,
        chart.label,
        point.month,
        chart.compareMetricId ? `${formatKpiValue(metric.unit, value)} opened / ${formatKpiValue(compare?.unit ?? "count", compareValue)} closed` : (value ?? ""),
        target,
      ]);
    });
  }

  const buffer = await book.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `quality-kpis-${plantName.toLowerCase().replace(/\s+/g, "-")}.xlsx`;
  link.click();
  URL.revokeObjectURL(url);
}
