# AccuQual Frontend Specification

## 1. Frontend Technology Stack

- **React** (UI framework)
- **Vite** (bundler)
- **TailwindCSS** (styling)
- **ShadCN UI** (component library)
- **React Query** (server state management)
- **Zustand** (local state management)
- **React Router** (routing)
- **TypeScript** (strong typing)
- **Axios** (API client)

---

## 2. Frontend Folder Structure

```
apps/web/src/
  main.tsx
  App.tsx

  routes/
    Dashboard/
    NCR/
    CAPA/
    Audits/
    Documents/
    Training/
    Workflow/
    AI/
    DigitalTwin/

  components/
    layout/
    forms/
    tables/
    charts/
    modals/

  hooks/
  api/
  store/
  styles/
```

---

## 3. UI Wireframes (Text-Based)

### Dashboard
- NCR severity chart
- CAPA status overview
- Audit calendar widget
- Supplier scorecards
- AI insights panel (predicted risks, suggested CAPAs)

### NCR List
- Table with filters (severity, status, date range)
- Bulk actions
- Export options
- Quick-create NCR button

### NCR Detail
Tabs:
- Overview
- Root Cause
- CAPA
- 8D
- AI Suggestions
- Audit Trail

### CAPA Detail
- Root cause summary
- Action plan
- Verification steps
- AI-generated CAPA recommendations

### Workflow Builder
- Drag-and-drop nodes
- Trigger nodes (NCR created, CAPA closed, etc.)
- Condition nodes (severity = high, overdue, etc.)
- Action nodes (assign user, create CAPA, send email)
- Node properties panel

### AI Insights
- Predicted high-risk NCRs
- Suggested CAPA improvements
- Process drift alerts
- Supplier risk predictions

### Digital Twin
- Process flow diagram
- Machine nodes
- Risk heatmap
- Simulation controls
- Time slider for historical playback

---

## 4. Frontend Cross-Cutting Concerns

### State Management
- Zustand for UI state
- React Query for server state

### API Layer
- Axios instance with:
  - JWT token injection
  - Refresh token handling
  - Error interceptors

### UI Consistency
- ShadCN UI components
- Tailwind utility classes
- Dark mode support

### Security
- Role-based UI visibility
- Protected routes
- Auto-logout on token expiration

---

## 5. Example Component Structures

### NCR List Page

```
NcrList.tsx
  - Fetch NCR list via React Query
  - Render table
  - Filters component
  - Severity badges
  - Status chips
```

### Workflow Builder

```
WorkflowBuilder.tsx
  - Canvas area
  - Node components
  - Edge rendering
  - Properties sidebar
  - Save workflow button
```

### AI Panel

```
AiPanel.tsx
  - Fetch AI suggestions
  - Render cards
  - Confidence scores
  - Action buttons
```

---

## 6. TODOs for Claude

### Frontend TODOs
- TODO: Scaffold all React routes
- TODO: Scaffold Zustand stores
- TODO: Scaffold React Query API hooks
- TODO: Implement authentication pages
- TODO: Implement protected route wrapper
- TODO: Implement NCR list + detail pages
- TODO: Implement CAPA list + detail pages
- TODO: Implement 8D workflow UI
- TODO: Implement Audit pages
- TODO: Implement Document Control UI
- TODO: Implement Workflow Builder UI
- TODO: Implement AI Insights UI
- TODO: Implement Digital Twin UI

### UI/UX TODOs
- TODO: Create global layout (sidebar, header)
- TODO: Create notification system
- TODO: Create modal system
- TODO: Create form components
- TODO: Create table components
- TODO: Create chart components

