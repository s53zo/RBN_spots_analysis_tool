import { fetchRbnSpots } from "./rbn-api.mjs";
import { normalizeCall, normalizeRbnSpot, normalizeSelectedDays, normalizeSpotterBase } from "./rbn-normalize.mjs";
import { getCallGeoMeta } from "./cty-lookup.mjs";

const SLOT_META = [
  { id: "A", label: "Primary" },
  { id: "B", label: "Compare 1" },
  { id: "C", label: "Compare 2" },
  { id: "D", label: "Compare 3" },
];
const SKIMMER_ALLOWED_AREA_TYPES = new Set(["GLOBAL", "CONTINENT", "DXCC", "CQ", "ITU"]);

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

function buildUtcDaysFromTsRange(fromTs, toTs) {
  const startDayTs = utcDayStartTs(fromTs);
  const endDayTs = utcDayStartTs(toTs);
  const days = [];
  for (let dayTs = startDayTs; dayTs <= endDayTs; dayTs += 24 * 3600 * 1000) {
    const token = utcDayTokenFromTs(dayTs);
    if (token) days.push(token);
  }
  return days;
}

function resolveSkimmerWindow(fromTsInput, toTsInput, maxHours = 48) {
  const now = Date.now();
  const rawFrom = Number(fromTsInput);
  const rawTo = Number(toTsInput);
  let fromTs = Number.isFinite(rawFrom) ? rawFrom : now - 6 * 3600 * 1000;
  let toTs = Number.isFinite(rawTo) ? rawTo : now;
  if (toTs < fromTs) [fromTs, toTs] = [toTs, fromTs];

  const maxDurationMs = Math.max(1, Number(maxHours) || 48) * 3600 * 1000;
  if (toTs - fromTs > maxDurationMs) {
    toTs = fromTs + maxDurationMs;
  }

  return {
    fromTs,
    toTs,
    maxHours: Math.max(1, Number(maxHours) || 48),
    maxDurationMs,
    days: buildUtcDaysFromTsRange(fromTs, toTs),
  };
}

function normalizeSkimmerArea(areaTypeInput, areaValueInput) {
  const rawType = String(areaTypeInput || "GLOBAL").trim().toUpperCase();
  const type = SKIMMER_ALLOWED_AREA_TYPES.has(rawType) ? rawType : "GLOBAL";
  const rawValue = String(areaValueInput || "").trim();

  if (type === "CONTINENT") {
    const continent = rawValue.toUpperCase();
    return { type, value: continent, continent, dxcc: "", cqZone: null, ituZone: null };
  }
  if (type === "DXCC") {
    const dxcc = rawValue.toUpperCase();
    return { type, value: dxcc, continent: "", dxcc, cqZone: null, ituZone: null };
  }
  if (type === "CQ") {
    const zone = parseInt(rawValue, 10);
    return { type, value: Number.isFinite(zone) ? String(zone) : "", continent: "", dxcc: "", cqZone: zone, ituZone: null };
  }
  if (type === "ITU") {
    const zone = parseInt(rawValue, 10);
    return { type, value: Number.isFinite(zone) ? String(zone) : "", continent: "", dxcc: "", cqZone: null, ituZone: zone };
  }
  return { type: "GLOBAL", value: "", continent: "", dxcc: "", cqZone: null, ituZone: null };
}

function spotterMatchesSkimmerArea(spotter, area) {
  if (!spotter) return false;
  if (!area || area.type === "GLOBAL") return true;
  const meta = getCallGeoMeta(spotter, { strict: true });
  if (!meta.matched) return false;

  if (area.type === "CONTINENT") return meta.continent === area.continent;
  if (area.type === "DXCC") return String(meta.dxcc || "").trim().toUpperCase() === area.dxcc;
  if (area.type === "CQ") return Number(meta.cqZone) === Number(area.cqZone);
  if (area.type === "ITU") return Number(meta.ituZone) === Number(area.ituZone);
  return true;
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

function buildSkimmerMergedPayload(slotCall, window, area, dayResults) {
  const okResults = dayResults.filter((entry) => entry.ok).map((entry) => entry.payload);
  const merged = {
    call: slotCall,
    days: window.days,
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
    if (Array.isArray(payload?.ofUsSpots) && payload.ofUsSpots.length) merged.ofUsSpots.push(...payload.ofUsSpots);
    if (Array.isArray(payload?.byUsSpots) && payload.byUsSpots.length) merged.byUsSpots.push(...payload.byUsSpots);
    if (Array.isArray(payload?.errors) && payload.errors.length) merged.errors.push(...payload.errors);
  }

  for (const dayResult of dayResults) {
    if (dayResult.ok) continue;
    merged.errors.push({
      day: dayResult.day,
      error: dayResult.error?.message || "Failed to load RBN spots.",
    });
  }

  const normalized = normalizeSlotPayload(slotCall, window.days, merged);
  const inRange = (spot) => Number.isFinite(spot?.ts) && spot.ts >= window.fromTs && spot.ts <= window.toTs;
  normalized.raw.ofUsSpots = normalized.raw.ofUsSpots.filter((spot) => inRange(spot));
  normalized.raw.byUsSpots = normalized.raw.byUsSpots.filter((spot) => inRange(spot));

  // Skimmer comparison is based on what each input callsign spotted.
  // Remap byUs spots into comparison rows keyed by spotted callsign
  // so the existing chart pipeline can compare slot A/B/C/D on common targets.
  normalized.raw.ofUsSpots = normalized.raw.byUsSpots
    .map((spot) => {
      const target = normalizeSpotterBase(spot?.dxCall || "");
      if (!target) return null;
      return {
        ...spot,
        spotter: target,
        spotterRaw: target,
      };
    })
    .filter((spot) => Boolean(spot) && spotterMatchesSkimmerArea(spot.spotter, area));

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

async function runRbnSkimmerComparison(config) {
  const startedAt = Date.now();
  const window = resolveSkimmerWindow(config?.fromTsUtc, config?.toTsUtc, 48);
  const area = normalizeSkimmerArea(config?.areaType, config?.areaValue);
  const activeSlots = buildSlotRequests(config);

  const promises = activeSlots.map(async (slot) => {
    const dayResults = await Promise.all(
      window.days.map(async (day) => {
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
        days: window.days,
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

    const merged = buildSkimmerMergedPayload(slot.call, window, area, dayResults);
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
    days: window.days,
    fromTs: window.fromTs,
    toTs: window.toTs,
    areaType: area.type,
    areaValue: area.value,
    slots,
    hasAnyLoaded,
    hasAnyData,
    hasAnyFailure,
  };
}

export {
  runRbnAnalysis,
  runRbnLiveAnalysis,
  runRbnSkimmerComparison,
  resolveLiveWindow,
  resolveSkimmerWindow,
  normalizeSkimmerArea,
  SLOT_META,
};
