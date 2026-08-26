const baseUrl = process.env.ELSA_BASE_URL ?? "https://brain.pin-yi.uk";
const endpoints = [
  "/api/memory/stats",
  "/api/memory/recent",
  "/trade/auto/status",
  "/api/config",
  "/api/models",
];

function shape(value, depth = 0) {
  if (depth > 2) return typeof value;
  if (Array.isArray(value)) return { type: "array", length: value.length, item: value.length ? shape(value[0], depth + 1) : "unknown" };
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, shape(nested, depth + 1)]));
  if (value === null) return "null";
  return typeof value;
}

const report = [];
for (const endpoint of endpoints) {
  try {
    const response = await fetch(`${baseUrl}${endpoint}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8_000) });
    const contentType = response.headers.get("content-type") ?? "";
    const body = contentType.includes("application/json") ? await response.json() : await response.text();
    report.push({ endpoint, status: response.status, contentType, payloadShape: typeof body === "string" ? "non-json" : shape(body) });
  } catch (error) {
    report.push({ endpoint, status: "request_failed", error: error instanceof Error ? error.message : "unknown error" });
  }
}

console.log(JSON.stringify({ baseUrl, checkedAt: new Date().toISOString(), report }, null, 2));
