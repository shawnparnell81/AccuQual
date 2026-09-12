# AccuQual AI Engine Specification

## 1. AI Engine Overview

The AccuQual AI Engine provides intelligence across all quality modules:
- Automated root cause analysis
- AI‑generated CAPA plans
- AI‑generated 8D drafts
- Risk scoring & prediction
- Audit preparation assistance
- Document summarization
- Supplier risk prediction
- Process drift detection
- Predictive defect analytics

It uses:
- LLMs (OpenAI/Anthropic)
- pgvector embeddings
- Custom pipelines
- Time-series data (optional)
- ElasticSearch for analytics

---

## 2. AI Engine Architecture

### Components

#### **LLM Gateway**
- Wraps OpenAI/Anthropic API calls
- Handles retries, rate limits, fallbacks
- Standardizes prompts and responses

#### **Embedding Engine**
- Uses pgvector inside PostgreSQL
- Stores embeddings for:
  - NCR descriptions
  - CAPA actions
  - Audit findings
  - Supplier issues
  - Training materials
  - Documents

#### **AI Pipelines**
- Root Cause Pipeline
- CAPA Generator Pipeline
- 8D Generator Pipeline
- Risk Scoring Pipeline
- Audit Prep Pipeline
- Document Summarization Pipeline
- Predictive Quality Pipeline

#### **Predictive Models**
- Defect forecasting
- Supplier risk prediction
- Process drift detection
- NCR severity prediction

---

## 3. AI Flow (Full Pipeline)

```
User Input
   ↓
Preprocessing (cleaning, normalization)
   ↓
Embedding Generation (pgvector)
   ↓
LLM Processing (OpenAI/Anthropic)
   ↓
Post-Processing (structuring, scoring)
   ↓
Storage (ai_suggestions, ai_risk_scores)
   ↓
Frontend UI (AI Insights Panel)
```

---

## 4. Example AI Pipeline Definitions

### Root Cause Pipeline

**Input:**
- NCR description  
- Evidence  
- Severity  
- Process context  

**Output:**
- Probable root cause  
- Confidence score  
- Supporting reasoning  
- Suggested corrective actions  

---

### CAPA Generator Pipeline

**Input:**
- Root cause  
- NCR details  
- Process data  

**Output:**
- Full CAPA plan  
- Verification steps  
- Preventive actions  
- Estimated closure time  

---

### 8D Generator Pipeline

**Input:**
- NCR + CAPA data  
- Team roles  
- Process context  

**Output:**
- Draft D1–D8 report  
- Recommended team members  
- Permanent corrective actions  

---

### Risk Scoring Pipeline

**Input:**
- Supplier history  
- NCR trends  
- Audit findings  
- Process data  

**Output:**
- Risk score (0–100)  
- Risk factors  
- Recommended mitigations  

---

## 5. AI Database Tables

### ai_suggestions
```ts
export const aiSuggestions = pgTable("ai_suggestions", {
  id: serial("id").primaryKey(),
  module: text("module"), // ncr, capa, 8d, audit
  input: jsonb("input"),
  output: jsonb("output"),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
});
```

### ai_risk_scores
```ts
export const aiRiskScores = pgTable("ai_risk_scores", {
  id: serial("id").primaryKey(),
  entityType: text("entity_type"), // supplier, process, product
  entityId: integer("entity_id"),
  score: numeric("score"),
  details: jsonb("details"),
  createdAt: timestamp("created_at").defaultNow(),
});
```

---

## 6. Example AI Controller

```ts
export const analyzeRootCause = async (req, res) => {
  const { ncrId, ncrData } = req.body;

  const suggestion = await callRootCauseLLM(ncrData);

  const [saved] = await db.insert(aiSuggestions).values({
    module: "ncr",
    input: ncrData,
    output: suggestion,
    createdBy: req.user.id,
  }).returning();

  res.json(saved);
};
```

---

## 7. AI Prompt Templates (Representative)

### Root Cause Prompt
```
You are an expert quality engineer. Analyze the following NCR and identify the most probable root cause. Provide reasoning and confidence score.

NCR Data:
{{ncrData}}
```

### CAPA Prompt
```
You are an expert quality engineer. Based on the root cause and NCR details, generate a complete CAPA plan including corrective actions, preventive actions, and verification steps.

Root Cause:
{{rootCause}}

NCR Data:
{{ncrData}}
```

### 8D Prompt
```
Generate a complete 8D report draft based on the NCR and CAPA information.

NCR:
{{ncrData}}

CAPA:
{{capaData}}
```

---

## 8. TODOs for Claude

### AI Engine TODOs
- TODO: Scaffold AI engine directory
- TODO: Implement LLM Gateway
- TODO: Implement Embedding Engine
- TODO: Implement Root Cause Pipeline
- TODO: Implement CAPA Generator Pipeline
- TODO: Implement 8D Generator Pipeline
- TODO: Implement Risk Scoring Pipeline
- TODO: Implement Audit Prep Pipeline
- TODO: Implement Document Summarization Pipeline
- TODO: Implement Predictive Quality Pipeline

### AI Integration TODOs
- TODO: Create API endpoints for each pipeline
- TODO: Create frontend AI Insights panel
- TODO: Create NCR/CAPA/8D AI suggestion UI components
- TODO: Create risk score visualization components

### AI Data TODOs
- TODO: Create pgvector embedding tables
- TODO: Create AI suggestion history views
- TODO: Create risk score dashboards

