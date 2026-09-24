import { useEffect } from "react";
import { Link } from "react-router-dom";
import { STANDARDS_DISCLAIMER } from "../../components/shared/StandardsDisclaimer";
import { CaseFile } from "./CaseFile";
import { ContactForm } from "./ContactForm";
import { DragDemo } from "./DragDemo";
import { Scenes } from "./Scenes";
import { TwinSlider } from "./TwinSlider";
import "./landing.css";

const FONTS_HREF = "https://fonts.googleapis.com/css2?family=Bebas+Neue&family=IBM+Plex+Mono:wght@400;600&family=Newsreader:opsz,wght@6..72,400;6..72,500&display=swap";

const EXHIBITS = [
  { tag: "Exhibit A", title: "Your data stays yours", text: "Every company's records are isolated at the database level. Roles decide who can see and change each module, and admins can change those rules themselves." },
  { tag: "Exhibit B", title: "AI that asks first", text: "AI drafts root causes, triage and supplier messages. You accept or reject each suggestion, and the decision is logged." },
  { tag: "Exhibit C", title: "Forms that match yours", text: "Bring your own spreadsheets and forms. One form engine fills, prints and links them to the rest of the record." },
  { tag: "Exhibit D", title: "Digital twin", text: "Machine readings arrive through device keys and are compared with spec. Drift raises an alert before it becomes a scrapped lot." },
  { tag: "Exhibit E", title: "Workflow you can version", text: "Draft, review and publish your own workflow rules, with an approval step and a frozen history of what was live when." },
  { tag: "Exhibit F", title: "A trail auditors can follow", text: "Changes are recorded with who, what and when. Export your data any time as JSON and CSV with your files." },
];

const MODULES = ["NCR", "CAPA", "8D", "Audits", "Documents", "Training", "Calibration", "Supplier quality", "PPAP", "Work orders", "Inventory", "Warranty & RMA"];

