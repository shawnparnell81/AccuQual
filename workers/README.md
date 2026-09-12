# AccuQual Workers

Three background processes, each consuming its own Redis Stream (see
`services/api/src/lib/eventBus.ts`):

| Worker | Stream | Responsibility |
| --- | --- | --- |
| `workflow-worker` | `accuqual:workflow-events` | Runs the drag-and-drop workflow engine when NCR/CAPA/audit lifecycle events fire |
| `ai-worker` | `accuqual:ai-jobs` | Generates and stores pgvector embeddings for newly created records |
| `digital-twin-worker` | `accuqual:digital-twin-jobs` | Watches live IoT readings for process drift |

Each worker is its own npm workspace with its own `package.json`/Dockerfile,
but intentionally has **no shared `packages/*` dependency yet** — at this
size, three workers importing `services/api/src/**` by relative path (schema,
the workflow engine, the embedding engine) is simpler than standing up and
versioning a shared package. Each worker also keeps its own ~25-line
`redis-consumer.ts` rather than importing one, for the same reason.

**When to extract a shared `packages/core`:** once a worker needs logic that
isn't a pure, env-independent module (the workflow/simulation engines and
schema files qualify today because they don't read `process.env`), or once
a fourth consumer of the same code shows up. Track that as a TODO rather
than doing it preemptively.

Run locally: `npm run dev --workspace workers/workflow-worker` (etc.), with
`DATABASE_URL` and `REDIS_URL` set the same as the API (see root `.env.example`).
