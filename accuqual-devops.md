# AccuQual DevOps Specification

## 1. DevOps Technology Stack

- **Docker** (containerization)
- **Kubernetes (AKS)** (or EKS/GKE if needed)
- **GitHub Actions** (CI/CD)
- **Terraform** (infrastructure as code)
- **Azure Blob Storage** (file storage)
- **Azure Container Registry** (image registry)
- **Azure Key Vault** (secrets)
- **Azure Monitor** (logs + metrics)
- **NGINX Ingress** (routing)
- **Cert-Manager** (TLS certificates)

---

## 2. CI/CD Pipeline Overview

### CI Pipeline (GitHub Actions)
Triggered on:
- Push to `main`
- Pull requests
- Tag creation

Pipeline steps:
1. Checkout repository  
2. Install dependencies  
3. Lint  
4. Run tests  
5. Build frontend  
6. Build backend  
7. Build Docker images  
8. Push images to ACR  
9. Trigger CD pipeline

### CD Pipeline (GitHub Actions → AKS)
Steps:
1. Authenticate to Azure  
2. Pull latest images  
3. Apply Kubernetes manifests  
4. Run database migrations  
5. Restart deployments  
6. Health checks  
7. Notify Slack/Teams

---

## 3. Docker Structure

### API Dockerfile (multi-stage)
- Stage 1: Install dependencies  
- Stage 2: Build TypeScript  
- Stage 3: Run lightweight Node.js server  

### Web Dockerfile (multi-stage)
- Stage 1: Build React app  
- Stage 2: Serve via NGINX  

### Worker Dockerfile
- Workflow engine worker  
- AI engine worker  
- Digital twin simulation worker  

---

## 4. Kubernetes Structure (AKS)

```
infra/k8s/
  api-deployment.yaml
  api-service.yaml
  web-deployment.yaml
  web-service.yaml
  worker-deployment.yaml
  ingress.yaml
  configmap.yaml
  secrets.yaml
```

### Key Kubernetes Components

#### Deployments
- `accuqual-api`
- `accuqual-web`
- `accuqual-worker`
- `accuqual-ai-worker`
- `accuqual-digital-twin-worker`

#### Services
- ClusterIP for internal services  
- LoadBalancer for public web/API  

#### Ingress
- NGINX ingress controller  
- TLS via cert-manager  

#### ConfigMaps
- Environment variables  
- Service configuration  

#### Secrets
- JWT secret  
- Database credentials  
- API keys  
- LLM keys  

---

## 5. Terraform Structure

```
infra/terraform/
  main.tf
  variables.tf
  outputs.tf
  aks/
  acr/
  storage/
  keyvault/
  networking/
```

### Terraform Responsibilities
- Provision AKS cluster  
- Provision Azure Container Registry  
- Provision Blob Storage  
- Provision Key Vault  
- Provision VNET + subnets  
- Configure RBAC  
- Configure autoscaling  

---

## 6. Logging & Monitoring

### Logging
- Centralized logs via Azure Monitor  
- Winston logs shipped to Log Analytics  
- Audit logs stored in PostgreSQL  

### Monitoring
- CPU, memory, pod health  
- API latency  
- Error rates  
- Workflow engine queue depth  
- AI pipeline performance  

### Alerts
- High error rate  
- Pod restart loops  
- Workflow queue backlog  
- AI pipeline failures  
- Digital twin ingestion failures  

---

## 7. Deployment Flow (Text Diagram)

```
Developer Push →
GitHub Actions CI →
Docker Build →
Push to ACR →
GitHub Actions CD →
AKS Deployment →
Pods Updated →
Health Checks →
AccuQual Live
```

---

## 8. Example GitHub Actions CI Workflow

```yaml
name: CI

on:
  push:
    branches: [ main ]

jobs:
  build-and-test:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: "20"

      - name: Install dependencies
        run: npm install

      - name: Lint
        run: npm run lint

      - name: Test
        run: npm test

      - name: Build API
        run: npm run build --workspace services/api

      - name: Build Web
        run: npm run build --workspace apps/web
```

---

## 9. Example Kubernetes Deployment (API)

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: accuqual-api
spec:
  replicas: 3
  selector:
    matchLabels:
      app: accuqual-api
  template:
    metadata:
      labels:
        app: accuqual-api
    spec:
      containers:
        - name: api
          image: <ACR_URL>/accuqual-api:latest
          ports:
            - containerPort: 3000
          envFrom:
            - configMapRef:
                name: accuqual-config
            - secretRef:
                name: accuqual-secrets
```

---

## 10. TODOs for Claude

### CI/CD TODOs
- TODO: Generate full CI pipeline (build, test, lint, docker)
- TODO: Generate full CD pipeline (deploy to AKS)
- TODO: Add migration step to CD pipeline
- TODO: Add Slack/Teams notifications

### Docker TODOs
- TODO: Create Dockerfiles for:
  - API
  - Web
  - Worker
  - AI Worker
  - Digital Twin Worker

### Kubernetes TODOs
- TODO: Generate all deployment manifests
- TODO: Generate services + ingress
- TODO: Generate configmaps + secrets
- TODO: Generate autoscaling configs

### Terraform TODOs
- TODO: Scaffold AKS provisioning
- TODO: Scaffold ACR provisioning
- TODO: Scaffold Key Vault provisioning
- TODO: Scaffold networking
- TODO: Scaffold storage accounts

### Monitoring TODOs
- TODO: Create Azure Monitor dashboards
- TODO: Create alert rules
- TODO: Create log ingestion pipelines

