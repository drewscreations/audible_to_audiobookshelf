/**
 * Runs once when the Next.js server boots (see next docs: instrumentation.js).
 * Starts the auto-sync scheduler that keeps Audiobookshelf up to date with
 * new Audible purchases.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startScheduler } = await import("./lib/sync-engine");
    startScheduler();
  }
}
