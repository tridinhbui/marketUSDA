/** Match _build_turkey.py / GitHub Actions: env secret or embedded fallback used in repo scripts. */
export function getMarsApiKey(): string {
  const raw = (process.env.USDA_MARS_API_KEY || "").trim();
  if (raw && !["null", "undefined", "none", ""].includes(raw.toLowerCase())) {
    return raw;
  }
  return "J5v4ZF527NWTlOlFSErtwNYO/2+fa0m2ZLOtZqa3jXs=";
}
