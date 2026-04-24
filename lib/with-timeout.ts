export const TIMEOUT_PREFIX = "__TIMEOUT__:"

export function isTimeoutError(err: unknown): err is Error {
  return err instanceof Error && err.message.startsWith(TIMEOUT_PREFIX)
}

export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${TIMEOUT_PREFIX}${label}`))
    }, ms)
  })
  try {
    return await Promise.race([promise, timeoutPromise])
  } finally {
    if (timeoutId !== null) clearTimeout(timeoutId)
  }
}
