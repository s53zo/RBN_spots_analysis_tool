import { normalizeCall } from "./rbn-normalize.mjs";

const CALLSIGN_PATTERN = /^[A-Z0-9/-]{3,20}$/;
const LIVE_WINDOW_OPTIONS = new Set([1, 6, 12, 24, 48]);
const SKIMMER_AREA_TYPES = new Set(["GLOBAL", "CONTINENT", "DXCC", "CALLSIGN", "CQ", "ITU"]);
const SKIMMER_CONTINENTS = new Set(["NA", "SA", "EU", "AF", "AS", "OC"]);
const SKIMMER_MAX_WINDOW_HOURS = 48;

function normalizeInputModel(model) {
  const dates = (Array.isArray(model?.dates) ? model.dates : []).filter(Boolean);
  const primary = normalizeCall(model?.primary || "");
  const comparisons = (Array.isArray(model?.comparisons) ? model.comparisons : [])
    .map((call) => normalizeCall(call || ""))
    .filter(Boolean)
    .slice(0, 3);

  return { dates, primary, comparisons };
}

function validateAnalysisInput(model) {
  const input = normalizeInputModel(model);

  if (!input.dates.length) {
    return { ok: false, reason: "Pick at least one UTC date." };
  }

  if (input.dates.length > 2) {
    return { ok: false, reason: "A maximum of two dates is allowed." };
  }

  if (new Set(input.dates).size !== input.dates.length) {
    return { ok: false, reason: "Date 1 and Date 2 must be different." };
  }

  if (!input.primary) {
    return { ok: false, reason: "Enter your primary callsign." };
  }

  if (!CALLSIGN_PATTERN.test(input.primary)) {
    return { ok: false, reason: "Primary callsign format looks invalid." };
  }

  for (const compareCall of input.comparisons) {
    if (!CALLSIGN_PATTERN.test(compareCall)) {
      return { ok: false, reason: `Compare callsign ${compareCall} format looks invalid.` };
    }
  }

  const allCalls = [input.primary, ...input.comparisons];
  if (new Set(allCalls).size !== allCalls.length) {
    return { ok: false, reason: "Callsigns must be unique within one analysis run." };
  }

  return { ok: true, reason: "Ready to start analysis." };
}

function normalizeLiveInputModel(model) {
  const primary = normalizeCall(model?.primary || "");
  const comparisons = (Array.isArray(model?.comparisons) ? model.comparisons : [])
    .map((call) => normalizeCall(call || ""))
    .filter(Boolean)
    .slice(0, 3);
  const windowHours = Number(model?.windowHours ?? 24);

  return { primary, comparisons, windowHours };
}

function validateLiveInput(model) {
  const input = normalizeLiveInputModel(model);

  if (!input.primary) {
    return { ok: false, reason: "Enter your primary callsign." };
  }

  if (!CALLSIGN_PATTERN.test(input.primary)) {
    return { ok: false, reason: "Primary callsign format looks invalid." };
  }

  for (const compareCall of input.comparisons) {
    if (!CALLSIGN_PATTERN.test(compareCall)) {
      return { ok: false, reason: `Compare callsign ${compareCall} format looks invalid.` };
    }
  }

  const allCalls = [input.primary, ...input.comparisons];
  if (new Set(allCalls).size !== allCalls.length) {
    return { ok: false, reason: "Callsigns must be unique within one analysis run." };
  }

  if (!LIVE_WINDOW_OPTIONS.has(input.windowHours)) {
    return { ok: false, reason: "Live window must be one of 1h, 6h, 12h, 24h, or 48h." };
  }

  return { ok: true, reason: "Ready to start live analysis." };
}

