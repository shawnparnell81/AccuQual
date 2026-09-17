/**
 * Phase 1 email infrastructure — a real templating layer on top of the
 * real transport that already existed (notification.service.ts's
 * EmailTransport/SmtpTransport). Before this, every caller hand-built its
 * own subject/body strings inline (auth.service.ts's password reset did;
 * platform.service.ts's onboarding email didn't even call the real service
 * at all — see that file's own comment on the bug this fixes).
 *
 * Deliberately a small `{{variable}}` string-substitution engine, not a
 * dependency on a templating library — this app has exactly two real email
 * templates today, and every other "real infrastructure, minimal
 * implementation" piece in this codebase (the LLM gateway, the ERP sync
 * engine) makes the same call: build what's actually needed, not what a
 * library would default to.
 */
export type EmailTemplateName = "tenant_onboarding" | "password_reset";

interface EmailTemplate {
  subject: string;
  body: string; // {{token}} placeholders, replaced by renderTemplate
}

const TEMPLATES: Record<EmailTemplateName, EmailTemplate> = {
  tenant_onboarding: {
    subject: "Welcome to AccuQual — {{tenantName}} is ready",
    body:
      "Hi {{adminName}},\n\n" +
      "Your AccuQual workspace for {{tenantName}} has been created.\n\n" +
      "Sign in at {{loginUrl}} with:\n" +
      "  Email: {{adminEmail}}\n" +
      "  Temporary password: {{temporaryPassword}}\n\n" +
      "You'll be asked to set a new password on first sign-in.\n\n" +
      "— The AccuQual Team",
  },
  password_reset: {
    subject: "Reset your AccuQual password",
    body:
      "We received a request to reset your AccuQual password. This link expires in {{expiresInMinutes}} minutes and can only be used once:\n\n" +
      "{{resetUrl}}\n\n" +
      "If you didn't request this, you can safely ignore this email — your password hasn't been changed.",
  },
};

/** Replaces every {{token}} in a template's subject/body with the matching value from `variables`. A token with no matching variable is left as-is (visibly wrong, not silently blanked) so a missing variable is a caller bug you'd actually notice, not lost data. */
export function renderTemplate(name: EmailTemplateName, variables: Record<string, string>): { subject: string; body: string } {
  const template = TEMPLATES[name];
  const fill = (text: string) => text.replace(/\{\{(\w+)\}\}/g, (match, token: string) => variables[token] ?? match);
  return { subject: fill(template.subject), body: fill(template.body) };
}
