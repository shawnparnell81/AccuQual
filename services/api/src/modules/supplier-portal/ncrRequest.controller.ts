import type { Request, Response } from "express";
import { desc, eq } from "drizzle-orm";
import { supplierRmaRequests, rmaActivityLog } from "../../drizzle/schema/supplierRma.js";
import { suppliers } from "../../drizzle/schema/supplier.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { notifyDepartment } from "../notifications/notification.service.js";

/**
 * A supplier NCR request is a review item for Quality, stored on the
 * existing supplier request table. It does not insert an NCR or an RMA.
 * supplierId always comes from the login, never from the body or query.
 */
export const submitNcrRequestHandler = asyncHandler(async (req: Request, res: Response) => {
  if (req.user?.roleName !== "supplier" || !req.user.supplierId) {
    throw AppError.forbidden("Only a supplier login can submit an NCR request");
  }
  const supplierId = req.user.supplierId;
  const body = req.body as {
    companyName: string;
    contactName: string;
    email: string;
    phoneNumber?: string;
    partNumber?: string;
    summary: string;
    description?: string;
  };

  const [supplier] = await req.db!.select().from(suppliers).where(eq(suppliers.id, supplierId));
  if (!supplier) throw AppError.forbidden("This supplier login is not linked to a real supplier record");

  const [request] = await req
    .db!.insert(supplierRmaRequests)
    .values({
      supplierId,
      status: "submitted",
      companyName: body.companyName,
      contactName: body.contactName,
      email: body.email,
      phoneNumber: body.phoneNumber,
      partNumber: body.partNumber,
      shortDescription: body.summary,
      description: body.description,
      submittedByUserId: req.user.id,
    })
    .returning();

  await recordAuditTrail(req.db!, {
    entityType: "SupplierNcrRequest",
    entityId: request!.id,
    action: "create",
    changes: { summary: body.summary, partNumber: body.partNumber ?? null },
    performedBy: req.user.id,
  });
  await req.db!.insert(rmaActivityLog).values({
    supplierRmaRequestId: request!.id,
    event: "ncr_request_submitted",
    details: { companyName: body.companyName, partNumber: body.partNumber ?? null, summary: body.summary },
    performedBy: req.user.id,
  });

  const subject = `NCR request from ${body.companyName}`;
  const notifyBody = `${supplier.name} submitted an NCR request for Quality to review.\n\nSummary: ${body.summary}\nPart: ${body.partNumber ?? "n/a"}\nContact: ${body.contactName} (${body.email})\n\n${body.description ?? ""}`.trim();
  const qualityNotified = await notifyDepartment(req.db!, {
    department: "quality",
    subject,
    body: notifyBody,
    relatedEntityType: "SupplierNcrRequest",
    relatedEntityId: request!.id,
  });
  await req.db!.insert(rmaActivityLog).values({
    supplierRmaRequestId: request!.id,
    event: "notifications_sent",
    details: { qualityNotified },
    performedBy: req.user.id,
  });

  res.status(201).json({ request });
});

/** Supplier logins see only their own requests. Staff may list every request, or one supplier when supplierId is set. */
export const listNcrRequestsHandler = asyncHandler(async (req: Request, res: Response) => {
  const requested = req.query.supplierId ? Number(req.query.supplierId) : undefined;
  let supplierId: number | undefined;
  if (req.user?.roleName === "supplier") {
    if (!req.user.supplierId) throw AppError.forbidden("This supplier login is not linked to a real supplier record");
    supplierId = req.user.supplierId;
  } else if (requested) {
    supplierId = requested;
  }

  const rows = supplierId
    ? await req.db!.select().from(supplierRmaRequests).where(eq(supplierRmaRequests.supplierId, supplierId)).orderBy(desc(supplierRmaRequests.createdAt))
    : await req.db!.select().from(supplierRmaRequests).orderBy(desc(supplierRmaRequests.createdAt));
  res.json(rows);
});
