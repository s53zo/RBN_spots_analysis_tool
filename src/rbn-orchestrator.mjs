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

function utcDayTokenFromTs(ts) {
  if (!Number.isFinite(ts)) return "";
  return new Date(ts).toISOString().slice(0, 10).replaceAll("-", "");
}

function utcDayStartTs(ts) {
  if (!Number.isFinite(ts)) return 0;
  const date = new Date(ts);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function resolveLiveWindow(windowHoursInput = 24, nowTs = Date.now()) {
  const allowed = new Set([1, 6, 12, 24, 48]);
  const parsed = Number(windowHoursInput);
  const windowHours = allowed.has(parsed) ? parsed : 24;
  const now = Number.isFinite(Number(nowTs)) ? Number(nowTs) : Date.now();
  const cutoffTs = now - windowHours * 3600 * 1000;

  const startDayTs = utcDayStartTs(cutoffTs);
  const endDayTs = utcDayStartTs(now);
  const days = [];
  for (let dayTs = startDayTs; dayTs <= endDayTs; dayTs += 24 * 3600 * 1000) {
    const token = utcDayTokenFromTs(dayTs);
    if (token) days.push(token);
  }

  return {
    windowHours,
    nowTs: now,
    cutoffTs,
    days,
  };
}

function buildLiveMergedPayload(slotCall, days, cutoffTs, dayResults) {
  const okResults = dayResults.filter((entry) => entry.ok).map((entry) => entry.payload);
  const merged = {
    call: slotCall,
    days,
    total: 0,
    totalOfUs: 0,
    totalByUs: 0,
    capPerSide: 0,
    truncatedOfUs: false,
    truncatedByUs: false,
    ofUsSpots: [],
    byUsSpots: [],
    errors: [],
    notFound: false,
  };

  for (const payload of okResults) {
    merged.total += Number(payload?.total || payload?.scanned || 0);
    merged.totalOfUs += Number.isFinite(payload?.totalOfUs)
      ? Number(payload.totalOfUs)
      : Array.isArray(payload?.ofUsSpots)
      ? payload.ofUsSpots.length
      : 0;
    merged.totalByUs += Number.isFinite(payload?.totalByUs)
      ? Number(payload.totalByUs)
      : Array.isArray(payload?.byUsSpots)
      ? payload.byUsSpots.length
      : 0;
    merged.capPerSide = Number.isFinite(payload?.capPerSide)
      ? Number(payload.capPerSide)
      : Number(merged.capPerSide || 0);
    merged.truncatedOfUs = merged.truncatedOfUs || Boolean(payload?.truncatedOfUs);
    merged.truncatedByUs = merged.truncatedByUs || Boolean(payload?.truncatedByUs);
    merged.notFound = merged.notFound || Boolean(payload?.notFound);
    if (Array.isArray(payload?.ofUsSpots) && payload.ofUsSpots.length) {
      merged.ofUsSpots.push(...payload.ofUsSpots);
    }
    if (Array.isArray(payload?.byUsSpots) && payload.byUsSpots.length) {
      merged.byUsSpots.push(...payload.byUsSpots);
    }
    if (Array.isArray(payload?.errors) && payload.errors.length) {
      merged.errors.push(...payload.errors);
    }
  }

  for (const dayResult of dayResults) {
    if (dayResult.ok) continue;
    merged.errors.push({
      day: dayResult.day,
      error: dayResult.error?.message || "Failed to load RBN spots.",
    });
  }

  const normalized = normalizeSlotPayload(slotCall, days, merged);
  normalized.raw.ofUsSpots = normalized.raw.ofUsSpots.filter((spot) => Number.isFinite(spot.ts) && spot.ts >= cutoffTs);
  normalized.raw.byUsSpots = normalized.raw.byUsSpots.filter((spot) => Number.isFinite(spot.ts) && spot.ts >= cutoffTs);
  normalized.totalOfUs = normalized.raw.ofUsSpots.length;
  normalized.totalByUs = normalized.raw.byUsSpots.length;
  normalized.totalScanned = normalized.totalOfUs + normalized.totalByUs;
  return normalized;
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

async function runRbnLiveAnalysis(config) {
  const startedAt = Date.now();
  const liveWindow = resolveLiveWindow(config?.windowHours, startedAt);
  const activeSlots = buildSlotRequests(config);

  const promises = activeSlots.map(async (slot) => {
    const dayResults = await Promise.all(
      liveWindow.days.map(async (day) => {
        try {
          const payload = await fetchRbnSpots(slot.call, [day]);
          return { ok: true, day, payload };
        } catch (error) {
          return { ok: false, day, error };
        }
      }),
    );
    const hasSuccess = dayResults.some((entry) => entry.ok);
    if (!hasSuccess) {
      const firstError = dayResults.find((entry) => !entry.ok)?.error;
      const status = Number(firstError?.status) === 429 ? "qrx" : "error";
      return {
        id: slot.id,
        label: slot.label,
        status,
        call: slot.call,
        days: liveWindow.days,
        error: firstError?.message || "Failed to load RBN spots.",
        retryAfterMs: Number.isFinite(firstError?.retryAfterMs) ? Number(firstError.retryAfterMs) : 0,
        totalScanned: 0,
        totalOfUs: 0,
        totalByUs: 0,
        capPerSide: null,
        truncatedOfUs: false,
        truncatedByUs: false,
        notFound: false,
        errors: dayResults.map((entry) => ({
          day: entry.day,
          error: entry.error?.message || "Failed to load RBN spots.",
        })),
        raw: {
          ofUsSpots: [],
          byUsSpots: [],
        },
      };
    }

    const merged = buildLiveMergedPayload(slot.call, liveWindow.days, liveWindow.cutoffTs, dayResults);
    return {
      id: slot.id,
      label: slot.label,
      ...merged,
    };
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
    days: liveWindow.days,
    windowHours: liveWindow.windowHours,
    cutoffTs: liveWindow.cutoffTs,
    slots,
    hasAnyLoaded,
    hasAnyData,
    hasAnyFailure,
  };
}

export { runRbnAnalysis, runRbnLiveAnalysis, resolveLiveWindow, SLOT_META };
