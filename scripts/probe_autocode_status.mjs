const baseUrl = process.env.ELSA_BASE_URL ?? "https://brain.pin-yi.uk";

function shape(value, depth = 0) {
  if (depth > 2) return typeof value;
  if (Array.isArray(value)) {
    return { type: "array", length: value.length, item: value.length ? shape(value[0], depth + 1) : "unknown" };
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, shape(nested, depth + 1)]));
  }
  if (value === null) return "null";
  return typeof value;
}

try {
  const response = await fetch(`${baseUrl}/api/autocode`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(8_000),
  });
  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json") ? await response.json() : null;
  console.log(JSON.stringify({
    endpoint: "/api/autocode",
    method: "GET",
    status: response.status,
    contentType,
    payloadShape: body === null ? "non-json-or-empty" : shape(body),
  }, null, 2));
} catch (error) {
  console.log(JSON.stringify({
    endpoint: "/api/autocode",
    method: "GET",
    status: "request_failed",
    error: error instanceof Error ? error.message : "unknown error",
  }, null, 2));
}
