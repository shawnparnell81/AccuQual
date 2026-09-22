import { useEffect, useState } from "react";
import QRCode from "qrcode";

/**
 * Same QR generation call MfaPanels.tsx already uses for TOTP enrollment
 * (`QRCode.toDataURL`) — no new dependency. Encodes plain text (the lot
 * number), not a URL: a handheld scanner reads either fine, and there's no
 * page for it to open a link to that would help someone standing at a
 * shelf.
 */
export function QrLabel({ value, size = 96 }: { value: string; size?: number }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(value, { margin: 0, width: size }).then((url) => {
      if (!cancelled) setDataUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [value, size]);

  if (!dataUrl) return <div style={{ width: size, height: size }} className="bg-muted" />;
  return <img src={dataUrl} alt={`QR code for ${value}`} width={size} height={size} />;
}
