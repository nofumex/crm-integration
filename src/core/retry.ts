export async function withRetry<T>(operation: () => Promise<T>, options: { attempts?: number; baseDelayMs?: number } = {}): Promise<T> {
  const attempts = options.attempts ?? 3;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try { return await operation(); } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise(resolve => setTimeout(resolve, (options.baseDelayMs ?? 100) * 2 ** (attempt - 1)));
    }
  }
  throw lastError;
}
