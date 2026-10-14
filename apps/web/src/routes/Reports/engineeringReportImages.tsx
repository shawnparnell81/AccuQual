import { createContext, useContext, useEffect, useState } from "react";
import { apiClient } from "../../api/client";

export interface NcrReportRow {
  ncrNumber: string;
  partNumber: string;
  description: string;
  disposition: string;
  status: string;
}

/** A picture imported from a Word report. The file itself is an attachment of the report. */
export interface ReportImage {
  attachmentId: number;
  section: string | null;
  /** The report section it is shown in (for example "6.2"), or null for the Images section at the end. */
  sectionKey: string | null;
  order: number;
  caption: string;
  fileName: string;
}

/** The section numbers the report page draws. A picture whose section is not one of these goes to Images. */
export const REPORT_SECTION_KEYS = new Set(["6.1", "6.2", "6.3", "6.4", "6.5", "6.6", "6.7", "6.8", "6.9", "6.10", "6.11", "6.12", "6.13"]);
export const IMAGES_SECTION = "7";

/** Pictures for one section, in document order. Section "7" takes every picture no other section claims. */
export function imagesForSection(images: ReportImage[], sectionNumber: string): ReportImage[] {
  const own = images.filter((image) => (sectionNumber === IMAGES_SECTION ? !image.sectionKey || !REPORT_SECTION_KEYS.has(image.sectionKey) : image.sectionKey === sectionNumber));
  return [...own].sort((a, b) => a.order - b.order);
}

interface FigureActions {
  images: ReportImage[];
  canEdit: boolean;
  onCaption: (image: ReportImage, caption: string) => void;
  onDelete: (image: ReportImage) => void;
}

const FigureContext = createContext<FigureActions | null>(null);
export const FigureProvider = FigureContext.Provider;

function useAttachmentUrl(attachmentId: number): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    let created: string | null = null;
    apiClient
      .get(`/attachments/${attachmentId}/download`, { responseType: "blob" })
      .then((res) => {
        if (cancelled) return;
        created = URL.createObjectURL(res.data as Blob);
        setUrl(created);
      })
      .catch(() => setUrl(null));
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [attachmentId]);
  return url;
}

function Figure({ image, actions }: { image: ReportImage; actions: FigureActions }) {
  const url = useAttachmentUrl(image.attachmentId);
  const [caption, setCaption] = useState(image.caption);
  useEffect(() => setCaption(image.caption), [image.caption]);
  return (
    <figure className="qe-figure flex flex-col gap-1">
      {url ? <img src={url} alt={image.caption || image.fileName} className="max-w-full rounded border border-border" /> : <div className="qe-no-print h-24 rounded border border-border text-xs text-muted-foreground">Loading picture…</div>}
      {image.caption && <figcaption className="text-sm italic">{image.caption}</figcaption>}
      {actions.canEdit && (
        <div className="qe-no-print flex flex-wrap items-center gap-2">
          <input
            aria-label={`Caption for ${image.fileName}`}
            className="min-w-[12rem] flex-1 rounded-md border border-border bg-background px-2 py-1 text-sm"
            placeholder="Caption"
            value={caption}
            maxLength={500}
            onChange={(event) => setCaption(event.target.value)}
            onBlur={() => {
              if (caption !== image.caption) actions.onCaption(image, caption);
            }}
          />
          <button
            type="button"
            className="text-xs text-destructive"
            onClick={() => {
              if (window.confirm(`Remove picture "${image.fileName}" from this report?`)) actions.onDelete(image);
            }}
          >
            Delete picture
          </button>
        </div>
      )}
    </figure>
  );
}

/** The pictures that belong under one section heading. Renders nothing when there are none. */
export function SectionFigures({ sectionNumber }: { sectionNumber: string }) {
  const actions = useContext(FigureContext);
  if (!actions) return null;
  const images = imagesForSection(actions.images, sectionNumber);
  if (images.length === 0) return null;
  return (
    <div className="flex flex-col gap-3">
      {images.map((image) => (
        <Figure key={image.attachmentId} image={image} actions={actions} />
      ))}
    </div>
  );
}

export function hasUnmatchedImages(images: ReportImage[]): boolean {
  return imagesForSection(images, IMAGES_SECTION).length > 0;
}

const CELLS: { key: keyof NcrReportRow; label: string }[] = [
  { key: "ncrNumber", label: "NCR number" },
  { key: "partNumber", label: "Part number" },
  { key: "description", label: "Description of defect" },
  { key: "disposition", label: "Disposition" },
  { key: "status", label: "Status" },
];

/** The report's own NCR table (6.6): rows kept exactly as imported or typed. Not linked to the NCR module. */
export function NcrReportTable({ rows, disabled, onChange }: { rows: NcrReportRow[]; disabled: boolean; onChange: (rows: NcrReportRow[]) => void }) {
  const set = (index: number, key: keyof NcrReportRow, value: string) => onChange(rows.map((row, rowIndex) => (rowIndex === index ? { ...row, [key]: value } : row)));
  return (
    <div className="flex flex-col gap-2" aria-label="NCR table (from report)">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-muted-foreground">NCR table (from report)</p>
        <button type="button" className="qe-no-print text-xs text-primary disabled:opacity-60" disabled={disabled} onClick={() => onChange([...rows, { ncrNumber: "", partNumber: "", description: "", disposition: "", status: "" }])}>
          Add row
        </button>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">None yet. A Word report's NCR table fills this in.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-foreground">
                {CELLS.map((cell) => (
                  <th key={cell.key} className="p-2">
                    {cell.label}
                  </th>
                ))}
                <th className="qe-no-print p-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={index} className="border-b border-border align-top last:border-0">
                  {CELLS.map((cell) => (
                    <td key={cell.key} className="p-1">
                      <textarea
                        aria-label={`${cell.label}, row ${index + 1}`}
                        rows={1}
                        value={row[cell.key]}
                        disabled={disabled}
                        maxLength={2000}
                        onChange={(event) => set(index, cell.key, event.target.value)}
                        className="w-full resize-none rounded-md border border-border bg-background px-2 py-1 text-sm"
                      />
                    </td>
                  ))}
                  <td className="qe-no-print p-1">
                    <button type="button" className="text-xs text-destructive disabled:opacity-60" disabled={disabled} onClick={() => onChange(rows.filter((_, rowIndex) => rowIndex !== index))}>
                      Delete row
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
