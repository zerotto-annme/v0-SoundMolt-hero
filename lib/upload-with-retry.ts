export interface UploadError {
  message: string
  statusCode?: string | number
}

export function isNetworkUploadError(error: UploadError): boolean {
  const msg = error.message?.toLowerCase() ?? ""
  const status = String(error.statusCode ?? "")
  if (["401", "403", "404", "413"].includes(status)) return false
  // Transient upstream HTTP errors from the storage gateway — worth retrying.
  if (["408", "429", "500", "502", "503", "504"].includes(status)) return true
  if (/\bhttp\s*5\d\d\b/i.test(error.message ?? "")) return true
  return (
    msg.includes("network") ||
    msg.includes("fetch failed") ||
    msg.includes("failed to fetch") ||
    msg.includes("econnrefused") ||
    msg.includes("timeout") ||
    msg.includes("bad gateway") ||
    msg.includes("gateway timeout") ||
    msg.includes("service unavailable")
  )
}

export function getUploadErrorMessage(error: UploadError): string {
  const msg = error.message?.toLowerCase() ?? ""
  const status = String(error.statusCode ?? "")

  if (status === "413" || msg.includes("payload too large") || msg.includes("too large") || msg.includes("maximum allowed size") || msg.includes("file size")) {
    return "The file is too large. Please choose a smaller file."
  }
  if (msg.includes("mime") || msg.includes("content type") || msg.includes("unsupported") || msg.includes("invalid file type") || msg.includes("not allowed")) {
    return "That file format isn't supported. Please try a different file."
  }
  if (status === "401" || status === "403" || msg.includes("unauthorized") || msg.includes("forbidden") || msg.includes("policy") || msg.includes("row-level security")) {
    return "Upload was refused by the server. You may not have permission to upload right now."
  }
  if (status === "404" || msg.includes("bucket not found") || msg.includes("not found")) {
    return "The storage location could not be found. Please contact support."
  }
  if (msg.includes("quota") || msg.includes("storage limit") || msg.includes("insufficient")) {
    return "Storage limit reached. Please contact support."
  }
  if (msg.includes("network") || msg.includes("fetch failed") || msg.includes("failed to fetch") || msg.includes("econnrefused") || msg.includes("timeout")) {
    return "Upload failed due to a network error. Please check your connection and try again."
  }
  return `Upload failed: ${error.message}. Please try again.`
}

export async function uploadWithRetry<T>(
  uploadFn: () => Promise<{ data: T | null; error: UploadError | null }>,
  label: string,
  options?: { onRetry?: () => void; onRetryDone?: () => void; maxRetries?: number }
): Promise<{ data: T | null; error: UploadError | null }> {
  const maxRetries = options?.maxRetries ?? 3
  let result = await uploadFn()
  let attempt = 0
  let notifiedRetry = false

  while (result.error && isNetworkUploadError(result.error) && attempt < maxRetries) {
    attempt += 1
    const delayMs = Math.min(500 * 2 ** (attempt - 1), 4000)
    console.warn(`[upload] ${label} failed (attempt ${attempt}/${maxRetries}), retrying in ${delayMs}ms…`, {
      error: result.error.message,
      statusCode: result.error.statusCode,
    })
    if (!notifiedRetry) {
      options?.onRetry?.()
      notifiedRetry = true
    }
    await new Promise(r => setTimeout(r, delayMs))
    try {
      result = await uploadFn()
    } catch (err) {
      result = { data: null, error: { message: err instanceof Error ? err.message : String(err) } }
    }
  }

  if (notifiedRetry) options?.onRetryDone?.()
  return result
}