export function LandingPage() {
  useEffect(() => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = FONTS_HREF;
    document.head.appendChild(link);
    const previous = document.title;
    document.title = "AccuQual QMS — quality management, made tangible";
    return () => {
      link.remove();
      document.title = previous;
    };
  }, []);

  return (
    <div className="lp">
      <header className="lp-nav">
        <div className="lp-wrap lp-nav-in">
          <a href="#top" className="lp-brand"><img src="/branding/logo-mark.png" alt="" />ACCUQUAL</a>
          <nav className="lp-links" aria-label="Sections">
            <a href="#demo">Try it</a>
            <a href="#floor">On the floor</a>
            <a href="#case">Case file</a>
            <a href="#twin">Digital twin</a>
            <a href="#plans">Plans</a>
          </nav>
          <div className="lp-nav-cta">
            <Link to="/login" className="lp-btn">Sign in</Link>
            <a href="#contact" className="lp-btn lp-btn-primary">Contact us</a>
          </div>
        </div>
      </header>

      <main id="top">
        <section className="lp-hero" id="demo">
          <div className="lp-wrap lp-hero-grid">
            <div>
              <p className="lp-label">A quality management system</p>
              <h1>Don&apos;t read about it. <em>Drag it.</em></h1>
              <p className="lp-lede">Every nonconformance, corrective action, audit and calibration in one connected record. Grab the windows and see how a real quality case moves.</p>
              <div className="lp-hero-cta">
                <a href="#contact" className="lp-btn lp-btn-primary">Talk to us</a>
                <a href="#case" className="lp-btn">Follow a case</a>
              </div>
              <p className="lp-fine">The windows to the right use sample data. Nothing you do on this page is saved.</p>
            </div>
            <DragDemo />
          </div>
        </section>

        <section className="lp-strip" aria-label="At a glance">
          <div className="lp-wrap lp-strip-in">
            <div><b>Every module</b><span>Linked to the same record</span></div>
            <div><b>Tenant-isolated</b><span>Per-company data separation</span></div>
            <div><b>Role-based</b><span>Permissions you control</span></div>
            <div><b>Audit trail</b><span>Who changed what, and when</span></div>
          </div>
        </section>

        <section className="lp-sec" id="floor">
          <div className="lp-wrap">
            <p className="lp-label">On the floor</p>
            <h2>From the gauge to the dock</h2>
            <p className="lp-sec-lede">Quality happens at the bench, the receiving door and the audit walk. AccuQual keeps a record of each one.</p>
            <Scenes />
          </div>
        </section>

        <section className="lp-sec" id="case">
          <div className="lp-wrap">
            <p className="lp-label">Case file</p>
            <h2>Torque reads 3.6 Nm. Spec calls for 4.2.</h2>
            <p className="lp-sec-lede">Scroll to follow one quality case from the shop floor to closure, and watch the record build itself.</p>
            <CaseFile />
          </div>
        </section>

        <section className="lp-sec">
          <div className="lp-wrap">
            <p className="lp-label">The evidence</p>
            <h2>What&apos;s in the box</h2>
            <p className="lp-sec-lede">One platform for the records a quality team keeps, from incoming inspection to customer returns.</p>
            <div className="lp-ex">
              {EXHIBITS.map((e) => (
                <div key={e.tag}>
                  <span className="lp-mono">{e.tag}</span>
                  <h3>{e.title}</h3>
                  <p>{e.text}</p>
                </div>
              ))}
            </div>
            <p className="lp-mono" style={{ marginTop: 28, lineHeight: 2 }}>{MODULES.join("  ·  ")}</p>
          </div>
        </section>

        <section className="lp-sec" id="twin">
          <div className="lp-wrap">
            <p className="lp-label">Digital twin</p>
            <h2>See drift before it costs you</h2>
            <div className="lp-twin">
              <p className="lp-sec-lede" style={{ marginTop: 0 }}>Connect a machine and AccuQual compares each reading with spec. Push the slider to see how a small drift becomes an alert, and then a suggested NCR. The numbers here are an illustration, not live telemetry.</p>
              <TwinSlider />
            </div>
          </div>
        </section>

        <section className="lp-sec" id="plans">
          <div className="lp-wrap">
            <p className="lp-label">Plans</p>
            <h2>Sized to your plant</h2>
            <p className="lp-sec-lede">Pricing is being finalized. Tell us about your plant and we&apos;ll come back with a quote.</p>
            <div className="lp-plans">
              <div className="lp-plan"><h3>Foundation</h3><ul><li>Core quality records: NCR, CAPA, documents</li><li>Roles and permissions</li><li>Audit trail and data export</li></ul></div>
              <div className="lp-plan"><h3>Operations</h3><ul><li>Everything in Foundation</li><li>Supplier, inventory and work orders</li><li>AI assist and workflow rules</li></ul></div>
              <div className="lp-plan"><h3>Enterprise</h3><ul><li>Everything in Operations</li><li>Multiple sites and single sign-on</li><li>Onboarding help for your team</li></ul></div>
            </div>
          </div>
        </section>

        <section className="lp-sec" id="contact">
          <div className="lp-wrap lp-contact">
            <div>
              <p className="lp-label">Open your own case file</p>
              <h2>Let&apos;s talk</h2>
              <p className="lp-sec-lede">Tell us what your quality team tracks today and what slows it down. We&apos;ll show you how it would look in AccuQual.</p>
              <p className="lp-fine">Already a customer? <Link to="/login" style={{ textDecoration: "underline" }}>Sign in</Link>.</p>
            </div>
            <ContactForm />
          </div>
        </section>
      </main>

      <footer className="lp-foot">
        <div className="lp-wrap lp-foot-in">
          <span>© {new Date().getFullYear()} AccuQual</span>
          <span style={{ maxWidth: "40em" }}>{STANDARDS_DISCLAIMER}</span>
        </div>
      </footer>
    </div>
  );
}
