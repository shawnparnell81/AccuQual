# AccuQual Digital Twin Specification

## 1. Purpose of the Digital Twin System

The AccuQual Digital Twin provides a real-time, data-driven virtual model of:
- Manufacturing processes
- Machines and equipment
- Materials and product flow
- Operators and workstations

Its goals:
- Predict defects before they occur
- Simulate process changes safely
- Visualize quality risks in real time
- Detect anomalies and drift
- Improve decision-making with live data

---

## 2. Digital Twin Architecture Overview

### Components

#### **1. Model Builder**
Defines the structure of the digital twin:
- Machines
- Production lines
- Processes
- Material flow
- Operator interactions
- Quality checkpoints

Models are stored as JSON structures in PostgreSQL.

#### **2. Simulation Engine**
Runs simulations using:
- Monte Carlo methods
- Process flow modeling
- Defect propagation modeling
- Statistical drift detection

Outputs:
- Predicted defect rates
- Process bottlenecks
- Risk heatmaps
- Recommended corrective actions

#### **3. IoT Ingestion Layer**
Collects real-time data from:
- PLCs
- Sensors
- Inspection equipment
- Machine logs
- Environmental sensors

Data is stored in:
- TimescaleDB (time-series)
- ElasticSearch (analytics)

#### **4. Visualization Layer**
Provides:
- Process flow diagrams
- Machine status dashboards
- Risk heatmaps
- Simulation playback
- Trend charts

Rendered in the frontend using React + Tailwind + chart libraries.

---

## 3. Digital Twin Data Flow

```
IoT Devices
    ↓
IoT Ingestion API
    ↓
Time-Series Database (TimescaleDB)
    ↓
Digital Twin Model (PostgreSQL)
    ↓
Simulation Engine
    ↓
Predictions + Risk Scores
    ↓
Frontend Visualization (Digital Twin UI)
```

---

## 4. Digital Twin Database Structures

### digital_twin_models
```ts
export const digitalTwinModels = pgTable("digital_twin_models", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  modelJson: jsonb("model_json").notNull(), // machines, processes, flow
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
});
```

### digital_twin_simulations
```ts
export const digitalTwinSimulations = pgTable("digital_twin_simulations", {
  id: serial("id").primaryKey(),
  modelId: integer("model_id").references(() => digitalTwinModels.id),
  inputParameters: jsonb("input_parameters"),
  results: jsonb("results"),
  createdAt: timestamp("created_at").defaultNow(),
});
```

### iot_data (TimescaleDB hypertable)
```ts
export const iotData = pgTable("iot_data", {
  id: serial("id").primaryKey(),
  deviceId: text("device_id"),
  timestamp: timestamp("timestamp").notNull(),
  data: jsonb("data"), // sensor readings
});
```

---

## 5. Digital Twin API Endpoints

### Models
- GET `/digital-twin/models`
- POST `/digital-twin/models`
- GET `/digital-twin/models/:id`
- PATCH `/digital-twin/models/:id`

### Simulation
- POST `/digital-twin/simulate`
- GET `/digital-twin/simulations/:id`

### IoT Ingestion
- POST `/digital-twin/iot-ingest`

---

## 6. Example Digital Twin Controller

```ts
export const simulateDigitalTwin = async (req, res) => {
  const { modelId, parameters } = req.body;

  const model = await db.select().from(digitalTwinModels)
    .where(eq(digitalTwinModels.id, modelId));

  const results = await runSimulation(model.modelJson, parameters);

  const [saved] = await db.insert(digitalTwinSimulations).values({
    modelId,
    inputParameters: parameters,
    results,
  }).returning();

  res.json(saved);
};
```

---

## 7. Digital Twin UI Structure

### DigitalTwinPage.tsx
- Loads model list
- Loads IoT data stream
- Displays:
  - Process flow diagram
  - Machine nodes
  - Risk heatmap
  - Simulation controls
  - Time slider

### SimulationPanel.tsx
- Input fields for parameters
- Run simulation button
- Results viewer

### IoTStreamPanel.tsx
- Live sensor feed
- Charts
- Alerts for anomalies

---

## 8. TODOs for Claude

### Digital Twin Core TODOs
- TODO: Scaffold digital twin model builder
- TODO: Implement simulation engine
- TODO: Implement Monte Carlo simulation module
- TODO: Implement defect propagation model
- TODO: Implement drift detection algorithms

### IoT TODOs
- TODO: Create IoT ingestion API
- TODO: Create TimescaleDB hypertable migrations
- TODO: Create IoT device registry
- TODO: Create IoT data validation layer

### Frontend TODOs
- TODO: Create Digital Twin UI pages
- TODO: Create process flow diagram renderer
- TODO: Create risk heatmap component
- TODO: Create simulation results viewer

### Analytics TODOs
- TODO: Create ElasticSearch index for IoT analytics
- TODO: Create dashboards for trends + anomalies

