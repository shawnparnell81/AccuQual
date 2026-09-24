import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { env } from "../../config/env.js";
import { validate } from "../../middleware/validate.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { logger } from "../../utils/logger.js";
import { sendEmail } from "../notifications/notification.service.js";

/**
 * Public "contact us" form on the marketing page. No session and no tenant: it only turns a
 * visitor's message into one email to the sales inbox. A hidden `website` field catches bots
 * (real visitors never see or fill it) and a tight per-address limit keeps the endpoint from
 * being used to spam the inbox.
 */
export const contactRouter = Router();

const contactLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: env.NODE_ENV === "test" ? 100_000 : 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "TooManyRequests", message: "Too many messages from this address. Please try again in an hour." },
});

const contactSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(200),
  company: z.string().trim().max(160).optional().default(""),
  message: z.string().trim().min(10).max(4000),
  website: z.string().max(200).optional().default(""),
});

// Header values must never carry line breaks (header injection); the body is plain text so it needs no escaping.
const oneLine = (value: string) => value.replace(/[\r\n]+/g, " ").trim();

contactRouter.post(
  "/",
  contactLimiter,
  validate(contactSchema),
  asyncHandler(async (req, res) => {
    const { name, email, company, message, website } = req.body as z.infer<typeof contactSchema>;
    // Honeypot tripped: answer exactly like a success so a bot learns nothing, and send nothing.
    if (website) return res.status(202).json({ ok: true });

    const to = env.CONTACT_INBOX_EMAIL;
    if (!to) {
      logger.warn("Contact form message received but CONTACT_INBOX_EMAIL is not set — not delivered", { from: oneLine(email) });
      return res.status(503).json({ error: "ContactUnavailable", message: "The contact form isn't switched on yet. Please email us directly." });
    }
    const status = await sendEmail({
      to,
      subject: `AccuQual website enquiry — ${oneLine(name)}${company ? ` (${oneLine(company)})` : ""}`,
      body: [`Name: ${oneLine(name)}`, `Email: ${oneLine(email)}`, company ? `Company: ${oneLine(company)}` : null, "", message, "", "— sent from the AccuQual website contact form"]
        .filter((line): line is string => line !== null)
        .join("\n"),
    });
    if (status === "failed") return res.status(502).json({ error: "DeliveryFailed", message: "We couldn't send your message. Please try again shortly." });
    res.status(202).json({ ok: true });
  }),
);
