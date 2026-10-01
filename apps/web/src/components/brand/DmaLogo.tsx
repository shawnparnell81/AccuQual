/** Official DMA Industries mark. Dark navy on transparent; CSS turns it white on dark chrome. */
export const DMA_LOGO_SRC = "/branding/dma-logo.png";

/** Product name on sign-in and in the app header. */
export const PRODUCT_LINE = "AccuQual — a DMA Industries QMS";

export function ProductLine({ className }: { className?: string }) {
  return <span className={className ? `aq-product-line ${className}` : "aq-product-line"}>{PRODUCT_LINE}</span>;
}

interface DmaLogoProps {
  /** Rendered height in pixels. Width follows the mark. */
  height?: number;
  className?: string;
  alt?: string;
}

export function DmaLogo({ height = 40, className, alt = "DMA Industries, LLC" }: DmaLogoProps) {
  return <img src={DMA_LOGO_SRC} alt={alt} className={className ? `dma-logo ${className}` : "dma-logo"} style={{ height }} />;
}

/**
 * Shared form header. New forms pick this up through GenericFormRenderer,
 * the ISO and validation sheet pages, and FormEditor. The grid underneath
 * is unchanged.
 */
export function FormHeader({ title }: { title?: string }) {
  return (
    <div className="dma-form-header">
      <DmaLogo height={40} />
      {title ? <h2 className="dma-form-title">{title}</h2> : <div className="dma-form-title" />}
      <span className="dma-form-balance" aria-hidden="true" />
    </div>
  );
}

/** A company-uploaded mark when one is set; otherwise the DMA logo in the same header slot. */
export function BrandMark({ logoUrl, height = 48 }: { logoUrl?: string | null; height?: number }) {
  if (logoUrl) {
    return <img src={logoUrl} alt="Logo" className="h-12 w-12 rounded-md border border-border object-cover print:border-black" />;
  }
  return <DmaLogo height={height} />;
}
