import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { users } from "./users.js";

export const changeRequests = pgTable("change_requests", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  impactAssessment: text("impact_assessment"),
  status: text("status").notNull().default("submitted"), // submitted, under_review, approved, rejected, implemented
  requestedBy: integer("requested_by").references(() => users.id),
  approvedBy: integer("approved_by").references(() => users.id),
  approvedAt: timestamp("approved_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at"),
});

export type ChangeRequest = typeof changeRequests.$inferSelect;
