import { useState, type FormEvent } from "react";
import { apiClient } from "../../api/client";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";

type State = { kind: "idle" } | { kind: "sending" } | { kind: "sent" } | { kind: "error"; message: string };

/** Public contact form: posts to /contact, which emails the sales inbox. The hidden "website" field is a bot trap. */
export function ContactForm() {
  const [state, setState] = useState<State>({ kind: "idle" });

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries());
    setState({ kind: "sending" });
    try {
      await apiClient.post("/contact", data);
      form.reset();
      setState({ kind: "sent" });
    } catch (err) {
      setState({ kind: "error", message: extractErrorMessage(err, "We couldn't send that. Please try again.") });
    }
  }

  if (state.kind === "sent") {
    return (
      <div className="lp-form" role="status">
        <span className="lp-label">Message received</span>
        <p className="lp-msg-ok">Thanks. We&apos;ll reply to the address you gave us.</p>
        <button type="button" className="lp-btn" onClick={() => setState({ kind: "idle" })}>Send another</button>
      </div>
    );
  }
  return (
    <form className="lp-form" onSubmit={submit}>
      <label htmlFor="lp-name"><span className="lp-mono">Your name</span><input id="lp-name" name="name" required maxLength={120} autoComplete="name" /></label>
      <label htmlFor="lp-email"><span className="lp-mono">Work email</span><input id="lp-email" name="email" type="email" required maxLength={200} autoComplete="email" /></label>
      <label htmlFor="lp-company"><span className="lp-mono">Company (optional)</span><input id="lp-company" name="company" maxLength={160} autoComplete="organization" /></label>
      <label htmlFor="lp-message"><span className="lp-mono">What would you like to see?</span><textarea id="lp-message" name="message" required minLength={10} maxLength={4000} /></label>
      <div className="lp-hp" aria-hidden="true">
        <label htmlFor="lp-website">Leave this empty<input id="lp-website" name="website" tabIndex={-1} autoComplete="off" /></label>
      </div>
      {state.kind === "error" && <p className="lp-msg-err" role="alert">{state.message}</p>}
      <button type="submit" className="lp-btn lp-btn-primary" disabled={state.kind === "sending"}>{state.kind === "sending" ? "Sending…" : "Send message"}</button>
    </form>
  );
}
