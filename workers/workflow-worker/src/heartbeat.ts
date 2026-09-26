import { connectRedis, openRedis } from "./redis-consumer.js";

/**
 * Tells the API's monitor this worker is alive: sets a short-lived Redis key every 30 seconds. If the worker dies or
 * hangs the key expires and the "background workers" alert fires (services/api/src/modules/monitoring/alerts.ts). Each
 * worker carries its own copy so its Docker image stays self-contained.
 */
const PREFIX = "accuqual:heartbeat:";

export function startHeartbeat(name: string, redisUrl: string, onError: (err: unknown) => void = () => undefined): () => void {
  const client = openRedis(redisUrl);
  client.on("error", () => undefined); // a failed beat is skipped; reconnectStrategy is off so connect rejects
  const beat = async () => {
    try {
      if (!client.isOpen) await connectRedis(client);
      await client.set(PREFIX + name, String(Date.now()), { EX: 120 });
    } catch (err) {
      onError(err);
    }
  };
  void beat();
  const timer = setInterval(() => void beat(), 30_000);
  timer.unref();
  return () => {
    clearInterval(timer);
    void client.quit().catch(() => undefined);
  };
}