function normalizeSkimmerInputModel(model) {
  const primary = normalizeCall(model?.primary || "");
  const comparisons = (Array.isArray(model?.comparisons) ? model.comparisons : [])
    .map((call) => normalizeCall(call || ""))
    .filter(Boolean)
    .slice(0, 3);
  const fromTsUtc = Number(model?.fromTsUtc);
  const toTsUtc = Number(model?.toTsUtc);
  const areaType = String(model?.areaType || "GLOBAL").trim().toUpperCase();
  const rawAreaValue = String(model?.areaValue || "").trim();

  let areaValue = rawAreaValue;
  if (areaType === "CONTINENT") {
    areaValue = rawAreaValue.toUpperCase();
  } else if (areaType === "CALLSIGN") {
    areaValue = normalizeCall(rawAreaValue);
  } else if (areaType === "CQ" || areaType === "ITU") {
    const parsed = parseInt(rawAreaValue, 10);
    areaValue = Number.isFinite(parsed) ? String(parsed) : rawAreaValue;
  }

  return {
    primary,
    comparisons,
    fromTsUtc,
    toTsUtc,
    areaType,
    areaValue,
  };
}

function validateSkimmerInput(model) {
  const input = normalizeSkimmerInputModel(model);

  if (!input.primary) {
    return { ok: false, reason: "Enter your primary callsign." };
  }
  if (!CALLSIGN_PATTERN.test(input.primary)) {
    return { ok: false, reason: "Primary callsign format looks invalid." };
  }
  for (const compareCall of input.comparisons) {
    if (!CALLSIGN_PATTERN.test(compareCall)) {
      return { ok: false, reason: `Compare callsign ${compareCall} format looks invalid.` };
    }
  }
  const allCalls = [input.primary, ...input.comparisons];
  if (new Set(allCalls).size !== allCalls.length) {
    return { ok: false, reason: "Callsigns must be unique within one analysis run." };
  }

  if (!Number.isFinite(input.fromTsUtc) || !Number.isFinite(input.toTsUtc)) {
    return { ok: false, reason: "Pick both UTC start and end timestamps." };
  }
  const durationMs = input.toTsUtc - input.fromTsUtc;
  if (durationMs <= 0) {
    return { ok: false, reason: "UTC end must be later than UTC start." };
  }
  const maxDurationMs = SKIMMER_MAX_WINDOW_HOURS * 3600 * 1000;
  if (durationMs > maxDurationMs) {
    return { ok: false, reason: "Maximum Skimmer comparison range is 48 hours." };
  }

  if (!SKIMMER_AREA_TYPES.has(input.areaType)) {
    return { ok: false, reason: "Skimmer area type is invalid." };
  }
  if (input.areaType === "GLOBAL") {
    return { ok: true, reason: "Ready to start skimmer comparison." };
  }

  if (!input.areaValue) {
    return { ok: false, reason: "Enter a skimmer area value for the selected filter type." };
  }
  if (input.areaType === "CONTINENT" && !SKIMMER_CONTINENTS.has(input.areaValue)) {
    return { ok: false, reason: "Continent must be one of NA, SA, EU, AF, AS, or OC." };
  }
  if (input.areaType === "CQ" || input.areaType === "ITU") {
    const zone = Number(input.areaValue);
    if (!Number.isInteger(zone) || zone < 1 || zone > 90) {
      return { ok: false, reason: `${input.areaType} zone must be an integer between 1 and 90.` };
    }
  }
  if (input.areaType === "DXCC" && input.areaValue.length < 1) {
    return { ok: false, reason: "DXCC filter must include a prefix or DXCC name." };
  }
  if (input.areaType === "CALLSIGN" && !CALLSIGN_PATTERN.test(input.areaValue)) {
    return { ok: false, reason: "CALLSIGN filter must be a valid callsign." };
  }

  return { ok: true, reason: "Ready to start skimmer comparison." };
}

export {
  CALLSIGN_PATTERN,
  LIVE_WINDOW_OPTIONS,
  SKIMMER_AREA_TYPES,
  SKIMMER_CONTINENTS,
  SKIMMER_MAX_WINDOW_HOURS,
  normalizeInputModel,
  validateAnalysisInput,
  normalizeLiveInputModel,
  validateLiveInput,
  normalizeSkimmerInputModel,
  validateSkimmerInput,
};
