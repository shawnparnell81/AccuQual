import { describe, expect, it } from "vitest";
import {
  documentNodeKind,
  folderLocationLabel,
  folderMoveAudit,
  folderRenameAudit,
  itemFolderPath,
  ISO_ROOT_NAME,
  MAIN_ISO_FOLDER_NAMES,
  mainIsoChildOrder,
  planMainIsoFolderCreates,
  planMainIsoSetup,
  type SortableFolder,
} from "../src/modules/document-folders/mainIsoFolders.js";

function row(id: number, name: string, parentId: number | null, sortOrder = 0): SortableFolder {
  return { id, name, parentId, sortOrder };
}

describe("main ISO folders", () => {
  it("plans the 14 drawers under ISO and reuses a direct child instead of a nested namesake", () => {
    const folders = [
      row(1, ISO_ROOT_NAME, null),
      row(2, "Quality", 1, 0),
      row(3, "Procedures", 1, 4),
      row(4, "Engineering", 1, 1),
      row(5, "Engineering Standards", 4, 0),
      row(6, "Quality Manual", 2, 0),
      row(7, "Blank Form Templates", 1, 2),
    ];
    const plan = planMainIsoFolderCreates(folders);
    expect(plan?.isoId).toBe(1);
    expect(plan?.names).not.toContain("Procedures");
    expect(plan?.names).toContain("Engineering Standards");
    expect(plan?.names).toContain("Quality Manual");
    expect(plan?.names).toContain("Blank Forms Templates");
    expect(plan?.names).not.toContain("Blank Form Templates");
    expect(plan?.names[0]).toBe("Master Source Files");
    expect(plan?.names.at(-1)).toBe("Obsolete Archive");
    expect(plan?.names).toHaveLength(MAIN_ISO_FOLDER_NAMES.length - 1);
  });

  it("plans nothing once every drawer is already a direct child", () => {
    const folders = [row(1, ISO_ROOT_NAME, null), ...MAIN_ISO_FOLDER_NAMES.map((name, index) => row(index + 2, name, 1, 20 - index))];
    expect(planMainIsoFolderCreates(folders)?.names).toEqual([]);
    const again = planMainIsoFolderCreates(folders);
    expect(again?.names).toEqual([]);
  });

  it("orders the 14 first and leaves other children, including a duplicate name, in place behind them", () => {
    const children = [
      row(10, "Quality", 1, 0),
      row(11, "Procedures", 1, 1),
      row(12, "Procedures", 1, 2),
      ...MAIN_ISO_FOLDER_NAMES.filter((name) => name !== "Procedures").map((name, index) => row(30 + index, name, 1, 50 + index)),
    ];
    const ordered = mainIsoChildOrder(children);
    expect(ordered.slice(0, MAIN_ISO_FOLDER_NAMES.length).map((folder) => folder.name)).toEqual([...MAIN_ISO_FOLDER_NAMES]);
    expect(ordered[2]?.id).toBe(11);
    expect(ordered.slice(MAIN_ISO_FOLDER_NAMES.length).map((folder) => folder.id)).toEqual([10, 12]);
  });

  it("creates the drawers once, and does not put a deleted or renamed drawer back", () => {
    const fresh = [row(1, ISO_ROOT_NAME, null), row(2, "Procedures", 1), row(3, "Quality", 1)];
    const first = planMainIsoSetup(fresh, false);
    expect(first.action).toBe("seed");
    if (first.action !== "seed") return;
    expect(first.names).toContain("Master Source Files");
    expect(first.names).not.toContain("Procedures");
    expect(first.names).toHaveLength(MAIN_ISO_FOLDER_NAMES.length - 1);

    const already = [row(1, ISO_ROOT_NAME, null), ...MAIN_ISO_FOLDER_NAMES.map((name, index) => row(index + 2, name, 1))];
    expect(planMainIsoSetup(already, true)).toEqual({ action: "skip" });

    const deleted = already.filter((folder) => folder.name !== "Facility Records");
    expect(planMainIsoSetup(deleted, true)).toEqual({ action: "skip" });
    expect(planMainIsoSetup(deleted, false)).toEqual({ action: "adopt" });

    const renamed = already.map((folder) => (folder.name === "Engineering Logs" ? { ...folder, name: "Shop Log" } : folder));
    expect(planMainIsoSetup(renamed, false)).toEqual({ action: "adopt" });
    expect(planMainIsoSetup([row(1, ISO_ROOT_NAME, null)], false).action).toBe("seed");
  });

  it("does not plan a delete or a rename", () => {
    const plan = planMainIsoFolderCreates([row(1, ISO_ROOT_NAME, null), row(2, "Old Notes", 1)]);
    expect(plan?.names.every((name) => MAIN_ISO_FOLDER_NAMES.includes(name as (typeof MAIN_ISO_FOLDER_NAMES)[number]))).toBe(true);
    expect(JSON.stringify(plan)).not.toMatch(/delete|rename/i);
  });

  it("writes an auditor line for a folder move and a saved item, and refuses to call a container an item", () => {
    const folders = [row(1, ISO_ROOT_NAME, null), row(2, "Quality", 1), row(3, "FAI / Validation", 2), row(4, "Quality Logs", 1)];
    expect(folderLocationLabel(folders, 3)).toBe("ISO Compliance Documents / Quality / FAI / Validation");
    expect(folderLocationLabel(folders, null)).toBe("the top level");
    const folderMove = folderMoveAudit({
      name: "Quality",
      kind: documentNodeKind({ id: 2, linkedPath: null, pdfPath: null, documentId: null }, folders),
      fromParentId: 1,
      toParentId: 4,
      fromLabel: itemFolderPath(folders, 1, "Quality"),
      toLabel: itemFolderPath(folders, 4, "Quality"),
    });
    expect(folderMove.summary).toBe('Moved the folder "Quality" from ISO Compliance Documents\\Quality → ISO Compliance Documents\\Quality Logs\\Quality.');
    expect(folderMove.fromPath).toBe("ISO Compliance Documents\\Quality");
    expect(folderMove.toPath).toBe("ISO Compliance Documents\\Quality Logs\\Quality");
    expect(folderMove.fromParentId).toBe(1);
    expect(folderMove.toParentId).toBe(4);

    const item = folderMoveAudit({
      name: "NCR 14",
      kind: documentNodeKind({ id: 9, linkedPath: "/iso-forms/record/14", pdfPath: null, documentId: null }, []),
      fromParentId: 2,
      toParentId: 4,
      fromLabel: itemFolderPath(folders, 2, "NCR 14"),
      toLabel: itemFolderPath(folders, 4, "NCR 14"),
    });
    expect(item.summary).toBe('Moved the saved item "NCR 14" from ISO Compliance Documents\\Quality\\NCR 14 → ISO Compliance Documents\\Quality Logs\\NCR 14.');
    expect(item.fromPath).toBe("ISO Compliance Documents\\Quality\\NCR 14");
    expect(item.toPath).toBe("ISO Compliance Documents\\Quality Logs\\NCR 14");
    expect(folderRenameAudit("Quality", "Quality Records").summary).toBe('Renamed the folder from "Quality" to "Quality Records".');
  });
});
