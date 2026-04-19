export interface UploadError {
  message: string
  statusCode?: string | number
}

export function isNetworkUploadError(error: UploadError): boolean {
  const msg = error.message?.toLowerCase() ?? ""
  const status = String(error.statusCode ?? "")
  if (["401", "403", "404", "413"].includes(status)) return false
  return (
    msg.includes("network") ||
    msg.includes("fetch failed") ||
    msg.includes("failed to fetch") ||
    msg.includes("econnrefused") ||
    msg.includes("timeout")
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
  options?: { onRetry?: () => void; onRetryDone?: () => void }
): Promise<{ data: T | null; error: UploadError | null }> {
  let result = await uploadFn()

  if (result.error && isNetworkUploadError(result.error)) {
    console.warn(`[upload] ${label} failed due to network error, retrying once…`, {
      error: result.error.message,
    })
    options?.onRetry?.()
    try {
      result = await uploadFn()
    } finally {
      options?.onRetryDone?.()
    }
  }

  return result
}
