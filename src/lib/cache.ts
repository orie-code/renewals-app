type Entry<T> = { value: T; expiresAt: number };

const store = new Map<string, Entry<unknown>>();

export async function cached<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
  { bypass = false }: { bypass?: boolean } = {},
): Promise<T> {
  const now = Date.now();
  if (!bypass) {
    const hit = store.get(key) as Entry<T> | undefined;
    if (hit && hit.expiresAt > now) return hit.value;
  }
  const value = await loader();
  store.set(key, { value, expiresAt: now + ttlMs });
  return value;
}

export function invalidate(key: string) {
  store.delete(key);
}
