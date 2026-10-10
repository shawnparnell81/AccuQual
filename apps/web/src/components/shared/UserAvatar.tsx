import { useEffect, useState } from "react";
import { apiClient } from "../../api/client";

/** Initials, or the person's photo when one is stored. */
export function UserAvatar({
  userId,
  name,
  hasPhoto,
  src,
  size = 32,
}: {
  userId?: number | null;
  name?: string | null;
  hasPhoto?: boolean;
  /** A local preview (the crop just chosen) wins over the stored photo. */
  src?: string | null;
  size?: number;
}) {
  const initial = (name?.trim().charAt(0) || "?").toUpperCase();
  const [photo, setPhoto] = useState<string | null>(src ?? null);

  useEffect(() => {
    if (src) {
      setPhoto(src);
      return;
    }
    if (!userId || !hasPhoto) {
      setPhoto(null);
      return;
    }
    let cancelled = false;
    let objectUrl: string | null = null;
    void apiClient
      .get(`/users/${userId}/avatar`, { responseType: "blob" })
      .then((res) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(res.data);
        setPhoto(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setPhoto(null);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [userId, hasPhoto, src]);

  if (photo) {
    return <img src={photo} alt="" width={size} height={size} className="rounded-full object-cover" style={{ width: size, height: size }} />;
  }
  return (
    <span className="aq-avatar" style={{ width: size, height: size, fontSize: size < 28 ? "0.65rem" : undefined }} aria-hidden="true">
      {initial}
    </span>
  );
}
