/**
 * Structured logging utility for E2E test steps.
 *
 * Wraps async operations with before/after/failure logging and
 * optional timeout progress indicators at 1/3 and 2/3 intervals.
 */

/**
 * Execute an async step with structured logging.
 *
 * @param name  - Human-readable step description
 * @param fn    - Async function to execute
 * @param timeoutMs - Optional timeout hint for progress logging (does NOT enforce timeout)
 */
export async function loggedStep<T>(
  name: string,
  fn: () => Promise<T>,
  timeoutMs?: number,
): Promise<T> {
  const start = Date.now();
  console.log(`[Step] ${name}...`);

  let progressInterval: ReturnType<typeof setInterval> | undefined;

  if (timeoutMs && timeoutMs > 6_000) {
    const oneThird = Math.round(timeoutMs / 3);
    const twoThirds = Math.round((timeoutMs * 2) / 3);
    let logged1 = false;
    let logged2 = false;

    progressInterval = setInterval(() => {
      const elapsed = Date.now() - start;
      const elapsedS = Math.round(elapsed / 1000);
      const totalS = Math.round(timeoutMs / 1000);

      if (!logged1 && elapsed >= oneThird) {
        logged1 = true;
        console.log(`[Step] ${name} (${elapsedS}s/${totalS}s)`);
      }
      if (!logged2 && elapsed >= twoThirds) {
        logged2 = true;
        console.log(`[Step] ${name} (${elapsedS}s/${totalS}s)`);
      }
    }, 1000);
  }

  try {
    const result = await fn();
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`[Step] ${name} done (${elapsed}s)`);
    return result;
  } catch (error) {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[Step] ${name} FAILED (${elapsed}s): ${msg}`);
    throw error;
  } finally {
    if (progressInterval) clearInterval(progressInterval);
  }
}
