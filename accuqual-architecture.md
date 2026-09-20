# AccuQual – System Architecture Specification

## 0. Vision
AccuQual is a next-generation Quality Management System combining:
- Quality modules structured around ISO 9001 / IATF 16949-style practices (not a certification claim)
- Modern SaaS features
- AI-driven quality intelligence
- Digital twin simulation
- IoT-powered inspections

---

## 1. High-Level Architecture

### Client Layer
- React + Vite + Tailwind (Web)
- React Native + Expo (Mobile)
- Admin Console
- Supplier Portal
- Customer Portal

### API Layer
- Node.js + Express
- Drizzle ORM
- REST + WebSockets
- JWT auth + refresh tokens
- RBAC (role-based access control)

### Services Layer
- Quality Engine (NCR, CAPA, 8D, Audits, Training, Change, Risk, Supplier, Calibration, Complaints)
- Workflow Engine (drag-and-drop automation)
- AI Engine (LLM-powered quality intelligence)
- Quality rules engine (structured around ISO 9001 / IATF 16949-style practices)
- Notification Engine
- File Storage Service
- Audit Trail Service
- Search Service (ElasticSearch)
- Digital Twin Service (simulation + IoT ingestion)

### Data Layer
- PostgreSQL (primary relational DB)
- Redis Streams (queueing/events)
- ElasticSearch (search + analytics)
- MinIO or Azure Blob (file storage)
- Optional TimescaleDB for time-series

### Deployment Layer
- Docker
- Kubernetes (AKS)
- GitHub Actions
- Terraform

---

## 2. System Diagram (Text-Based)

Client Apps → API Gateway → Microservices → Databases → External Integrations

Where:
- Microservices = Quality Engine, Workflow Engine, AI Engine, Digital Twin Engine, Compliance Engine
- Databases = PostgreSQL, Redis, ElasticSearch, Blob Storage
- External Integrations = ERP, MES, CRM, PLM, IoT/PLC

---

## 3. Cross-Cutting Concerns

### Authentication
- JWT access + refresh tokens
- Role-based access control (RBAC)
- Optional MFA

### Logging
- Winston logger
- Centralized log aggregation

### Audit Trails
- Every change logged
- Immutable history

### Error Handling
- Global error middleware
- Structured error responses

### Security
- OWASP best practices
- Rate limiting
- Input validation (Zod)

---

## 4. TODOs for Claude

### Architecture TODOs
- TODO: Generate full microservice scaffolding
- TODO: Implement API gateway structure
- TODO: Implement RBAC middleware
- TODO: Create environment variable templates
- TODO: Create service-to-service communication layer
- TODO: Create base Dockerfiles for each service
- TODO: Create base Kubernetes manifests for each service

### Documentation TODOs
- TODO: Generate architecture diagrams
- TODO: Generate service responsibility matrix
- TODO: Generate deployment topology diagrams
