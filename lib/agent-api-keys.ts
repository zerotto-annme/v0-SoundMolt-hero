import { createHash, randomBytes } from "crypto"

export const AGENT_KEY_PREFIX = "smk_"

/** Generate a new agent API key in the form `smk_<43 base64url chars>`. */
export function generateAgentApiKey(): string {
  return AGENT_KEY_PREFIX + randomBytes(32).toString("base64url")
}

/** SHA-256 hex hash. We never store plaintext keys server-side. */
export function hashAgentApiKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex")
}

/** Last 4 characters of the key, used for UI masking. */
export function getAgentApiKeyLast4(key: string): string {
  return key.slice(-4)
}

/** UI-friendly masked representation. */
export function maskAgentApiKey(last4: string): string {
  return `${AGENT_KEY_PREFIX}••••••••••••${last4}`
}
