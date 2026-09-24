import { useEffect, useRef, useState } from "react";

const prefersReducedMotion = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Eases a number from its previous value to `target`. Jumps straight there for anyone who asked for reduced motion. */
export function useCountUp(target: number, durationMs = 900): number {
  const [shown, setShown] = useState(() => (prefersReducedMotion() ? target : 0));
  const from = useRef(shown);

  useEffect(() => {
    if (prefersReducedMotion() || from.current === target) {
      from.current = target;
      setShown(target);
      return;
    }
    const start = performance.now();
    const origin = from.current;
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      const next = origin + (target - origin) * eased;
      from.current = next;
      setShown(next);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, durationMs]);

  return shown;
}
