# AccuQual Tenant Onboarding Flow Specification

AccuQual is a multi-tenant SaaS platform. Each tenant represents a company, plant, division, or customer. This specification defines how new tenants are created, configured, branded, and initialized.

---

# 1. Tenant Creation Flow

### Trigger:
- Admin creates a new tenant via the AccuQual Admin Portal.
- Or automated provisioning via API.

### Steps:

1. **Create tenant record**
   - Insert into `tenants` table:
     - name
     - code
     - createdAt

2. **Provision tenant admin user**
   - Create first user with:
     - tenant_id
     - role = "tenant_admin"
     - email + password
     - MFA enabled

3. **Initialize tenant configuration**
   - Branding (logo, colors)
   - Default roles
   - Default permissions
   - Default workflow templates
   - Default form templates
   - Default digital twin models (optional)

4. **Provision tenant storage**
   - `/tenants/<tenant_id>/forms/`
   - `/tenants/<tenant_id>/documents/`
   - `/tenants/<tenant_id>/digital-twin/`
   - `/tenants/<tenant_id>/exports/`

5. **Provision tenant PDF templates**
   - NCR template
   - CAPA template
   - 8D template
   - Audit checklist template
   - Audit plan template
   - Supplier form template
   - Calibration form template
   - Complaint form template
   - Change form template
   - Discrepancy inspection template

6. **Provision tenant workflows**
   - NCR workflow
   - CAPA workflow
   - 8D workflow
   - Audit workflow
   - Supplier workflow
   - Calibration workflow

7. **Provision tenant AI context**
   - Create tenant-specific embedding namespace
   - Create tenant-specific prompt templates
   - Create tenant-specific AI configuration

8. **Provision tenant digital twin**
   - Create empty model registry
   - Create empty simulation registry
   - Create IoT device registry

9. **Send onboarding email**
   - Tenant admin receives:
     - Login link
     - Temporary password
     - Setup instructions

---

# 2. Tenant Login Flow

1. User enters email + password.
2. System resolves tenant_id from user record.
3. JWT includes:
   - user_id
   - tenant_id
   - roles
4. Backend sets:
   ```
   SET LOCAL app.current_tenant_id = <tenant_id>;
   ```
5. Frontend stores tenant context in session.

---

# 3. Tenant Branding

Each tenant can customize:
- Logo
- Colors
- PDF header/footer branding
- Email templates
- AI prompt branding
- Digital twin color themes

Branding is stored in:
```
tenants.branding
```

---

# 4. Tenant-Specific PDF Templates

Each tenant has its own templates stored in:
```
/tenants/<tenant_id>/forms/<form_type>/template.pdf
```

Templates can be:
- Default (AccuQual-provided)
- Custom (tenant-uploaded)

---

# 5. Tenant-Specific Workflows

Each tenant can:
- Customize NCR workflow
- Customize CAPA workflow
- Customize 8D workflow
- Customize audit workflow
- Customize supplier workflow

Stored in:
```
workflowDefinitions.tenantId
```

---

# 6. Tenant-Specific AI

AI pipelines must:
- Use tenant-specific embeddings
- Use tenant-specific prompt templates
- Use tenant-specific historical data
- Never leak cross-tenant insights

---

# 7. Tenant-Specific Digital Twin

Each tenant has:
- Its own machines
- Its own processes
- Its own IoT devices
- Its own simulations

Stored in:
```
digitalTwinModels.tenantId
digitalTwinSimulations.tenantId
iotData.tenantId
```

---

# 8. Tenant Deletion Flow (Soft Delete)

1. Mark tenant as inactive.
2. Disable all users.
3. Disable all workflows.
4. Disable all AI pipelines.
5. Archive all data.
6. Keep data for compliance retention.

---

# 9. TODOs for Claude

- TODO: Create tenant onboarding API
- TODO: Create tenant admin portal UI
- TODO: Create tenant branding UI
- TODO: Create tenant template upload UI
- TODO: Create tenant workflow editor
- TODO: Create tenant AI configuration UI
- TODO: Create tenant digital twin setup UI
- TODO: Create tenant deletion flow
- TODO: Add tenant_id to all modules
- TODO: Add RLS policies to all tables

