# AccuQual – Patch Instructions for PDF Engine & Multi‑Window Workspace

These patches modify the existing AccuQual project to integrate the PDF form engine, form data model, versioning system, and multi‑window workspace UI. Apply all patches exactly as written.

---

# 1. ARCHITECTURE PATCH

## Add to `accuqual-architecture.md`:

### New Subsystem: PDF Form Engine
- Add a dedicated **Form Engine Service** under the Services Layer.
- Add a **PDF Rendering Layer** using PDF.js.
- Add a **Form Versioning Layer** connected to PostgreSQL.
- Add a **Form Template Registry** for all QMS forms.

### New Subsystem: Multi‑Window Workspace
- Add a **Window Manager** under the Frontend Client Layer.
- Add a **Workspace Persistence Service** under the Frontend.
- Add a **Window State Sync Layer** using Zustand.

### Update Architecture Diagram
Add:
- `Form Engine`
- `Window Manager`
- `Form Data Model`
- `Form Versioning`
- `PDF.js Viewer`

---

# 2. BACKEND PATCH

## Add to `accuqual-backend.md`:

### New Module: `/forms`
Create a new backend module with:
- controllers/
- services/
- routes/
- validators/
- pdf/

### New Endpoints:
- GET `/forms/:type/:id`
- POST `/forms/:type/:id/save`
- POST `/forms/:type/:id/version`
- POST `/forms/:type/:id/export`
- GET `/forms/:type/template`

### New Services:
- `formService.ts`
  - loadTemplate()
  - loadData()
  - saveData()
  - createVersion()
  - exportPdf()
  - mergePdfFields()

### New Middleware:
- `validateFormFields.ts`
- `validateFormType.ts`

### New PDF Utilities:
- `pdfRenderer.ts` (PDF.js server-side)
- `pdfMerger.ts` (inject DB data into PDF fields)

### Update Existing Modules:
NCR, CAPA, 8D, Audit, etc. must:
- reference form IDs
- attach form versions
- expose form endpoints

---

# 3. FRONTEND PATCH

## Add to `accuqual-frontend.md`:

### New Components:
- `PdfViewer.tsx`
- `FormEditor.tsx`
- `FormFieldOverlay.tsx`
- `FormVersionHistory.tsx`

### New Window Manager:
Create:
- `WindowManager.tsx`
- `WindowContainer.tsx`
- `WindowFrame.tsx`

### New Zustand Stores:
- `useWindowStore.ts`
- `useFormStore.ts`

### New Features:
- Open multiple forms simultaneously
- Draggable/resizable windows
- Minimize/maximize windows
- Workspace persistence on refresh
- Auto-save form fields
- Version history sidebar
- Export to PDF button

### Update Routing:
Every module (NCR, CAPA, 8D, Audit, etc.) must:
- include “Open Form” button
- open form in a new window via WindowManager

---

# 4. DATABASE PATCH

## Add to `accuqual-database.md`:

### New Tables:
Add `form_data` and `form_versions` exactly as defined in `accuqual-forms.md`.

### Add Indexes:
- `form_data(formType)`
- `form_data(entityId)`
- `form_versions(formId)`
- `form_versions(version)`

### Update Existing Tables:
Add `formId` references to:
- NCR
- CAPA
- 8D
- Audit
- Complaints
- Supplier
- Calibration
- Change Management

---

# 5. AI ENGINE PATCH

## Add to `accuqual-ai.md`:

### New AI Pipelines:
- Form field suggestion pipeline
- Form auto-fill pipeline
- Form validation pipeline

### New AI Endpoints:
- POST `/ai/forms/suggest`
- POST `/ai/forms/autofill`

### Update Existing Pipelines:
Root cause, CAPA, 8D must:
- read form_data
- write AI suggestions into form fields

---

# 6. DIGITAL TWIN PATCH

## Add to `accuqual-digital-twin.md`:

### New Feature:
Digital twin simulations must be able to:
- attach simulation results to forms
- open simulation results in a window
- export simulation results as PDF

---

# 7. DEVOPS PATCH

## Add to `accuqual-devops.md`:

### New Dockerfile:
- `Dockerfile.forms` for PDF rendering service

### New Kubernetes Deployments:
- `accuqual-forms-service`
- `accuqual-window-manager-service` (frontend)

### New Terraform Modules:
- PDF rendering microservice
- Workspace state persistence storage

---

# 8. REQUIRED PROJECT-WIDE CHANGES

### Add a `/forms` directory to the project root:
```
services/forms/
  controllers/
  services/
  pdf/
  routes/
  utils/
```

### Add a `/window-manager` directory to the frontend:
```
apps/web/src/window-manager/
  WindowManager.tsx
  WindowFrame.tsx
  WindowContainer.tsx
  useWindowStore.ts
```

### Add global types:
- `FormField`
- `FormTemplate`
- `FormVersion`
- `WindowInstance`

---

# 9. TODO INTEGRATION

Claude must:
- Merge all TODOs from `accuqual-forms.md` into the existing TODO lists.
- Complete TODOs in the correct order:
  1. Database tables  
  2. Backend form service  
  3. PDF engine  
  4. Window manager  
  5. Frontend form editor  
  6. Versioning  
  7. AI integration  
  8. Digital twin integration  
  9. DevOps deployment  

---

# 10. EXECUTION INSTRUCTIONS FOR CLAUDE

After applying this patch, Claude must:
- NOT regenerate the project from scratch.
- Extend the existing project.
- Add new directories, files, and modules.
- Modify existing modules where required.
- Maintain naming consistency: **AccuQual** everywhere.
- Maintain TypeScript strict mode.
- Maintain modular architecture.

