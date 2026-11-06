/** Read the MARS credential from the deployment environment. */
export function getMarsApiKey(): string {
  const raw = (process.env.USDA_MARS_API_KEY || "").trim();
  if (raw && !["null", "undefined", "none", ""].includes(raw.toLowerCase())) {
    return raw;
  }
  throw new Error("USDA_MARS_API_KEY is not configured.");
}
