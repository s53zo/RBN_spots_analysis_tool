import { normalizeCall } from "./rbn-normalize.mjs";

const CALLSIGN_PATTERN = /^[A-Z0-9/-]{3,20}$/;

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

export { CALLSIGN_PATTERN, normalizeInputModel, validateAnalysisInput };
