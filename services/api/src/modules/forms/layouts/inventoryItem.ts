import type { FormLayout } from "./types.js";

/**
 * The one real fillable/printable document in the Inventory module (see the
 * Inventory module plan) — a record of an item's identity and thresholds,
 * the same treatment Supplier gets for its Supplier Record. Actions on the
 * item (log a movement, adjust, mark reorder pending/on order) are plain
 * buttons on InventoryDetailPage, not part of this form, matching how
 * Supplier's approve/suspend/remove aren't part of its Supplier Record form
 * either.
 */
export const inventoryItemLayout: FormLayout = {
  formType: "inventory_item",
  title: "INVENTORY ITEM RECORD",
  sections: [
    {
      number: "1",
      title: "Item Identity",
      blocks: [
        {
          type: "row",
          fields: [
            { kind: "text", name: "sku", label: "SKU" },
            {
              kind: "select",
              name: "itemType",
              label: "Item Type",
              options: ["raw_material", "wip", "finished_good"],
            },
            { kind: "text", name: "unitOfMeasure", label: "Unit of Measure", hint: "e.g. ea, lb, ft" },
          ],
        },
        {
          type: "textarea",
          name: "description",
          label: "Description",
        },
      ],
    },
    {
      number: "2",
      title: "Thresholds & Reorder",
      blocks: [
        {
          type: "row",
          fields: [
            { kind: "number", name: "minLevel", label: "Min Level" },
            { kind: "number", name: "maxLevel", label: "Max Level" },
            { kind: "number", name: "reorderQuantity", label: "Reorder Quantity" },
            { kind: "number", name: "leadTimeDays", label: "Lead Time (days)" },
          ],
        },
      ],
    },
    {
      number: "3",
      title: "Notes",
      blocks: [
        {
          type: "textarea",
          name: "notes",
          label: "Notes",
        },
      ],
    },
  ],
};
