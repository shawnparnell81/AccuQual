/** Real shop-floor photography (Pexels, free to use), bundled locally under /landing. */

const SCENES = [
  { tag: "Measure", title: "Every gauge, in calibration", text: "Calibration due dates, certificates and out-of-tolerance history for the tools on your floor.", src: "/landing/caliper.jpg", alt: "A vernier caliper measuring a machined ring", position: "50% 40%" },
  { tag: "Receive & ship", title: "Every load, on the record", text: "Incoming lots and outgoing shipments tie back to inspections, suppliers and inventory.", src: "/landing/loading-dock.jpg", alt: "A forklift loading a pallet onto a truck", position: "50% 58%" },
  { tag: "Inspect", title: "Every finding, followed up", text: "Audit and inspection results turn into nonconformances and corrective actions, not loose paper.", src: "/landing/inspector.jpg", alt: "An inspector in a hard hat holding a tablet on the plant floor", position: "50% 25%" },
];

export function Scenes() {
  return (
    <div className="lp-scenes">
      {SCENES.map((s) => (
        <figure key={s.tag} className="lp-scene">
          <div className="lp-scene-art">
            <img src={s.src} alt={s.alt} loading="lazy" style={{ objectPosition: s.position }} />
          </div>
          <figcaption>
            <span className="lp-mono">{s.tag}</span>
            <h3>{s.title}</h3>
            <p>{s.text}</p>
          </figcaption>
        </figure>
      ))}
    </div>
  );
}
