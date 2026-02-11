import { fetchRbnSpots } from "./rbn-api.mjs";
import { normalizeCall, normalizeRbnSpot, normalizeSelectedDays } from "./rbn-normalize.mjs";

const SLOT_META = [
  { id: "A", label: "Primary" },
  { id: "B", label: "Compare 1" },
  { id: "C", label: "Compare 2" },
  { id: "D", label: "Compare 3" },
];

function buildSlotRequests(config) {
  const calls = [
    normalizeCall(config?.primary || ""),
    normalizeCall(config?.comparisons?.[0] || ""),
    normalizeCall(config?.comparisons?.[1] || ""),
    normalizeCall(config?.comparisons?.[2] || ""),
  ];

  return SLOT_META.map((slot, index) => ({
    ...slot,
    call: calls[index] || "",
  })).filter((slot) => Boolean(slot.call));
}

function normalizeSlotPayload(slotCall, days, data) {
  const ofUsSpots = (data?.ofUsSpots || []).map(normalizeRbnSpot).filter(Boolean);
  const byUsSpots = (data?.byUsSpots || []).map(normalizeRbnSpot).filter(Boolean);

  return {
    status: "ready",
    call: slotCall,
    days,
    error: null,
    retryAfterMs: 0,
    totalScanned: Number(data?.total || data?.scanned || 0),
    totalOfUs: Number.isFinite(data?.totalOfUs) ? Number(data.totalOfUs) : ofUsSpots.length,
    totalByUs: Number.isFinite(data?.totalByUs) ? Number(data.totalByUs) : byUsSpots.length,
    capPerSide: Number.isFinite(data?.capPerSide) ? Number(data.capPerSide) : null,
    truncatedOfUs: Boolean(data?.truncatedOfUs),
    truncatedByUs: Boolean(data?.truncatedByUs),
    notFound: Boolean(data?.notFound),
    errors: Array.isArray(data?.errors) ? data.errors : [],
    raw: {
      ofUsSpots,
      byUsSpots,
    },
  };
}

async function runRbnAnalysis(config) {
  const startedAt = Date.now();
  const days = normalizeSelectedDays(config?.dates || []);
  const activeSlots = buildSlotRequests(config);

  const promises = activeSlots.map(async (slot) => {
    try {
      const payload = await fetchRbnSpots(slot.call, days);
      return {
        id: slot.id,
        label: slot.label,
        ...normalizeSlotPayload(slot.call, days, payload),
      };
    } catch (error) {
      const status = Number(error?.status);
      return {
        id: slot.id,
        label: slot.label,
        status: status === 429 ? "qrx" : "error",
        call: slot.call,
        days,
        error: error?.message || "Failed to load RBN spots.",
        retryAfterMs: Number.isFinite(error?.retryAfterMs) ? Number(error.retryAfterMs) : 0,
        totalScanned: 0,
        totalOfUs: 0,
        totalByUs: 0,
        capPerSide: null,
        truncatedOfUs: false,
        truncatedByUs: false,
        notFound: false,
        errors: [],
        raw: {
          ofUsSpots: [],
          byUsSpots: [],
        },
      };
    }
  });

  const slots = await Promise.all(promises);
  const finishedAt = Date.now();

  const hasAnyLoaded = slots.some((slot) => slot.status === "ready");
  const hasAnyData = slots.some((slot) => slot.status === "ready" && (slot.totalOfUs > 0 || slot.totalByUs > 0));
  const hasAnyFailure = slots.some((slot) => slot.status === "error" || slot.status === "qrx");

  return {
    startedAt,
    finishedAt,
    durationMs: finishedAt - startedAt,
    days,
    slots,
    hasAnyLoaded,
    hasAnyData,
    hasAnyFailure,
  };
}

export { runRbnAnalysis, SLOT_META };
