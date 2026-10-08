import type { Request, Response } from "express";
import multer from "multer";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import {
  createBuiltForm,
  deleteBuiltForm,
  exportDocx,
  fileBuiltFill,
  getBuiltFill,
  getBuiltForm,
  importDocx,
  listBuiltForms,
  listRevisions,
  openBuiltFill,
  publishBuiltForm,
  saveBuiltFill,
  saveBuiltForm,
  signBuiltFill,
} from "./service.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1 } });

function actor(req: Request) {
  if (!req.user) throw AppError.unauthorized();
  return { id: req.user.id, roleName: req.user.roleName, department: req.user.department };
}

function idOf(value: string | undefined): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1) throw AppError.badRequest("That form could not be found.");
  return id;
}

export const listHandler = asyncHandler(async (req: Request, res: Response) => {
  res.json(await listBuiltForms(req.db!, actor(req)));
});

export const createHandler = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as { kind?: string; title?: string };
  res.status(201).json(await createBuiltForm(req.db!, actor(req), { kind: body.kind ?? "", title: body.title }));
});

export const getHandler = asyncHandler(async (req: Request, res: Response) => {
  res.json(await getBuiltForm(req.db!, actor(req), idOf(req.params.id)));
});

export const saveHandler = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as { title?: string; formNumber?: string | null; structure?: unknown; mode?: "autosave" | "save" | "publish" };
  res.json(await saveBuiltForm(req.db!, actor(req), idOf(req.params.id), body));
});

export const publishHandler = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as { folderId?: number; structure?: unknown };
  const folderId = Number(body.folderId);
  if (!Number.isInteger(folderId) || folderId < 1) throw AppError.badRequest("Choose a folder under Blank Forms Templates.");
  res.json(await publishBuiltForm(req.db!, actor(req), idOf(req.params.id), folderId, body.structure));
});

export const deleteHandler = asyncHandler(async (req: Request, res: Response) => {
  await deleteBuiltForm(req.db!, actor(req), idOf(req.params.id));
  res.status(204).send();
});

export const revisionsHandler = asyncHandler(async (req: Request, res: Response) => {
  res.json(await listRevisions(req.db!, actor(req), idOf(req.params.id)));
});

export const openFillHandler = asyncHandler(async (req: Request, res: Response) => {
  res.status(201).json(await openBuiltFill(req.db!, actor(req), idOf(req.params.id)));
});

export const getFillHandler = asyncHandler(async (req: Request, res: Response) => {
  res.json(await getBuiltFill(req.db!, actor(req), idOf(req.params.fillId)));
});

export const saveFillHandler = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as { title?: string; answers?: Record<string, unknown> };
  res.json(await saveBuiltFill(req.db!, actor(req), idOf(req.params.fillId), body));
});

export const fileFillHandler = asyncHandler(async (req: Request, res: Response) => {
  const folderId = Number((req.body as { folderId?: number }).folderId);
  if (!Number.isInteger(folderId) || folderId < 1) throw AppError.badRequest("Choose a Documents folder.");
  res.json(await fileBuiltFill(req.db!, actor(req), idOf(req.params.fillId), folderId));
});

export const signFillHandler = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as { fieldId?: string; pin?: string };
  res.json(await signBuiltFill(req.db!, actor(req), idOf(req.params.fillId), { fieldId: body.fieldId ?? "", pin: body.pin ?? "" }));
});

export const importDocxHandler = [
  upload.single("file"),
  asyncHandler(async (req: Request, res: Response) => {
    const file = req.file;
    if (!file?.buffer?.length) throw AppError.badRequest("Choose a .docx file.");
    res.json(await importDocx(req.db!, actor(req), file.buffer));
  }),
];

export const exportDocxHandler = asyncHandler(async (req: Request, res: Response) => {
  const file = await exportDocx(req.db!, actor(req), idOf(req.params.id));
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  res.setHeader("Content-Disposition", `attachment; filename="${file.filename.replace(/"/g, "")}"`);
  res.send(file.bytes);
});
