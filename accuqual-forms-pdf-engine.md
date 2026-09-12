# AccuQual Forms & PDF Engine Specification

## 1. Purpose

AccuQual must support **browser‑native, fillable PDF forms** for ALL QMS modules:
- NCR
- CAPA
- 8D
- 5‑Why
- Audit Checklists
- Audit Plans
- Discrepancy Inspection
- Supplier Forms
- Training Forms
- Change Management Forms
- Calibration Forms
- Complaint Forms
- Any future forms

Forms must be:
- Fillable directly in the browser  
- Editable without downloading  
- Auto‑saved  
- Versioned  
- Exportable to PDF  
- Mapped to database fields  
- AI‑enhanced (optional)  
- Openable in multiple windows inside the app  

---

# 2. PDF Engine Requirements

### 2.1 Rendering Engine
Use:
- **PDF.js** for rendering  
- **PDF.js AcroForm support** for fillable fields  
- **Custom annotation layer** for dynamic fields  

### 2.2 Form Field Types
Must support:
- Text fields  
- Text areas  
- Checkboxes  
- Radio buttons  
- Dropdowns  
- Date pickers  
- Digital signatures  
- AI‑generated suggestion fields  

### 2.3 Data Binding
Form fields must bind to:
- PostgreSQL tables  
- Drizzle ORM models  
- Auto‑save service  
- Versioning service  

### 2.4 Versioning
Every save creates:
- A new version  
- A diff record  
- A timestamp  
- A user reference  
- A rollback option  

### 2.5 Export
Forms can be exported as:
- Flattened PDF  
- Editable PDF  
- JSON data  
- Attachments to NCR/CAPA/etc.

---

# 3. Multi‑Window Workspace System

AccuQual must include a **desktop‑style multi‑window interface** inside the web app.

### 3.1 Window Manager
Features:
- Open multiple forms at once  
- Each form in its own window  
- Draggable  
- Resizable  
- Minimize / Maximize  
- Close  
- Z‑index stacking  
- Snap‑to‑grid (optional)  

### 3.2 Workspace Persistence
If the user refreshes:
- All windows restore  
- All form states restore  
- No data loss  

### 3.3 Window Types
- Form windows  
- Document windows  
- Audit windows  
- AI suggestion windows  
- Digital twin windows  

---

# 4. Form Templates

Forms must be stored as:
- PDF templates  
- JSON field maps  
- Database schemas  
- AI prompt templates  

Example:
```json
{
  "pdfTemplate": "/templates/ncr.pdf",
  "fields": {
    "title": "field_001",
    "description": "field_002",
    "severity": "field_003",
    "rootCause": "field_004"
  }
}
```

---

# 5. Backend Requirements

### 5.1 Form Service
Must provide:
- Load PDF template  
- Load form data  
- Merge data into PDF  
- Save form data  
- Version form data  
- Export PDF  
- Validate fields  
- AI enhancement hooks  

### 5.2 Endpoints
- GET `/forms/:type/:id`
- POST `/forms/:type/:id/save`
- POST `/forms/:type/:id/version`
- POST `/forms/:type/:id/export`
- GET `/forms/:type/template`

---

# 6. Frontend Requirements

### 6.1 PDF Viewer Component
Must:
- Render PDF.js  
- Overlay fillable fields  
- Bind fields to Zustand store  
- Auto‑save  
- Show version history  
- Support signatures  

### 6.2 Window Manager Component
Must:
- Create new windows  
- Track open windows  
- Handle drag/resize  
- Persist state  
- Close windows cleanly  

### 6.3 Form Editor Component
Must:
- Bind fields to API  
- Validate input  
- Show AI suggestions  
- Show version history  
- Allow export  

---

# 7. Database Requirements

### 7.1 Form Data Table
```ts
export const formData = pgTable("form_data", {
  id: serial("id").primaryKey(),
  formType: text("form_type").notNull(),
  entityId: integer("entity_id"), // NCR, CAPA, etc.
  data: jsonb("data").notNull(),
  version: integer("version").default(1),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
});
```

### 7.2 Form Version Table
```ts
export const formVersions = pgTable("form_versions", {
  id: serial("id").primaryKey(),
  formId: integer("form_id").references(() => formData.id),
  version: integer("version").notNull(),
  data: jsonb("data").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});
```

---

# 8. TODOs for Claude

### PDF Engine TODOs
- TODO: Scaffold PDF.js viewer
- TODO: Scaffold AcroForm field overlay system
- TODO: Scaffold form field → DB mapping
- TODO: Scaffold auto‑save service
- TODO: Scaffold versioning service
- TODO: Scaffold export service

### Multi‑Window TODOs
- TODO: Create window manager component
- TODO: Create window state store (Zustand)
- TODO: Create draggable/resizable window UI
- TODO: Create workspace persistence system

### Backend TODOs
- TODO: Create form service
- TODO: Create form endpoints
- TODO: Create form versioning logic
- TODO: Create PDF merge/export logic

### Frontend TODOs
- TODO: Create PDF viewer component
- TODO: Create form editor component
- TODO: Create version history UI
- TODO: Create AI suggestion panel

### Database TODOs
- TODO: Create form_data table
- TODO: Create form_versions table
- TODO: Create indexes for formType + entityId

