const RBN_PROXY_URL = "https://azure.s53m.com/cors/rbn";
const RBN_FETCH_TIMEOUT_MS = 15000;

function buildRateLimitError(response) {
  const retryAfter = String(response.headers.get("retry-after") || "").trim();
  const retryAfterSeconds = /^\d+$/.test(retryAfter) ? Number(retryAfter) : null;
  const err = new Error("Rate limited (HTTP 429).");
  err.status = 429;
  err.retryAfterMs = Number.isFinite(retryAfterSeconds) ? retryAfterSeconds * 1000 : 15000;
  return err;
}

async function parseErrorMessage(response) {
  const fallback = `HTTP ${response.status}`;
  try {
    const text = await response.text();
    if (!text) return fallback;
    try {
      const data = JSON.parse(text);
      if (data && typeof data === "object" && data.error) {
        return String(data.error);
      }
      if (data && typeof data === "object" && data.message) {
        return String(data.message);
      }
    } catch {
      return fallback;
    }
    return fallback;
  } catch {
    return fallback;
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = RBN_FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs) || RBN_FETCH_TIMEOUT_MS));
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchRbnSpots(call, days) {
  const params = new URLSearchParams();
  if (call) params.set("call", call);
  if (Array.isArray(days) && days.length) params.set("days", days.join(","));
  const url = `${RBN_PROXY_URL}?${params.toString()}`;

  let response;
  try {
    response = await fetchWithTimeout(url, { cache: "no-store" });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("RBN request timed out. Please try again.");
    }
    throw error;
  }

  if (response.status === 429) {
    throw buildRateLimitError(response);
  }

  if (response.status === 404) {
    return {
      call: String(call || ""),
      days: Array.isArray(days) ? days.slice() : [],
      total: 0,
      totalOfUs: 0,
      totalByUs: 0,
      capPerSide: 0,
      truncatedOfUs: false,
      truncatedByUs: false,
      ofUsSpots: [],
      byUsSpots: [],
      errors: [],
      notFound: true,
    };
  }

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response));
  }

  const rawText = await response.text();
  let data;
  try {
    data = JSON.parse(rawText);
  } catch {
    throw new Error("Invalid RBN response (non-JSON). Try again in a moment.");
  }

  if (!data || typeof data !== "object") {
    throw new Error("Invalid RBN response.");
  }

  return data;
}

export { fetchRbnSpots, RBN_PROXY_URL };
