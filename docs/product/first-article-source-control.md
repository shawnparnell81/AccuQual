# First article and source approval

Quality and Engineering use this to keep a reusable inspection plan, open a numbered first article, record measurements, and show whether a part from a supplier is approved. It does not receive material. It does not hold inventory, bins, or purchase orders.

The First Article blank (First Article Inspection Report) is unchanged. Use that blank when you only need the original sheet. Use this record when you want a numbered first article, a frozen copy of the plan, and a source row.

Notices appear in Notifications. The same sentence is stored for email when email delivery is turned on.

## 1. Create an inspection plan

1. Open **First Article**.
2. Choose **New inspection plan**.
3. Name the plan.
4. Choose **Part** and enter the part number, or choose **Product family** and enter the family name.
5. Leave **Supplier limit** as “Any supplier,” or pick one supplier if the plan is only for that supplier.
6. Set **Cadence (months)**. Six months is the usual interval. A different number on this plan replaces that six-month interval when Quality approves a first article.
7. Add each characteristic and choose one mode:
   - **Percent from nominal** — enter the nominal and the percent. Five means five percent, so nominal 100 becomes 95 to 105.
   - **Plus / minus** — enter the nominal and the plus amount, the minus amount, or both. One amount applies to both sides.
   - **Min / max** — enter the minimum, the maximum, or both.
   - **Attribute** — pass or fail, with no numeric limit.
8. Choose **Save plan**.

Saving a change to characteristics, limits, the part or family, the supplier limit, or the cadence stores a new revision. Notes and the plan name do not. Filling a first article does not change the plan.

Creating a plan does not send a notice.

## 2. Open a first article

1. On **First Article**, choose **Open an FAI**.
2. Select the plan, the supplier, and the part number when the plan is for a family.
3. Optionally assign the person who will enter results.
4. Choose **Open first article**.

The number looks like `FAI-2026-000184`. The characteristic rules are copied onto the first article at that moment. Nominal, mode, and the calculated limits stay as they were. A later revision of the plan does not rewrite this first article.

A part and supplier that have no source row yet are added as **Pending**.

If you assign someone, that person receives:

> FAI-2026-000184 is ready for result entry. It is assigned to Priya Shah.

Use the real number and the person’s name. The sentence is the same shape.

## 3. Enter results

1. Open the first article.
2. Type each actual on the grid. For an attribute, choose Pass or Fail.
3. Pass or fail is calculated from the limits copied onto that row. A blank actual stays blank. Green is pass. Red is fail.
4. Add comments if you need them.
5. Choose **Save results**.

Engineering and Quality can enter results and comments while the first article is open. Saving results does not send a notice and does not revise the plan.

## 4. Submit for Quality review

When every row shows Pass or Fail, choose **Submit for Quality review**.

Quality receives:

> FAI-2026-000184 has been submitted for Quality review.

The grid is then locked. Quality approves or does not approve. To measure the part again, open another first article.

## 5. Quality approves

Only Quality can approve, using the same 4-digit signature PIN used on other records. Check the certification box, enter the PIN, and sign **Approve**.

The source row for that part and supplier becomes **Approved**. The last pass date is the approval date. The next due date is that date plus the plan cadence, or six months when the plan does not set one.

The people involved receive:

> FAI-2026-000184 was approved. 4400-12 from Northline Metals is approved. The next inspection is due April 3, 2027.

The part, supplier, and date in the notice are the ones on the record.

## 6. Quality does not approve

Only Quality can reject, with the same PIN signature, under **Do not approve**.

A nonconformance is opened on the existing NCR record. The first article links to it. The source row becomes **Not approved**. The last pass date stays the last time this part from this supplier was actually approved.

The people involved receive:

> FAI-2026-000184 was not approved. 4400-12 from Northline Metals is not approved.

## 7. What the source list shows

Open **Source list**. There is one row per part and supplier.

| Status | Meaning |
| --- | --- |
| Pending | No first article has been approved yet. A new supplier starts here. |
| Approved | The latest Quality decision approved the part from that supplier. Last pass and next due are filled in. |
| Not approved | Quality did not approve the latest first article. |

Last pass is the date of the last approval. Next due is that date plus the cadence that was on the plan at approval. The list does not stop a receipt, a stock movement, or a purchase order.

## 8. The queue

**First Article** is the only queue. It has four groups:

- Open first articles (still being filled, or waiting for Quality)
- Due within 30 days
- Overdue
- Not approved

Opening the queue writes a due or overdue notice once for that due date. Quality receives:

> Inspection for 4400-12 from Northline Metals is due on April 3, 2027.

or:

> Inspection for 4400-12 from Northline Metals is overdue.

## 9. Yearly pull

Open **Yearly pull**. Quality sees in-scope parts that have no completed pull in the last 12 months. In-scope means the part is on an active part plan, or it already has a source row.

1. Choose the person and **Assign**.

That person receives:

> Priya Shah has been assigned the annual pull for 4400-12.

2. When the pull has been done, optionally link a first article and choose **Record pull**.

Quality, and the assigned person, receive:

> The annual pull for 4400-12 has been recorded.

There is no bin, no transfer order, and no sample quantity.

## 10. The PDF

After Quality approves or does not approve, open the first article and choose **Download PDF**. The file has the characteristics, limits, actuals, the Quality signature, and the outcome. One PDF per finished first article.
