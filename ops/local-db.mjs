// Local database helper. Runs schema migrations and demo seeding against the
// LOCAL Postgres container (localhost:5433) and refuses to run against anything
// else, so it can never touch Supabase / production by accident.
//
//   node ops/local-db.mjs setup    apply migrations, seed the demo company + admin, seed the demo story
//   node ops/local-db.mjs migrate  apply migrations only
//   node ops/local-db.mjs status   show which host this would use and whether it answers
//
// Start the database first:  docker compose up -d postgres redis
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LOCAL_URL = "postgres://accuqual:accuqual@localhost:5433/accuqual";
const command = process.argv[2] ?? "status";

const host = new URL(LOCAL_URL).hostname;
if (!["localhost", "127.0.0.1"].includes(host)) {
  console.error(`Refusing to run: ${host} is not a local database.`);
  process.exit(1);
}

const env = { ...process.env, DATABASE_URL: LOCAL_URL, NODE_ENV: "development" };

function npm(script) {
  console.log(`\n> npm run ${script} --workspace services/api   (database: ${host}:5433/accuqual)`);
  const result = spawnSync("npm", ["run", script, "--workspace", "services/api"], { cwd: root, env, stdio: "inherit", shell: true });
  if (result.status !== 0) {
    console.error(`\n"${script}" failed. Is the local database up?  docker compose up -d postgres redis`);
    process.exit(result.status ?? 1);
  }
}

switch (command) {
  case "migrate":
    npm("db:migrate");
    break;
  case "setup":
    npm("db:migrate");
    npm("db:seed");
    npm("db:seed-demo-story");
    console.log("\nLocal database ready. Demo login: admin@accuqual.local / ChangeMe123!");
    console.log("Run the stack on it:  npm run local:up");
    break;
  case "status": {
    const result = spawnSync("docker", ["compose", "exec", "-T", "postgres", "pg_isready", "-U", "accuqual"], { cwd: root, stdio: "inherit", shell: true });
    console.log(`Local database URL: ${LOCAL_URL.replace(/:[^:@]*@/, ":***@")}`);
    process.exit(result.status ?? 1);
    break;
  }
  default:
    console.error("Usage: node ops/local-db.mjs setup | migrate | status");
    process.exit(1);
}
