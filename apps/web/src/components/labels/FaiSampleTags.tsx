import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { faiInspectionApi } from "../../api/faiInspection";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { parseSampleSelection } from "../../lib/sampleSelection";
import { DEFAULT_LABEL_SIZE, type LabelSizeId } from "../../lib/labelSizes";
import { LabelPrintDialog } from "./LabelPrintDialog";
import type { LabelContent } from "./LabelCard";

/**
 * The samples of one FAI record and their tags. A sample is identified by part number + lot/PO + sample number on this record;
 * its tag carries the code <FAI number>-S<n>. A scanned tag opens this page with that sample highlighted. This is not
 * inventory: nothing here counts stock.
 */
export function FaiSampleTags({ recordId, highlightSample, partNumber }: { recordId: number; highlightSample: number | null; partNumber: string }) {
  const queryClient = useQueryClient();
  const [printing, setPrinting] = useState(false);
  const highlightRef = useRef<HTMLLIElement | null>(null);
  const samplesKey = ["fai-inspection", "samples", recordId];
  const { data } = useQuery({ queryKey: samplesKey, queryFn: () => faiInspectionApi.records.samples(recordId) });

  const highlighted = data && highlightSample != null && highlightSample >= 1 && highlightSample <= data.sampleCount ? highlightSample : null;
  useEffect(() => {
    highlightRef.current?.scrollIntoView?.({ block: "center", behavior: "smooth" });
  }, [highlighted, data?.sampleCount]);

  if (!data) return null;
  if (data.sampleCount === 0) {
    return data.canPrint ? (
      <section aria-label="Sample tags" className="mb-6 text-sm text-muted-foreground">
        Enter the sample size on this record to print sample tags.
      </section>
    ) : null;
  }

  return (
    <section aria-label="Sample tags" className="mb-8">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">
          Samples <span className="text-sm font-normal text-muted-foreground">({data.sampleCount})</span>
        </h2>
        {data.canPrint && (
          <button type="button" onClick={() => setPrinting(true)} className="rounded border px-3 py-1.5 text-sm">
            Print labels
          </button>
        )}
      </div>
      {highlighted != null && (
        <p role="status" className="mb-2 rounded-md border border-primary bg-primary/10 px-3 py-2 text-sm">
          Scanned sample {highlighted} of {data.sampleCount}: tag {data.samples[highlighted - 1]!.code}
        </p>
      )}
      <ul className="flex flex-wrap gap-2">
        {data.samples.map((sample) => {
          const on = sample.number === highlighted;
          return (
            <li
              key={sample.number}
              ref={on ? highlightRef : undefined}
              aria-current={on ? "true" : undefined}
              title={`${sample.code}${sample.printedCount ? ` · tag printed ${sample.printedCount} time${sample.printedCount === 1 ? "" : "s"}` : ""}`}
              className={`rounded-md border px-2.5 py-1 text-sm ${on ? "border-primary bg-primary text-primary-foreground font-semibold ring-2 ring-primary" : "border-border"}`}
            >
              {sample.number}
              {sample.printedCount > 0 && <span className="ml-1 text-xs opacity-70">printed</span>}
            </li>
          );
        })}
      </ul>
      {printing && data.canPrint && (
        <PrintSampleLabels
          recordId={recordId}
          partNumber={partNumber}
          samples={data.samples}
          sampleCount={data.sampleCount}
          onClose={() => setPrinting(false)}
          onPrinted={() => queryClient.invalidateQueries({ queryKey: samplesKey })}
        />
      )}
    </section>
  );
}

function PrintSampleLabels({
  recordId,
  partNumber,
  samples,
  sampleCount,
  onClose,
  onPrinted,
}: {
  recordId: number;
  partNumber: string;
  samples: { number: number; code: string }[];
  sampleCount: number;
  onClose: () => void;
  onPrinted: () => void;
}) {
  const [text, setText] = useState("");
  const { data: label } = useQuery({ queryKey: ["fai-inspection", "label-data", recordId], queryFn: () => faiInspectionApi.records.labelData(recordId) });
  const selection = useMemo(() => parseSampleSelection(text, sampleCount), [text, sampleCount]);
  const numbers = "samples" in selection ? selection.samples : [];
  const labels: LabelContent[] = label
    ? numbers.map((number) => ({
        code: samples[number - 1]!.code,
        partNumber: label.partNumber || partNumber,
        lotReference: label.lotReference,
        sampleNumber: number,
        sampleCount,
        faiNumber: label.faiNumber,
        date: label.date,
        companyName: label.companyName,
      }))
    : [];

  return (
    <LabelPrintDialog
      title={`Print sample tags${label ? ` for ${label.faiNumber}` : ""}`}
      labels={labels}
      defaultSize={(label?.defaultSize as LabelSizeId | undefined) ?? DEFAULT_LABEL_SIZE}
      key={label?.defaultSize ?? "loading"}
      disabledReason={"error" in selection ? selection.error : label ? null : "Loading…"}
      onClose={onClose}
      beforePrint={async (size) => {
        try {
          await faiInspectionApi.records.printLabels(recordId, { samples: numbers, size });
        } catch (err) {
          throw new Error(extractErrorMessage(err, "The labels couldn't be recorded, so nothing was printed."));
        }
        onPrinted();
      }}
      controls={
        <div className="flex flex-col gap-1">
          <label htmlFor="label-samples" className="text-sm">
            Samples to print
          </label>
          <input
            id="label-samples"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={`All ${sampleCount}, or for example 1-3, 5`}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
          <p className="text-xs text-muted-foreground">One tag per sample. Leave blank for all {sampleCount}.</p>
        </div>
      }
    />
  );
}
