/**
 * Shared timing helpers for request timeouts and retry backoff.
 */

export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage?: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<T>((_, reject) =>
    timer = setTimeout(
      () => reject(new Error(timeoutMessage || `Request timeout after ${timeoutMs}ms`)),
      timeoutMs
    )
  );

  return Promise.race([
    promise,
    timeoutPromise,
  ]).finally(() => {
    clearTimeout(timer);
  });
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
      resolve();
    }, ms);

    const onAbort = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(new DOMException('Aborted', 'AbortError'));
    };

    if (signal) {
      if (signal.aborted) {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }

      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}