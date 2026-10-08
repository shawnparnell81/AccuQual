# Workers

Three processes, each on its own Redis stream (`services/api/src/lib/eventBus.ts`):

| Worker | Stream | Job |
| --- | --- | --- |
| `workflow-worker` | `accuqual:workflow-events` | Runs Workflow Builder graphs when a module publishes a lifecycle event |
| `ai-worker` | `accuqual:ai-jobs` | Writes pgvector embeddings for new records |
| `digital-twin-worker` | `accuqual:digital-twin-jobs` | Watches IoT readings for process drift |

Each worker is its own npm workspace and Dockerfile. There is no `packages/*` shared library. The three workers import `services/api/src/**` by relative path (schema, workflow engine, embedding engine). Each also keeps its own short `redis-consumer.ts`.

Extract a `packages/core` when a worker needs code that reads `process.env`, or when a fourth consumer needs the same module. The workflow and simulation engines and the schema files do not read `process.env` today, so they can stay as relative imports.

Local run: `npm run dev --workspace workers/workflow-worker` (and the same for the other two). `DATABASE_URL` and `REDIS_URL` match the API. See the root `.env.example`.
