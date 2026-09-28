import type { ChangeEvent, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { PictureText } from "./PictureText";
import { usePictureRecord } from "./pictureRecord";

// border-form-field (not border-border): the one shared spot every text/textarea/select input in
// the app renders through, so a company's Form Field Color theme setting has a real, single-file effect
// app-wide instead of needing every module's form touched individually — see styles/globals.css's
// --form-field token (defaults to the same value as --border until a company customizes it).
const baseInputClass =
  "w-full rounded-[9px] border border-form-field bg-background/70 px-2.5 py-2 text-sm text-foreground outline-none focus:border-ring";

export function TextField({ label, ...props }: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-xs font-semibold text-muted-foreground">{label}</span>
      <input className={baseInputClass} {...props} />
    </label>
  );
}

export function TextAreaField({ label, allowPictures = true, ...props }: { label: string; allowPictures?: boolean } & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const record = usePictureRecord();
  if (allowPictures && record) {
    return (
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-xs font-semibold text-muted-foreground">{label}</span>
        <PictureText
          value={props.value == null ? "" : String(props.value)}
          readOnly={Boolean(props.readOnly || props.disabled)}
          className={baseInputClass}
          rows={typeof props.rows === "number" ? props.rows : 4}
          placeholder={props.placeholder}
          ariaLabel={props["aria-label"] ?? (label || undefined)}
          entityType={record.entityType}
          entityId={record.entityId}
          onChange={(next) => props.onChange?.({ target: { value: next } } as ChangeEvent<HTMLTextAreaElement>)}
        />
      </label>
    );
  }
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-xs font-semibold text-muted-foreground">{label}</span>
      <textarea className={baseInputClass} rows={4} {...props} />
    </label>
  );
}

export function SelectField({
  label,
  children,
  ...props
}: { label: string; children: ReactNode } & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-xs font-semibold text-muted-foreground">{label}</span>
      <select className={baseInputClass} {...props}>
        {children}
      </select>
    </label>
  );
}
