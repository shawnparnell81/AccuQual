import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

interface Pos {
  x: number;
  y: number;
  z: number;
}

/** Two sample record windows on a bench. Drag either by its title bar; the one you grab comes to the front. All data is sample data. */
export function DragDemo() {
  const stageRef = useRef<HTMLDivElement>(null);
  const zRef = useRef(3);
  const [pos, setPos] = useState<Record<string, Pos>>({ ncr: { x: 18, y: 14, z: 2 }, capa: { x: 130, y: 256, z: 3 } });
  const [asked, setAsked] = useState(false);

  function startDrag(id: string, e: ReactPointerEvent<HTMLDivElement>) {
    const stage = stageRef.current;
    const win = e.currentTarget.parentElement;
    if (!stage || !win) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startY = e.clientY;
    const origin = pos[id]!;
    const maxX = Math.max(0, stage.clientWidth - win.offsetWidth);
    const maxY = Math.max(0, stage.clientHeight - win.offsetHeight);
    const z = ++zRef.current;
    setPos((p) => ({ ...p, [id]: { ...origin, z } }));
    const move = (ev: PointerEvent) =>
      setPos((p) => ({
        ...p,
        [id]: { x: Math.min(Math.max(0, origin.x + ev.clientX - startX), maxX), y: Math.min(Math.max(0, origin.y + ev.clientY - startY), maxY), z },
      }));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  const style = (id: string) => ({ left: pos[id]!.x, top: pos[id]!.y, zIndex: pos[id]!.z });
  return (
    <div className="lp-stage" ref={stageRef} role="group" aria-label="Interactive sample: two record windows you can drag">
      <div className="lp-win" style={style("ncr")}>
        <div className="lp-win-bar" onPointerDown={(e) => startDrag("ncr", e)}>
          <span className="lp-win-dot" />
          <span className="lp-win-title">NCR-2447</span>
        </div>
        <div className="lp-win-body">
          <div className="lp-row"><span>Issue</span><span>Torque under spec, Station 4</span></div>
          <div className="lp-row"><span>Severity</span><span className="lp-chip" style={{ color: "var(--lp-critical)" }}>High</span></div>
          <div className="lp-row"><span>Status</span><span>Open</span></div>
          <button type="button" className="lp-btn lp-ai" onClick={() => setAsked(true)}>
            Ask AI: what&apos;s the root cause?
          </button>
          {asked && (
            <div className="lp-ai-out">
              Torque driver calibration lapsed 11 days past due; spec drifted from 4.2 Nm to 3.6 Nm. Confidence 92%. <span className="lp-mono">Sample output</span>
            </div>
          )}
        </div>
      </div>
      <div className="lp-win" style={style("capa")}>
        <div className="lp-win-bar" onPointerDown={(e) => startDrag("capa", e)}>
          <span className="lp-win-dot" style={{ background: "var(--lp-evidence)" }} />
          <span className="lp-win-title">CAPA-1188</span>
        </div>
        <div className="lp-win-body">
          <div className="lp-row"><span>Linked</span><span>NCR-2447</span></div>
          <div className="lp-row"><span>Action</span><span>Recalibrate + add interval alert</span></div>
          <div className="lp-row"><span>Phase</span><span className="lp-chip" style={{ color: "var(--lp-evidence)" }}>Planning</span></div>
          <div className="lp-row"><span>Owner</span><span>Plant manager</span></div>
        </div>
      </div>
      <span className="lp-mono lp-stage-tag">Sample data — drag the title bars</span>
    </div>
  );
}
