import { runRbnAnalysis, runRbnLiveAnalysis, runRbnSkimmerComparison } from "./src/rbn-orchestrator.mjs";
import { normalizeBandToken, normalizeCall } from "./src/rbn-normalize.mjs";
import {
  CALLSIGN_PATTERN,
  LIVE_WINDOW_OPTIONS,
  SKIMMER_AREA_TYPES,
  SKIMMER_CONTINENTS,
  SKIMMER_MAX_WINDOW_HOURS,
  validateAnalysisInput,
  validateLiveInput,
  validateSkimmerInput,
} from "./src/input-validation.mjs";
import { preloadCtyData, resolveDxccFromInput } from "./src/cty-lookup.mjs";
import {
  CONTINENT_ORDER,
  continentLabel,
  continentSort,
  formatBandLabel,
  sortBands,
  getOrBuildSlotIndex,
  getOrBuildRanking,
  getOrBuildRankingByP75,
  sampleFlatStrideSeeded,
  computeProportionalCaps,
} from "./src/rbn-compare-index.mjs";
import { bandColorForChart, drawRbnSignalCanvas, slotLineDash, slotMarkerShape } from "./src/rbn-canvas.mjs";

const state = {
  activeChapter: "historical",
  status: "idle",
  dates: [],
  slots: {
    A: { call: "" },
    B: { call: "" },
    C: { call: "" },
    D: { call: "" },
  },
  activeRunToken: 0,
  analysis: null,
  retry: {
    timer: 0,
    untilTs: 0,
    status: "ready",
    baseMessage: "",
    attempts: 0,
    maxAttempts: 3,
    model: null,
  },
  datePickers: {
    primary: null,
    secondary: null,
    skimmerFrom: null,
    skimmerTo: null,
  },
  chart: {
    selectedBands: [],
    selectedByContinent: {},
    zoomByContinent: {},
    drawRaf: 0,
    resizeObserver: null,
    intersectionObserver: null,
  },
};

const liveState = {
  status: "idle",
  windowHours: 24,
  slots: {
    A: { call: "" },
    B: { call: "" },
    C: { call: "" },
    D: { call: "" },
  },
  activeRunToken: 0,
  analysis: null,
  chart: {
    selectedBands: [],
    selectedByContinent: {},
    zoomByContinent: {},
    drawRaf: 0,
    resizeObserver: null,
    intersectionObserver: null,
  },
  refresh: {
    timer: 0,
    intervalMs: 5 * 60 * 1000,
    inFlight: false,
    lastModel: null,
  },
  retry: {
    timer: 0,
    untilTs: 0,
    attempts: 0,
    maxAttempts: 3,
    model: null,
  },
};

const skimmerState = {
  status: "idle",
  fromTsUtc: 0,
  toTsUtc: 0,
  areaType: "GLOBAL",
  areaValue: "",
  slots: {
    A: { call: "" },
    B: { call: "" },
    C: { call: "" },
    D: { call: "" },
  },
  activeRunToken: 0,
  analysis: null,
  chart: {
    selectedBands: [],
    selectedByContinent: {},
    zoomByContinent: {},
    drawRaf: 0,
    resizeObserver: null,
    intersectionObserver: null,
  },
  retry: {
    timer: 0,
    untilTs: 0,
    attempts: 0,
    maxAttempts: 3,
    model: null,
  },
  validation: {
    showErrors: false,
  },
};

const ui = {
  chapterTabs: Array.from(document.querySelectorAll("[data-chapter-tab]")),
  chapterHistorical: document.querySelector("#chapter-historical"),
  chapterLive: document.querySelector("#chapter-live"),
  chapterSkimmer: document.querySelector("#chapter-skimmer"),
  form: document.querySelector("#analysis-form"),
  liveForm: document.querySelector("#live-analysis-form"),
  skimmerForm: document.querySelector("#skimmer-analysis-form"),
  datePrimary: document.querySelector("#date-primary"),
  dateSecondary: document.querySelector("#date-secondary"),
  callPrimary: document.querySelector("#call-primary"),
  callCompare1: document.querySelector("#call-compare-1"),
  callCompare2: document.querySelector("#call-compare-2"),
  callCompare3: document.querySelector("#call-compare-3"),
  liveWindow: document.querySelector("#live-window"),
  skimmerFrom: document.querySelector("#skimmer-from"),
  skimmerTo: document.querySelector("#skimmer-to"),
  skimmerAreaType: document.querySelector("#skimmer-area-type"),
  skimmerAreaValue: document.querySelector("#skimmer-area-value"),
  skimmerCallPrimary: document.querySelector("#skimmer-call-primary"),
  skimmerCallCompare1: document.querySelector("#skimmer-call-compare-1"),
  skimmerCallCompare2: document.querySelector("#skimmer-call-compare-2"),
  skimmerCallCompare3: document.querySelector("#skimmer-call-compare-3"),
  liveCallPrimary: document.querySelector("#live-call-primary"),
  liveCallCompare1: document.querySelector("#live-call-compare-1"),
  liveCallCompare2: document.querySelector("#live-call-compare-2"),
  liveCallCompare3: document.querySelector("#live-call-compare-3"),
  startButton: document.querySelector("#start-analysis"),
  liveStartButton: document.querySelector("#start-live-analysis"),
  skimmerStartButton: document.querySelector("#start-skimmer-analysis"),
  statusPill: document.querySelector("#status-pill"),
  statusMessage: document.querySelector("#status-message"),
  checkFetch: document.querySelector("#check-fetch"),
  checkCty: document.querySelector("#check-cty"),
  checkCharts: document.querySelector("#check-charts"),
  chartsNote: document.querySelector("#charts-note"),
  chartsRoot: document.querySelector("#charts-root"),
  liveStatusPill: document.querySelector("#live-status-pill"),
  liveStatusMessage: document.querySelector("#live-status-message"),
  skimmerStatusPill: document.querySelector("#skimmer-status-pill"),
  skimmerStatusMessage: document.querySelector("#skimmer-status-message"),
  liveCheckFetch: document.querySelector("#live-check-fetch"),
  liveCheckCty: document.querySelector("#live-check-cty"),
  liveCheckCharts: document.querySelector("#live-check-charts"),
  skimmerCheckFetch: document.querySelector("#skimmer-check-fetch"),
  skimmerCheckCty: document.querySelector("#skimmer-check-cty"),
  skimmerCheckCharts: document.querySelector("#skimmer-check-charts"),
  liveChartsNote: document.querySelector("#live-charts-note"),
  liveChartsRoot: document.querySelector("#live-charts-root"),
  skimmerChartsNote: document.querySelector("#skimmer-charts-note"),
  skimmerChartsRoot: document.querySelector("#skimmer-charts-root"),
  skimmerValidationSummary: document.querySelector("#skimmer-validation-summary"),
  skimmerValidationList: document.querySelector("#skimmer-validation-list"),
  skimmerHelpAreaValue: document.querySelector("#skimmer-help-area-value"),
  skimmerErrorFrom: document.querySelector("#skimmer-error-from"),
  skimmerErrorTo: document.querySelector("#skimmer-error-to"),
  skimmerErrorAreaType: document.querySelector("#skimmer-error-area-type"),
  skimmerErrorAreaValue: document.querySelector("#skimmer-error-area-value"),
  skimmerErrorCallPrimary: document.querySelector("#skimmer-error-call-primary"),
  skimmerErrorCallCompare1: document.querySelector("#skimmer-error-call-compare-1"),
  skimmerErrorCallCompare2: document.querySelector("#skimmer-error-call-compare-2"),
  skimmerErrorCallCompare3: document.querySelector("#skimmer-error-call-compare-3"),
};

let html2CanvasLoadPromise = null;
const TAB_NAV_KEYS = new Set(["ArrowRight", "ArrowLeft", "Home", "End"]);
const CHART_PLOT_MARGIN = Object.freeze({ left: 52, right: 12, top: 16, bottom: 26 });
const MIN_ZOOM_DRAG_PX = 8;
const MIN_ZOOM_WINDOW_MS = 60 * 1000;

function setActiveChapter(chapter) {
  const normalized = chapter === "live" || chapter === "skimmer" ? chapter : "historical";
  state.activeChapter = normalized;

  for (const tab of ui.chapterTabs) {
    const isActive = tab.dataset.chapterTab === normalized;
    tab.classList.toggle("is-active", isActive);
    tab.setAttribute("aria-selected", isActive ? "true" : "false");
    tab.tabIndex = isActive ? 0 : -1;
  }

  if (ui.chapterHistorical) ui.chapterHistorical.hidden = normalized !== "historical";
  if (ui.chapterLive) ui.chapterLive.hidden = normalized !== "live";
  if (ui.chapterSkimmer) ui.chapterSkimmer.hidden = normalized !== "skimmer";
  syncLiveRefreshTimer();
}

function trackCallsignEntryEvents(model) {
  const gtagFn = globalThis?.gtag;
  if (typeof gtagFn !== "function" || !model) return;

  const entries = [
    { slot: "primary", callsign: model.primary },
    ...model.comparisons.map((callsign, index) => ({ slot: `compare_${index + 1}`, callsign })),
  ].filter((entry) => entry.callsign);

  for (const entry of entries) {
    gtagFn("event", "callsign_entry", {
      callsign_slot: entry.slot,
      callsign: entry.callsign,
      value: 1,
    });
  }
}

function trackLiveRefreshEvent(eventName, fields = {}) {
  const gtagFn = globalThis?.gtag;
  if (typeof gtagFn !== "function") return;
  gtagFn("event", eventName, fields);
}

function formatNumber(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return String(value || 0);
  return num.toLocaleString("en-US");
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function slotTitle(slot) {
  if (slot.id === "A") return "Primary";
  if (slot.id === "B") return "Compare 1";
  if (slot.id === "C") return "Compare 2";
  if (slot.id === "D") return "Compare 3";
  return slot.id;
}

function slotMarkerSymbol(slotId) {
  const shape = slotMarkerShape(slotId);
  if (shape === "triangle") return "▲";
  if (shape === "square") return "■";
  if (shape === "diamond") return "◆";
  return "●";
}

function slotLineSample(slotId) {
  const dash = slotLineDash(slotId);
  if (!dash.length) return "────";
  if (dash[0] === 8) return "- - -";
  if (dash[0] === 2) return "· · ·";
  return "- · -";
}

function parseDateInputToIso(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  let year = "";
  let month = "";
  let day = "";
  let match = raw.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (match) {
    day = match[1];
    month = match[2];
    year = match[3];
  } else {
    match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return "";
    year = match[1];
    month = match[2];
    day = match[3];
  }

  const iso = `${year}-${month}-${day}`;
  const date = new Date(`${iso}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) return "";
  const normalized = date.toISOString().slice(0, 10);
  return normalized === iso ? iso : "";
}

function formatIsoToDisplay(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ""))) return "";
  const [year, month, day] = String(iso).split("-");
  return `${day}-${month}-${year}`;
}

function parseDateTimeInputToUtcTs(value) {
  const raw = String(value || "").trim();
  if (!raw) return NaN;

  let year = "";
  let month = "";
  let day = "";
  let hour = "00";
  let minute = "00";

  let match = raw.match(/^(\d{2})-(\d{2})-(\d{4})(?:\s+(\d{2}):(\d{2}))?$/);
  if (match) {
    day = match[1];
    month = match[2];
    year = match[3];
    if (match[4] != null) hour = match[4];
    if (match[5] != null) minute = match[5];
  } else {
    match = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2}))?$/);
    if (!match) return NaN;
    year = match[1];
    month = match[2];
    day = match[3];
    if (match[4] != null) hour = match[4];
    if (match[5] != null) minute = match[5];
  }

  const y = Number(year);
  const mo = Number(month);
  const d = Number(day);
  const h = Number(hour);
  const mi = Number(minute);
  if (!Number.isInteger(y) || !Number.isInteger(mo) || !Number.isInteger(d) || !Number.isInteger(h) || !Number.isInteger(mi)) {
    return NaN;
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h < 0 || h > 23 || mi < 0 || mi > 59) return NaN;

  const ts = Date.UTC(y, mo - 1, d, h, mi, 0, 0);
  if (!Number.isFinite(ts)) return NaN;
  const check = new Date(ts);
  if (
    check.getUTCFullYear() !== y ||
    check.getUTCMonth() !== mo - 1 ||
    check.getUTCDate() !== d ||
    check.getUTCHours() !== h ||
    check.getUTCMinutes() !== mi
  ) {
    return NaN;
  }
  return ts;
}

function formatUtcTsToDateTimeDisplay(ts) {
  if (!Number.isFinite(ts)) return "";
  const d = new Date(ts);
  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const year = String(d.getUTCFullYear());
  const hour = String(d.getUTCHours()).padStart(2, "0");
  const minute = String(d.getUTCMinutes()).padStart(2, "0");
  return `${day}-${month}-${year} ${hour}:${minute}`;
}

function setFieldValidationState(field, invalid, statusId) {
  if (!field) return;
  field.setAttribute("aria-invalid", invalid ? "true" : "false");
  if (statusId) field.setAttribute("aria-describedby", statusId);
}

function annotateAllFieldValidity(fields, invalidIds, statusId) {
  const invalid = invalidIds instanceof Set ? invalidIds : new Set();
  for (const entry of fields) {
    setFieldValidationState(entry?.node, invalid.has(entry?.id), statusId);
  }
}

function getDuplicateCallsByField(entries) {
  const counts = new Map();
  for (const entry of entries) {
    if (!entry?.call) continue;
    counts.set(entry.call, (counts.get(entry.call) || 0) + 1);
  }

  const duplicateFieldIds = new Set();
  for (const entry of entries) {
    if (!entry?.call) continue;
    if ((counts.get(entry.call) || 0) > 1) duplicateFieldIds.add(entry.fieldId);
  }
  return duplicateFieldIds;
}

function collectAnalysisInvalidFields(model) {
  const invalid = new Set();
  const primaryRaw = String(ui.datePrimary?.value || "").trim();
  const secondaryRaw = String(ui.dateSecondary?.value || "").trim();
  const primaryIso = parseDateInputToIso(primaryRaw);
  const secondaryIso = parseDateInputToIso(secondaryRaw);

  if (!primaryIso) invalid.add("datePrimary");
  if (secondaryRaw && !secondaryIso) invalid.add("dateSecondary");
  if (primaryIso && secondaryIso && primaryIso === secondaryIso) {
    invalid.add("datePrimary");
    invalid.add("dateSecondary");
  }

  const calls = [
    { fieldId: "callPrimary", call: normalizeCall(ui.callPrimary?.value) },
    { fieldId: "callCompare1", call: normalizeCall(ui.callCompare1?.value) },
    { fieldId: "callCompare2", call: normalizeCall(ui.callCompare2?.value) },
    { fieldId: "callCompare3", call: normalizeCall(ui.callCompare3?.value) },
  ];
  if (!model.primary || !CALLSIGN_PATTERN.test(model.primary)) invalid.add("callPrimary");
  for (const entry of calls.slice(1)) {
    if (!entry.call) continue;
    if (!CALLSIGN_PATTERN.test(entry.call)) invalid.add(entry.fieldId);
  }
  for (const fieldId of getDuplicateCallsByField(calls.filter((entry) => entry.call))) {
    invalid.add(fieldId);
  }

  return invalid;
}

function collectLiveInvalidFields(model) {
  const invalid = new Set();
  const calls = [
    { fieldId: "liveCallPrimary", call: normalizeCall(ui.liveCallPrimary?.value) },
    { fieldId: "liveCallCompare1", call: normalizeCall(ui.liveCallCompare1?.value) },
    { fieldId: "liveCallCompare2", call: normalizeCall(ui.liveCallCompare2?.value) },
    { fieldId: "liveCallCompare3", call: normalizeCall(ui.liveCallCompare3?.value) },
  ];

  if (!model.primary || !CALLSIGN_PATTERN.test(model.primary)) invalid.add("liveCallPrimary");
  for (const entry of calls.slice(1)) {
    if (!entry.call) continue;
    if (!CALLSIGN_PATTERN.test(entry.call)) invalid.add(entry.fieldId);
  }
  for (const fieldId of getDuplicateCallsByField(calls.filter((entry) => entry.call))) {
    invalid.add(fieldId);
  }
  if (!LIVE_WINDOW_OPTIONS.has(Number(model.windowHours))) invalid.add("liveWindow");

  return invalid;
}

function collectSkimmerInvalidFields(model) {
  const invalid = new Set();
  const fromRaw = String(ui.skimmerFrom?.value || "").trim();
  const toRaw = String(ui.skimmerTo?.value || "").trim();
  const fromTs = parseDateTimeInputToUtcTs(fromRaw);
  const toTs = parseDateTimeInputToUtcTs(toRaw);

  if (!Number.isFinite(fromTs)) invalid.add("skimmerFrom");
  if (!Number.isFinite(toTs)) invalid.add("skimmerTo");
  if (Number.isFinite(fromTs) && Number.isFinite(toTs)) {
    if (toTs <= fromTs) {
      invalid.add("skimmerFrom");
      invalid.add("skimmerTo");
    }
    if (toTs - fromTs > SKIMMER_MAX_WINDOW_HOURS * 3600 * 1000) {
      invalid.add("skimmerFrom");
      invalid.add("skimmerTo");
    }
  }

  if (!SKIMMER_AREA_TYPES.has(String(model.areaType || "").toUpperCase())) {
    invalid.add("skimmerAreaType");
  }
  if (model.areaType !== "GLOBAL") {
    const areaValue = String(model.areaValue || "").trim();
    if (!areaValue) {
      invalid.add("skimmerAreaValue");
    } else if (model.areaType === "CONTINENT" && !SKIMMER_CONTINENTS.has(areaValue.toUpperCase())) {
      invalid.add("skimmerAreaValue");
    } else if (model.areaType === "CALLSIGN" && !CALLSIGN_PATTERN.test(normalizeCall(areaValue))) {
      invalid.add("skimmerAreaValue");
    } else if (model.areaType === "CQ" || model.areaType === "ITU") {
      const zone = Number(areaValue);
      if (!Number.isInteger(zone) || zone < 1 || zone > 90) invalid.add("skimmerAreaValue");
    }
  }

  const calls = [
    { fieldId: "skimmerCallPrimary", call: normalizeCall(ui.skimmerCallPrimary?.value) },
    { fieldId: "skimmerCallCompare1", call: normalizeCall(ui.skimmerCallCompare1?.value) },
    { fieldId: "skimmerCallCompare2", call: normalizeCall(ui.skimmerCallCompare2?.value) },
    { fieldId: "skimmerCallCompare3", call: normalizeCall(ui.skimmerCallCompare3?.value) },
  ];
  if (!model.primary || !CALLSIGN_PATTERN.test(model.primary)) invalid.add("skimmerCallPrimary");
  for (const entry of calls.slice(1)) {
    if (!entry.call) continue;
    if (!CALLSIGN_PATTERN.test(entry.call)) invalid.add(entry.fieldId);
  }
  for (const fieldId of getDuplicateCallsByField(calls.filter((entry) => entry.call))) {
    invalid.add(fieldId);
  }

  return invalid;
}

function updateAnalysisFieldValidity(model) {
  const invalid = collectAnalysisInvalidFields(model);
  annotateAllFieldValidity(
    [
      { id: "datePrimary", node: ui.datePrimary },
      { id: "dateSecondary", node: ui.dateSecondary },
      { id: "callPrimary", node: ui.callPrimary },
      { id: "callCompare1", node: ui.callCompare1 },
      { id: "callCompare2", node: ui.callCompare2 },
      { id: "callCompare3", node: ui.callCompare3 },
    ],
    invalid,
    "status-message",
  );
}

function updateLiveFieldValidity(model) {
  const invalid = collectLiveInvalidFields(model);
  annotateAllFieldValidity(
    [
      { id: "liveWindow", node: ui.liveWindow },
      { id: "liveCallPrimary", node: ui.liveCallPrimary },
      { id: "liveCallCompare1", node: ui.liveCallCompare1 },
      { id: "liveCallCompare2", node: ui.liveCallCompare2 },
      { id: "liveCallCompare3", node: ui.liveCallCompare3 },
    ],
    invalid,
    "live-status-message",
  );
}

function buildSkimmerValidationReport(model) {
  const invalid = collectSkimmerInvalidFields(model);
  const fieldErrors = new Map();
  const addError = (fieldId, message) => {
    if (!invalid.has(fieldId) || !message) return;
    if (!fieldErrors.has(fieldId)) fieldErrors.set(fieldId, message);
  };

  const fromRaw = String(ui.skimmerFrom?.value || "").trim();
  const toRaw = String(ui.skimmerTo?.value || "").trim();
  const fromTs = parseDateTimeInputToUtcTs(fromRaw);
  const toTs = parseDateTimeInputToUtcTs(toRaw);
  const areaType = String(model?.areaType || "GLOBAL").toUpperCase();
  const areaValue = String(model?.areaValue || "").trim();

  if (!fromRaw) addError("skimmerFrom", "UTC start time is required.");
  else if (!Number.isFinite(fromTs)) addError("skimmerFrom", "Use DD-MM-YYYY HH:MM format (UTC).");

  if (!toRaw) addError("skimmerTo", "UTC end time is required.");
  else if (!Number.isFinite(toTs)) addError("skimmerTo", "Use DD-MM-YYYY HH:MM format (UTC).");

  if (Number.isFinite(fromTs) && Number.isFinite(toTs) && toTs <= fromTs) {
    addError("skimmerFrom", "Start must be earlier than end.");
    addError("skimmerTo", "End must be later than start.");
  }

  if (Number.isFinite(fromTs) && Number.isFinite(toTs) && toTs - fromTs > SKIMMER_MAX_WINDOW_HOURS * 3600 * 1000) {
    addError("skimmerFrom", "Maximum range is 48 hours.");
    addError("skimmerTo", "Maximum range is 48 hours.");
  }

  if (!SKIMMER_AREA_TYPES.has(areaType)) {
    addError("skimmerAreaType", "Choose a valid scope type.");
  }
  if (areaType !== "GLOBAL") {
    if (!areaValue) {
      addError("skimmerAreaValue", "Scope value is required for this scope type.");
    } else if (areaType === "CONTINENT" && !SKIMMER_CONTINENTS.has(areaValue.toUpperCase())) {
      addError("skimmerAreaValue", "Continent must be one of NA, SA, EU, AF, AS, OC.");
    } else if (areaType === "CALLSIGN" && !CALLSIGN_PATTERN.test(normalizeCall(areaValue))) {
      addError("skimmerAreaValue", "Use a valid callsign (3-20 chars, A-Z, 0-9, / or -).");
    } else if (areaType === "CQ" || areaType === "ITU") {
      const zone = Number(areaValue);
      if (!Number.isInteger(zone) || zone < 1 || zone > 90) addError("skimmerAreaValue", "Zone must be an integer between 1 and 90.");
    }
  }

  if (!model.primary) {
    addError("skimmerCallPrimary", "Skimmer callsign 1 is required.");
  } else if (!CALLSIGN_PATTERN.test(model.primary)) {
    addError("skimmerCallPrimary", "Use 3-20 characters: A-Z, 0-9, / or -.");
  }

  const compareCalls = [
    { fieldId: "skimmerCallCompare1", call: normalizeCall(ui.skimmerCallCompare1?.value) },
    { fieldId: "skimmerCallCompare2", call: normalizeCall(ui.skimmerCallCompare2?.value) },
    { fieldId: "skimmerCallCompare3", call: normalizeCall(ui.skimmerCallCompare3?.value) },
  ];
  for (const item of compareCalls) {
    if (!item.call) continue;
    if (!CALLSIGN_PATTERN.test(item.call)) {
      addError(item.fieldId, "Use 3-20 characters: A-Z, 0-9, / or -.");
    }
  }

  const duplicateFields = getDuplicateCallsByField(
    [
      { fieldId: "skimmerCallPrimary", call: normalizeCall(ui.skimmerCallPrimary?.value) },
      ...compareCalls,
    ].filter((entry) => entry.call),
  );
  for (const fieldId of duplicateFields) {
    addError(fieldId, "Callsigns must be unique.");
  }

  const summaryOrder = [
    "skimmerCallPrimary",
    "skimmerCallCompare1",
    "skimmerCallCompare2",
    "skimmerCallCompare3",
    "skimmerFrom",
    "skimmerTo",
    "skimmerAreaType",
    "skimmerAreaValue",
  ];
  const summaryLabels = {
    skimmerCallPrimary: "Skimmer callsign 1",
    skimmerCallCompare1: "Skimmer callsign 2",
    skimmerCallCompare2: "Skimmer callsign 3",
    skimmerCallCompare3: "Skimmer callsign 4",
    skimmerFrom: "UTC from",
    skimmerTo: "UTC to",
    skimmerAreaType: "Skimmer scope type",
    skimmerAreaValue: "Scope value",
  };
  const summary = summaryOrder
    .filter((fieldId) => fieldErrors.has(fieldId))
    .map((fieldId) => ({
      fieldId,
      text: `${summaryLabels[fieldId]}: ${fieldErrors.get(fieldId)}`,
    }));

  return { invalid, fieldErrors, summary };
}

function setSkimmerFieldError(fieldKey, message, options = {}) {
  const { showFeedback = false } = options;
  const nodeMap = {
    skimmerFrom: ui.skimmerErrorFrom,
    skimmerTo: ui.skimmerErrorTo,
    skimmerAreaType: ui.skimmerErrorAreaType,
    skimmerAreaValue: ui.skimmerErrorAreaValue,
    skimmerCallPrimary: ui.skimmerErrorCallPrimary,
    skimmerCallCompare1: ui.skimmerErrorCallCompare1,
    skimmerCallCompare2: ui.skimmerErrorCallCompare2,
    skimmerCallCompare3: ui.skimmerErrorCallCompare3,
  };
  const errorNode = nodeMap[fieldKey];
  if (!errorNode) return;
  const show = showFeedback && Boolean(message);
  errorNode.hidden = !show;
  errorNode.textContent = show ? String(message) : "";
}

function updateSkimmerFieldValidity(model, options = {}) {
  const { showFeedback = false } = options;
  const report = buildSkimmerValidationReport(model);

  const fields = [
    { id: "skimmerFrom", node: ui.skimmerFrom, helpId: "skimmer-help-from", errorId: "skimmer-error-from" },
    { id: "skimmerTo", node: ui.skimmerTo, helpId: "skimmer-help-to", errorId: "skimmer-error-to" },
    { id: "skimmerAreaType", node: ui.skimmerAreaType, helpId: "skimmer-help-area-type", errorId: "skimmer-error-area-type" },
    { id: "skimmerAreaValue", node: ui.skimmerAreaValue, helpId: "skimmer-help-area-value", errorId: "skimmer-error-area-value" },
    { id: "skimmerCallPrimary", node: ui.skimmerCallPrimary, helpId: "skimmer-help-call-primary", errorId: "skimmer-error-call-primary" },
    { id: "skimmerCallCompare1", node: ui.skimmerCallCompare1, helpId: "skimmer-help-call-compare-1", errorId: "skimmer-error-call-compare-1" },
    { id: "skimmerCallCompare2", node: ui.skimmerCallCompare2, helpId: "skimmer-help-call-compare-2", errorId: "skimmer-error-call-compare-2" },
    { id: "skimmerCallCompare3", node: ui.skimmerCallCompare3, helpId: "skimmer-help-call-compare-3", errorId: "skimmer-error-call-compare-3" },
  ];

  for (const field of fields) {
    if (!field.node) continue;
    const invalid = report.invalid.has(field.id);
    field.node.setAttribute("aria-invalid", invalid ? "true" : "false");
    field.node.setAttribute(
      "aria-describedby",
      [field.helpId, field.errorId].filter(Boolean).join(" "),
    );
    setSkimmerFieldError(field.id, report.fieldErrors.get(field.id), { showFeedback });
  }

  if (ui.skimmerValidationSummary && ui.skimmerValidationList) {
    const showSummary = showFeedback && report.summary.length > 0;
    ui.skimmerValidationSummary.hidden = !showSummary;
    if (showSummary) {
      ui.skimmerValidationList.innerHTML = report.summary
        .map(
          (item) =>
            `<li><button type="button" data-focus-field="${escapeHtml(item.fieldId)}">${escapeHtml(item.text)}</button></li>`,
        )
        .join("");
    } else {
      ui.skimmerValidationList.innerHTML = "";
    }
  }

  return report;
}

function collectInputModel() {
  const dates = [parseDateInputToIso(ui.datePrimary?.value), parseDateInputToIso(ui.dateSecondary?.value)].filter(Boolean);
  const calls = [
    normalizeCall(ui.callPrimary?.value),
    normalizeCall(ui.callCompare1?.value),
    normalizeCall(ui.callCompare2?.value),
    normalizeCall(ui.callCompare3?.value),
  ];

  return {
    dates,
    primary: calls[0],
    comparisons: calls.slice(1).filter(Boolean),
  };
}

function collectLiveInputModel() {
  const calls = [
    normalizeCall(ui.liveCallPrimary?.value),
    normalizeCall(ui.liveCallCompare1?.value),
    normalizeCall(ui.liveCallCompare2?.value),
    normalizeCall(ui.liveCallCompare3?.value),
  ];
  const windowHours = Number(ui.liveWindow?.value || 24);
  return {
    windowHours,
    primary: calls[0],
    comparisons: calls.slice(1).filter(Boolean),
  };
}

function collectSkimmerInputModel() {
  const calls = [
    normalizeCall(ui.skimmerCallPrimary?.value),
    normalizeCall(ui.skimmerCallCompare1?.value),
    normalizeCall(ui.skimmerCallCompare2?.value),
    normalizeCall(ui.skimmerCallCompare3?.value),
  ];
  const fromTsUtc = parseDateTimeInputToUtcTs(ui.skimmerFrom?.value);
  const toTsUtc = parseDateTimeInputToUtcTs(ui.skimmerTo?.value);
  const areaType = String(ui.skimmerAreaType?.value || "GLOBAL").trim().toUpperCase();
  const areaValue = String(ui.skimmerAreaValue?.value || "").trim();

  return {
    fromTsUtc,
    toTsUtc,
    areaType,
    areaValue,
    primary: calls[0],
    comparisons: calls.slice(1).filter(Boolean),
  };
}

function skimmerAreaPlaceholder(areaType) {
  if (areaType === "CONTINENT") return "NA, SA, EU, AF, AS, OC";
  if (areaType === "DXCC") return "e.g. DL, G, JA, JH or DXCC name";
  if (areaType === "CALLSIGN") return "e.g. S53ZO";
  if (areaType === "CQ") return "e.g. 14";
  if (areaType === "ITU") return "e.g. 28";
  return "Not required for Global";
}

function skimmerAreaValueHelpText(areaType) {
  if (areaType === "DXCC") return "DXCC examples: JA, DL, W, or country name.";
  if (areaType === "CONTINENT") return "Continent examples: EU, NA, AS, SA, AF, OC.";
  if (areaType === "CALLSIGN") return "Callsign example: S53ZO (exact target-station filter).";
  if (areaType === "CQ") return "Enter CQ zone number (1-90).";
  if (areaType === "ITU") return "Enter ITU zone number (1-90).";
  return "Global selected: scope value is not required.";
}

function addUtcDay(isoDate, daysToAdd = 1) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(isoDate || ""))) return "";
  const date = new Date(`${isoDate}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) return "";
  date.setUTCDate(date.getUTCDate() + daysToAdd);
  return date.toISOString().slice(0, 10);
}

function suggestSecondaryDateFromPrimary() {
  const primaryIso = parseDateInputToIso(ui.datePrimary?.value);
  if (!primaryIso) return;

  const suggestedIso = addUtcDay(primaryIso, 1);
  const secondaryIso = parseDateInputToIso(ui.dateSecondary?.value);
  if (!secondaryIso) {
    if (!ui.dateSecondary) return;
    ui.dateSecondary.value = formatIsoToDisplay(suggestedIso);
    if (state.datePickers.secondary && suggestedIso) {
      state.datePickers.secondary.setDate(suggestedIso, false, "Y-m-d");
    }
  }
}

function initDatePickers() {
  const flatpickrFn = globalThis?.flatpickr;
  if (typeof flatpickrFn !== "function") return;

  const baseOptions = {
    dateFormat: "d-m-Y",
    allowInput: true,
    disableMobile: true,
    clickOpens: true,
    static: false,
    locale: {
      firstDayOfWeek: 1,
    },
  };

  if (ui.datePrimary) {
    state.datePickers.primary = flatpickrFn(ui.datePrimary, {
      ...baseOptions,
      onChange: () => {
        suggestSecondaryDateFromPrimary();
        refreshFormState();
      },
      onClose: () => refreshFormState(),
    });
  }

  if (ui.dateSecondary) {
    state.datePickers.secondary = flatpickrFn(ui.dateSecondary, {
      ...baseOptions,
      onChange: () => refreshFormState(),
      onClose: () => refreshFormState(),
    });
  }

  const dateTimeOptions = {
    dateFormat: "d-m-Y H:i",
    enableTime: true,
    time_24hr: true,
    allowInput: true,
    disableMobile: true,
    clickOpens: true,
    static: false,
    locale: {
      firstDayOfWeek: 1,
    },
  };

  if (ui.skimmerFrom) {
    state.datePickers.skimmerFrom = flatpickrFn(ui.skimmerFrom, {
      ...dateTimeOptions,
      onChange: () => refreshSkimmerFormState(),
      onClose: () => refreshSkimmerFormState(),
    });
  }

  if (ui.skimmerTo) {
    state.datePickers.skimmerTo = flatpickrFn(ui.skimmerTo, {
      ...dateTimeOptions,
      onChange: () => refreshSkimmerFormState(),
      onClose: () => refreshSkimmerFormState(),
    });
  }

  const hasFrom = Number.isFinite(parseDateTimeInputToUtcTs(ui.skimmerFrom?.value));
  const hasTo = Number.isFinite(parseDateTimeInputToUtcTs(ui.skimmerTo?.value));
  const now = Date.now();
  const roundedNow = now - (now % (5 * 60 * 1000));
  const defaultFrom = roundedNow - 6 * 3600 * 1000;
  if (!hasFrom && ui.skimmerFrom) {
    ui.skimmerFrom.value = formatUtcTsToDateTimeDisplay(defaultFrom);
  }
  if (!hasTo && ui.skimmerTo) {
    ui.skimmerTo.value = formatUtcTsToDateTimeDisplay(roundedNow);
  }
}

const validateModel = validateAnalysisInput;

function setStatus(status, message) {
  state.status = status;
  const visualStatus = status === "idle" ? "ready" : status;
  ui.statusPill.dataset.state = visualStatus;
  ui.statusPill.textContent = visualStatus === "ready" ? "Ready" : visualStatus === "running" ? "Running" : "Error";
  const showMessage = status !== "idle" && Boolean(message);
  ui.statusMessage.hidden = !showMessage;
  ui.statusMessage.textContent = showMessage ? message : "";
}

function setStartButtonMode(mode) {
  if (!ui.startButton) return;
  ui.startButton.dataset.state = mode || "idle";
}

function setLiveStatus(status, message) {
  liveState.status = status;
  if (!ui.liveStatusPill || !ui.liveStatusMessage) return;
  const visualStatus = status === "idle" ? "ready" : status;
  ui.liveStatusPill.dataset.state = visualStatus;
  ui.liveStatusPill.textContent = visualStatus === "ready" ? "Ready" : visualStatus === "running" ? "Running" : "Error";
  const showMessage = status !== "idle" && Boolean(message);
  ui.liveStatusMessage.hidden = !showMessage;
  ui.liveStatusMessage.textContent = showMessage ? message : "";
}

function setLiveStartButtonMode(mode) {
  if (!ui.liveStartButton) return;
  ui.liveStartButton.dataset.state = mode || "idle";
}

function setSkimmerStatus(status, message) {
  skimmerState.status = status;
  if (!ui.skimmerStatusPill || !ui.skimmerStatusMessage) return;
  const visualStatus = status === "idle" ? "ready" : status;
  ui.skimmerStatusPill.dataset.state = visualStatus;
  ui.skimmerStatusPill.textContent = visualStatus === "ready" ? "Ready" : visualStatus === "running" ? "Running" : "Error";
  const showMessage = status !== "idle" && Boolean(message);
  ui.skimmerStatusMessage.hidden = !showMessage;
  ui.skimmerStatusMessage.textContent = showMessage ? message : "";
}

function setSkimmerStartButtonMode(mode) {
  if (!ui.skimmerStartButton) return;
  ui.skimmerStartButton.dataset.state = mode || "idle";
}

function setLoadCheck(node, status) {
  if (!node) return;
  node.dataset.state = status;
  const mark = node.querySelector(".hero-check-mark");
  if (!mark) return;
  if (status === "ok") {
    mark.textContent = "✓";
  } else if (status === "loading") {
    mark.textContent = "…";
  } else if (status === "error") {
    mark.textContent = "×";
  } else {
    mark.textContent = "○";
  }
}

function resetLoadChecks() {
  setLoadCheck(ui.checkFetch, "pending");
  setLoadCheck(ui.checkCty, "pending");
  setLoadCheck(ui.checkCharts, "pending");
}

function resetLiveLoadChecks() {
  setLoadCheck(ui.liveCheckFetch, "pending");
  setLoadCheck(ui.liveCheckCty, "pending");
  setLoadCheck(ui.liveCheckCharts, "pending");
}

function resetSkimmerLoadChecks() {
  setLoadCheck(ui.skimmerCheckFetch, "pending");
  setLoadCheck(ui.skimmerCheckCty, "pending");
  setLoadCheck(ui.skimmerCheckCharts, "pending");
}

function clearRetryCountdown() {
  if (state.retry.timer) {
    clearInterval(state.retry.timer);
    state.retry.timer = 0;
  }
  state.retry.untilTs = 0;
  state.retry.baseMessage = "";
  state.retry.model = null;
  state.retry.attempts = 0;
}

function startRetryCountdown(ms, baseMessage, status = "ready", options = {}) {
  const { autoRetry = false, trigger = null } = options;
  if (state.retry.timer) {
    clearInterval(state.retry.timer);
    state.retry.timer = 0;
  }
  const durationMs = Math.max(1000, Number(ms) || 1000);
  state.retry.untilTs = Date.now() + durationMs;
  state.retry.baseMessage = baseMessage;
  state.retry.status = status;

  const tick = async () => {
    const remainingMs = state.retry.untilTs - Date.now();
    if (remainingMs <= 0) {
      if (autoRetry && typeof trigger === "function" && state.retry.attempts < state.retry.maxAttempts) {
        state.retry.attempts += 1;
        if (state.retry.timer) {
          clearInterval(state.retry.timer);
          state.retry.timer = 0;
        }
        state.retry.untilTs = 0;
        setStatus("running", `${baseMessage} Auto-retrying now (${state.retry.attempts}/${state.retry.maxAttempts}).`);
        await trigger();
        return;
      }
      if (state.retry.timer) {
        clearInterval(state.retry.timer);
        state.retry.timer = 0;
      }
      state.retry.untilTs = 0;
      state.retry.baseMessage = "";
      setStatus(status, `${baseMessage} Retry available now.`);
      return;
    }
    const remainingSec = Math.ceil(remainingMs / 1000);
    if (autoRetry) {
      setStatus(
        status,
        `${baseMessage} Auto-retry in ${remainingSec}s (attempt ${state.retry.attempts + 1}/${state.retry.maxAttempts}).`,
      );
    } else {
      setStatus(status, `${baseMessage} Retry in ${remainingSec}s.`);
    }
  };

  tick();
  state.retry.timer = setInterval(tick, 1000);
}

function clearLiveRetryCountdown() {
  if (liveState.retry.timer) {
    clearInterval(liveState.retry.timer);
    liveState.retry.timer = 0;
  }
  liveState.retry.untilTs = 0;
  liveState.retry.attempts = 0;
  liveState.retry.model = null;
}

function startLiveRetryCountdown(ms, model, baseMessage) {
  if (liveState.retry.timer) {
    clearInterval(liveState.retry.timer);
    liveState.retry.timer = 0;
  }
  liveState.retry.model = { ...model, comparisons: [...(model?.comparisons || [])] };
  const durationMs = Math.max(1000, Number(ms) || 1000);
  liveState.retry.untilTs = Date.now() + durationMs;

  const tick = async () => {
    const remainingMs = liveState.retry.untilTs - Date.now();
    if (remainingMs <= 0) {
      if (liveState.retry.attempts >= liveState.retry.maxAttempts || !liveState.retry.model) {
        clearLiveRetryCountdown();
        setLiveStatus("error", `${baseMessage} Auto-retry limit reached.`);
        return;
      }
      liveState.retry.attempts += 1;
      if (liveState.retry.timer) {
        clearInterval(liveState.retry.timer);
        liveState.retry.timer = 0;
      }
      liveState.retry.untilTs = 0;
      setLiveStatus(
        "running",
        `${baseMessage} Auto-retrying now (${liveState.retry.attempts}/${liveState.retry.maxAttempts}).`,
      );
      await runLiveAnalysis(liveState.retry.model, { source: "auto_retry" });
      return;
    }
    const remainingSec = Math.ceil(remainingMs / 1000);
    setLiveStatus(
      "ready",
      `${baseMessage} Auto-retry in ${remainingSec}s (attempt ${liveState.retry.attempts + 1}/${liveState.retry.maxAttempts}).`,
    );
  };

  tick();
  liveState.retry.timer = setInterval(tick, 1000);
}

function clearSkimmerRetryCountdown() {
  if (skimmerState.retry.timer) {
    clearInterval(skimmerState.retry.timer);
    skimmerState.retry.timer = 0;
  }
  skimmerState.retry.untilTs = 0;
  skimmerState.retry.attempts = 0;
  skimmerState.retry.model = null;
}

function startSkimmerRetryCountdown(ms, model, baseMessage) {
  if (skimmerState.retry.timer) {
    clearInterval(skimmerState.retry.timer);
    skimmerState.retry.timer = 0;
  }
  skimmerState.retry.model = { ...model, comparisons: [...(model?.comparisons || [])] };
  const durationMs = Math.max(1000, Number(ms) || 1000);
  skimmerState.retry.untilTs = Date.now() + durationMs;

  const tick = async () => {
    const remainingMs = skimmerState.retry.untilTs - Date.now();
    if (remainingMs <= 0) {
      if (skimmerState.retry.attempts >= skimmerState.retry.maxAttempts || !skimmerState.retry.model) {
        clearSkimmerRetryCountdown();
        setSkimmerStatus("error", `${baseMessage} Auto-retry limit reached.`);
        return;
      }
      skimmerState.retry.attempts += 1;
      if (skimmerState.retry.timer) {
        clearInterval(skimmerState.retry.timer);
        skimmerState.retry.timer = 0;
      }
      skimmerState.retry.untilTs = 0;
      setSkimmerStatus(
        "running",
        `${baseMessage} Auto-retrying now (${skimmerState.retry.attempts}/${skimmerState.retry.maxAttempts}).`,
      );
      await runSkimmerAnalysis(skimmerState.retry.model, { source: "auto_retry" });
      return;
    }
    const remainingSec = Math.ceil(remainingMs / 1000);
    setSkimmerStatus(
      "ready",
      `${baseMessage} Auto-retry in ${remainingSec}s (attempt ${skimmerState.retry.attempts + 1}/${skimmerState.retry.maxAttempts}).`,
    );
  };

  tick();
  skimmerState.retry.timer = setInterval(tick, 1000);
}

function syncStateFromModel(model) {
  state.dates = [...model.dates];
  state.slots.A.call = model.primary;
  state.slots.B.call = model.comparisons[0] || "";
  state.slots.C.call = model.comparisons[1] || "";
  state.slots.D.call = model.comparisons[2] || "";
}

function syncLiveStateFromModel(model) {
  liveState.windowHours = Number(model?.windowHours || 24);
  liveState.slots.A.call = model?.primary || "";
  liveState.slots.B.call = model?.comparisons?.[0] || "";
  liveState.slots.C.call = model?.comparisons?.[1] || "";
  liveState.slots.D.call = model?.comparisons?.[2] || "";
}

function syncSkimmerStateFromModel(model) {
  skimmerState.fromTsUtc = Number(model?.fromTsUtc) || 0;
  skimmerState.toTsUtc = Number(model?.toTsUtc) || 0;
  skimmerState.areaType = String(model?.areaType || "GLOBAL").toUpperCase();
  skimmerState.areaValue = String(model?.areaValue || "");
  skimmerState.slots.A.call = model?.primary || "";
  skimmerState.slots.B.call = model?.comparisons?.[0] || "";
  skimmerState.slots.C.call = model?.comparisons?.[1] || "";
  skimmerState.slots.D.call = model?.comparisons?.[2] || "";
}

function teardownChartObservers() {
  if (state.chart.resizeObserver) {
    state.chart.resizeObserver.disconnect();
    state.chart.resizeObserver = null;
  }
  if (state.chart.intersectionObserver) {
    state.chart.intersectionObserver.disconnect();
    state.chart.intersectionObserver = null;
  }
  if (state.chart.drawRaf) {
    cancelAnimationFrame(state.chart.drawRaf);
    state.chart.drawRaf = 0;
  }
}

function getReadySlots() {
  return (state.analysis?.slots || []).filter((slot) => slot.status === "ready");
}

function getAvailableBands(slots) {
  const set = new Set();
  for (const slot of slots) {
    const spots = Array.isArray(slot.raw?.ofUsSpots) ? slot.raw.ofUsSpots : [];
    for (const spot of spots) {
      const band = normalizeBandToken(spot?.band || "");
      if (band) set.add(band);
    }
  }
  return sortBands(Array.from(set));
}

function getGlobalTimeRange(slots) {
  let minTs = Number.POSITIVE_INFINITY;
  let maxTs = Number.NEGATIVE_INFINITY;

  for (const slot of slots) {
    const spots = Array.isArray(slot.raw?.ofUsSpots) ? slot.raw.ofUsSpots : [];
    for (const spot of spots) {
      if (!Number.isFinite(spot?.ts)) continue;
      minTs = Math.min(minTs, spot.ts);
      maxTs = Math.max(maxTs, spot.ts);
    }
  }

  if (!Number.isFinite(minTs) || !Number.isFinite(maxTs)) {
    const now = Date.now();
    return { minTs: now - 24 * 3600 * 1000, maxTs: now };
  }

  return { minTs, maxTs };
}

function getActiveBandFilterSet() {
  return new Set((state.chart.selectedBands || []).map((band) => normalizeBandToken(band)).filter(Boolean));
}

function computeSeriesForSpotter(slots, spotter, bandFilterSet) {
  const series = [];
  const bandsPlotted = new Set();
  let minSnr = null;
  let maxSnr = null;
  let pointTotal = 0;

  for (const slot of slots) {
    const index = getOrBuildSlotIndex(slot);
    if (!index) continue;
    const entry = index.bySpotter.get(spotter);
    if (!entry) continue;

    const shape = slotMarkerShape(slot.id);
    const perSlotCap = 6500;

    const counts = Array.from(entry.bandCounts.entries()).filter(
      ([band, count]) => count > 0 && (!bandFilterSet.size || bandFilterSet.has(band)),
    );
    if (!counts.length) continue;
    const total = counts.reduce((acc, [, count]) => acc + count, 0);
    const caps = computeProportionalCaps(counts, total, perSlotCap, 120);

    for (const [band, cap] of caps) {
      const raw = entry.byBand.get(band) || [];
      const sampled = sampleFlatStrideSeeded(raw, cap, `${spotter}|${slot.id}|${index.dataKey}|${band}`);
      if (!sampled.length) continue;
      series.push({ band, slotId: slot.id, shape, color: bandColorForChart(band), data: sampled });
      pointTotal += Math.floor(sampled.length / 2);
      bandsPlotted.add(band);
      for (let i = 1; i < sampled.length; i += 2) {
        const snr = sampled[i];
        if (!Number.isFinite(snr)) continue;
        minSnr = minSnr == null ? snr : Math.min(minSnr, snr);
        maxSnr = maxSnr == null ? snr : Math.max(maxSnr, snr);
      }
    }
  }

  return { series, bandsPlotted, minSnr, maxSnr, pointTotal };
}

function percentile75(values) {
  if (!values.length) return null;
  values.sort((a, b) => a - b);
  const index = Math.max(0, Math.min(values.length - 1, Math.floor(0.75 * (values.length - 1))));
  return values[index];
}

function buildTrendlines(series, minTs, maxTs) {
  return series
    .map((entry) => {
      const data = Array.isArray(entry.data) ? entry.data : [];
      const pointCount = Math.floor(data.length / 2);
      if (pointCount < 2) return null;

      const bucketMs = pointCount <= 250 ? 15 * 60 * 1000 : pointCount <= 700 ? 10 * 60 * 1000 : 5 * 60 * 1000;
      const binCount = Math.max(1, Math.ceil((maxTs - minTs) / bucketMs));
      const bins = Array.from({ length: binCount }, () => []);

      for (let i = 0; i < data.length; i += 2) {
        const ts = data[i];
        const snr = data[i + 1];
        if (!Number.isFinite(ts) || !Number.isFinite(snr)) continue;
        const bin = Math.floor((ts - minTs) / bucketMs);
        if (bin < 0 || bin >= binCount) continue;
        bins[bin].push(snr);
      }

      const points = [];
      for (let i = 0; i < binCount; i += 1) {
        if (!bins[i].length) continue;
        const window = [];
        if (i > 0 && bins[i - 1].length) window.push(...bins[i - 1]);
        window.push(...bins[i]);
        if (i + 1 < binCount && bins[i + 1].length) window.push(...bins[i + 1]);
        const snr = percentile75(window);
        if (!Number.isFinite(snr)) continue;
        const ts = minTs + (i + 0.5) * bucketMs;
        points.push(ts, snr);
      }

      if (points.length < 4) return null;
      return {
        slotId: entry.slotId,
        band: entry.band,
        color: entry.color,
        dash: slotLineDash(entry.slotId),
        width: entry.slotId === "A" ? 2.1 : 1.7,
        data: points,
      };
    })
    .filter(Boolean);
}

function updateCardLegend(card, bands, activeFilter) {
  const node = card.querySelector(".rbn-signal-legend-bands");
  if (!node) return;
  const list = sortBands(Array.from(bands).filter(Boolean));
  if (!list.length) {
    node.innerHTML = `<span class="rbn-legend-empty">No bands</span>`;
    return;
  }
  const hasFilter = activeFilter.size > 0;
  const allChip = `
    <button type="button" class="rbn-legend-item rbn-legend-toggle${hasFilter ? "" : " is-active"}" data-band="__ALL__">
      All
    </button>
  `;
  const chips = list
    .map((band) => {
      const active = !hasFilter || activeFilter.has(band);
      const safeBand = escapeHtml(band);
      const safeLabel = escapeHtml(formatBandLabel(band));
      return `
        <button type="button" class="rbn-legend-item rbn-legend-toggle${active ? " is-active" : ""}" data-band="${safeBand}">
          <i style="background:${bandColorForChart(band)}"></i>${safeLabel}
        </button>
      `;
    })
    .join("");
  node.innerHTML = allChip + chips;
}

function renderCallsignLegend(slots) {
  return slots
    .map(
      (slot) => `
        <div class="rbn-call-item">
          <span class="rbn-call-name">${escapeHtml(slot.call)}</span>
          <span class="rbn-call-marker">${slotMarkerSymbol(slot.id)}</span>
          <span class="rbn-call-line">${slotLineSample(slot.id)}</span>
        </div>
      `,
    )
    .join("");
}

function updateCardMeta(card, pointTotal, minSnr, maxSnr) {
  const node = card.querySelector(".rbn-signal-meta");
  if (!node) return;
  const snrText = Number.isFinite(minSnr) && Number.isFinite(maxSnr)
    ? `${Math.round(minSnr)}..${Math.round(maxSnr)} dB`
    : "N/A";
  node.textContent = `${formatNumber(pointTotal)} points plotted · SNR range: ${snrText}`;
}

function resolveChartViewRange(globalMinTs, globalMaxTs, zoom) {
  let viewMinTs = Number(globalMinTs);
  let viewMaxTs = Number(globalMaxTs);

  if (zoom && Number.isFinite(zoom.minTs) && Number.isFinite(zoom.maxTs) && zoom.maxTs > zoom.minTs) {
    viewMinTs = Math.max(viewMinTs, Number(zoom.minTs));
    viewMaxTs = Math.min(viewMaxTs, Number(zoom.maxTs));
  }

  if (!Number.isFinite(viewMinTs) || !Number.isFinite(viewMaxTs) || viewMaxTs <= viewMinTs) {
    return { minTs: Number(globalMinTs), maxTs: Number(globalMaxTs) };
  }
  return { minTs: viewMinTs, maxTs: viewMaxTs };
}

function getCanvasTimeRange(canvas) {
  if (!(canvas instanceof HTMLCanvasElement)) return null;
  const minTs = Number(canvas.dataset.viewMinTs);
  const maxTs = Number(canvas.dataset.viewMaxTs);
  if (!Number.isFinite(minTs) || !Number.isFinite(maxTs) || maxTs <= minTs) return null;
  return { minTs, maxTs };
}

function getCanvasPlotBounds(canvas) {
  if (!(canvas instanceof HTMLCanvasElement)) return null;
  const rect = canvas.getBoundingClientRect();
  const cssWidth = Math.max(320, canvas.clientWidth || Math.floor(rect.width) || 920);
  const cssHeight = Math.max(220, Number(canvas.dataset.height) || 280);
  const left = CHART_PLOT_MARGIN.left;
  const right = Math.max(left + 10, cssWidth - CHART_PLOT_MARGIN.right);
  const top = CHART_PLOT_MARGIN.top;
  const bottom = Math.max(top + 10, cssHeight - CHART_PLOT_MARGIN.bottom);
  return {
    rect,
    left,
    right,
    top,
    bottom,
    width: Math.max(1, right - left),
  };
}

function xToTimeOnCanvas(canvas, clientX) {
  const range = getCanvasTimeRange(canvas);
  const bounds = getCanvasPlotBounds(canvas);
  if (!range || !bounds) return null;
  const localX = clientX - bounds.rect.left;
  const clampedX = Math.max(bounds.left, Math.min(bounds.right, localX));
  const ratio = (clampedX - bounds.left) / Math.max(1, bounds.width);
  const ts = range.minTs + ratio * (range.maxTs - range.minTs);
  return { ts, x: clampedX, bounds };
}

function hideZoomBrush(brush) {
  if (!(brush instanceof HTMLElement)) return;
  brush.hidden = true;
  brush.style.width = "0px";
}

function showZoomBrush(brush, bounds, startX, currentX) {
  if (!(brush instanceof HTMLElement) || !bounds) return;
  const left = Math.min(startX, currentX);
  const width = Math.max(1, Math.abs(currentX - startX));
  brush.style.left = `${left}px`;
  brush.style.top = `${bounds.top}px`;
  brush.style.width = `${width}px`;
  brush.style.height = `${Math.max(1, bounds.bottom - bounds.top)}px`;
  brush.hidden = false;
}

function bindZoomInteractions(canvases, chartState, scheduleDraw, slots) {
  for (const canvas of canvases) {
    if (!(canvas instanceof HTMLCanvasElement)) continue;
    const key = String(canvas.dataset.continent || "N/A").toUpperCase();
    const plot = canvas.closest(".rbn-signal-plot");
    const brush = plot?.querySelector(".rbn-zoom-brush");
    let drag = null;

    canvas.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      const mapped = xToTimeOnCanvas(canvas, event.clientX);
      if (!mapped) return;
      drag = { pointerId: event.pointerId, startTs: mapped.ts, startX: mapped.x, bounds: mapped.bounds };
      canvas.setPointerCapture(event.pointerId);
      showZoomBrush(brush, mapped.bounds, mapped.x, mapped.x);
      event.preventDefault();
    });

    canvas.addEventListener("pointermove", (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const mapped = xToTimeOnCanvas(canvas, event.clientX);
      if (!mapped) return;
      showZoomBrush(brush, drag.bounds, drag.startX, mapped.x);
    });

    const finishDrag = (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const mapped = xToTimeOnCanvas(canvas, event.clientX);
      const startTs = drag.startTs;
      const startX = drag.startX;
      drag = null;
      hideZoomBrush(brush);
      if (!mapped) return;
      if (Math.abs(mapped.x - startX) < MIN_ZOOM_DRAG_PX) return;

      const minTs = Math.min(startTs, mapped.ts);
      const maxTs = Math.max(startTs, mapped.ts);
      if (maxTs - minTs < MIN_ZOOM_WINDOW_MS) return;

      chartState.zoomByContinent[key] = { minTs, maxTs };
      scheduleDraw(slots);
    };

    canvas.addEventListener("pointerup", finishDrag);
    canvas.addEventListener("pointercancel", () => {
      drag = null;
      hideZoomBrush(brush);
    });
    canvas.addEventListener("dblclick", () => {
      if (!chartState.zoomByContinent[key]) return;
      delete chartState.zoomByContinent[key];
      hideZoomBrush(brush);
      scheduleDraw(slots);
    });
  }
}

function drawCharts(slots) {
  const canvases = Array.from(ui.chartsRoot.querySelectorAll(".rbn-signal-canvas")).filter((canvas) => {
    if (!(canvas instanceof HTMLCanvasElement)) return false;
    if (!state.chart.intersectionObserver) return true;
    return canvas.dataset.visible === "1";
  });
  if (!canvases.length) return;

  const { minTs: globalMinTs, maxTs: globalMaxTs } = getGlobalTimeRange(slots);
  const availableBands = getAvailableBands(slots);
  const bandFilterSet = getActiveBandFilterSet();

  for (const canvas of canvases) {
    const card = canvas.closest(".rbn-signal-card");
    const continent = String(canvas.dataset.continent || "N/A").toUpperCase();
    const scopeLabel = String(canvas.dataset.scopeLabel || "").trim();
    const regionLabel = scopeLabel || continentLabel(continent);
    const spotter = String(canvas.dataset.spotter || "");

    const zoomRange = resolveChartViewRange(globalMinTs, globalMaxTs, state.chart.zoomByContinent[continent]);
    const minTs = zoomRange.minTs;
    const maxTs = zoomRange.maxTs;

    if (!spotter) {
      drawRbnSignalCanvas(canvas, {
        title: `${regionLabel} · no target station`,
        minTs,
        maxTs,
        minY: -30,
        maxY: 40,
        series: [],
        trendlines: [],
      });
      if (card) {
        updateCardLegend(card, availableBands, bandFilterSet);
        updateCardMeta(card, 0, null, null);
      }
      canvas.dataset.globalMinTs = String(globalMinTs);
      canvas.dataset.globalMaxTs = String(globalMaxTs);
      canvas.dataset.viewMinTs = String(minTs);
      canvas.dataset.viewMaxTs = String(maxTs);
      continue;
    }

    const model = computeSeriesForSpotter(slots, spotter, bandFilterSet);
    let minY = Number(model.minSnr);
    let maxY = Number(model.maxSnr);
    if (!Number.isFinite(minY) || !Number.isFinite(maxY)) {
      minY = -30;
      maxY = 40;
    } else if (minY === maxY) {
      minY -= 5;
      maxY += 5;
    } else {
      const pad = Math.max(2, (maxY - minY) * 0.08);
      minY -= pad;
      maxY += pad;
    }

    const trendlines = buildTrendlines(model.series, minTs, maxTs);
    const title = `${regionLabel} · ${spotter}`;

    drawRbnSignalCanvas(canvas, {
      title,
      minTs,
      maxTs,
      minY,
      maxY,
      series: model.series,
      trendlines,
    });

    if (card) {
      updateCardLegend(card, availableBands, bandFilterSet);
      updateCardMeta(card, model.pointTotal, model.minSnr, model.maxSnr);
    }

    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", `${title}. ${formatNumber(model.pointTotal)} points plotted.`);
    canvas.dataset.globalMinTs = String(globalMinTs);
    canvas.dataset.globalMaxTs = String(globalMaxTs);
    canvas.dataset.viewMinTs = String(minTs);
    canvas.dataset.viewMaxTs = String(maxTs);
  }
}

function scheduleChartDraw(slots) {
  if (state.chart.drawRaf) return;
  state.chart.drawRaf = requestAnimationFrame(() => {
    state.chart.drawRaf = 0;
    drawCharts(slots);
  });
}

function bindChartInteractions(slots) {
  teardownChartObservers();

  const selects = Array.from(ui.chartsRoot.querySelectorAll(".rbn-signal-select"));
  for (const select of selects) {
    select.addEventListener("change", (event) => {
      const target = event.currentTarget;
      const continent = String(target.dataset.continent || "N/A").toUpperCase();
      const spotter = String(target.value || "");
      state.chart.selectedByContinent[continent] = spotter;
      const canvas = target.closest(".rbn-signal-card")?.querySelector(".rbn-signal-canvas");
      if (canvas) canvas.dataset.spotter = spotter;
      scheduleChartDraw(slots);
    });
  }

  const canvases = Array.from(ui.chartsRoot.querySelectorAll(".rbn-signal-canvas"));
  bindZoomInteractions(canvases, state.chart, scheduleChartDraw, slots);
  if (typeof ResizeObserver === "function") {
    state.chart.resizeObserver = new ResizeObserver(() => scheduleChartDraw(slots));
    for (const canvas of canvases) {
      state.chart.resizeObserver.observe(canvas);
    }
  }

  if (typeof IntersectionObserver === "function") {
    state.chart.intersectionObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const target = entry.target;
          if (!(target instanceof HTMLCanvasElement)) continue;
          target.dataset.visible = entry.isIntersecting ? "1" : "0";
        }
        scheduleChartDraw(slots);
      },
      { root: null, threshold: 0.05, rootMargin: "120px 0px" },
    );

    for (const canvas of canvases) {
      canvas.dataset.visible = "0";
      state.chart.intersectionObserver.observe(canvas);
    }
  } else {
    for (const canvas of canvases) {
      canvas.dataset.visible = "1";
    }
  }

  scheduleChartDraw(slots);
}

function renderChartFailures() {
  const failed = (state.analysis?.slots || []).filter((slot) => slot.status === "error" || slot.status === "qrx");
  if (!failed.length) return "";
  return `
    <div class="chart-failures">
      ${failed
        .map(
          (slot) => {
            if (slot.status === "qrx") {
              const wait = Math.ceil(Math.max(0, Number(slot.retryAfterMs) || 0) / 1000);
              const text = wait ? `Rate limited, will auto retry in ~${wait}s` : "Rate limited, will auto retry.";
              return `<p><b>${slotTitle(slot)} (${escapeHtml(slot.call)})</b>: ${text}</p>`;
            }
            return `<p><b>${slotTitle(slot)} (${escapeHtml(slot.call)})</b>: ${escapeHtml(slot.error || "Failed")}</p>`;
          },
        )
        .join("")}
    </div>
  `;
}

function renderAnalysisCharts() {
  if (ui.chartsNote) ui.chartsNote.hidden = Boolean(state.analysis);

  if (!state.analysis) {
    ui.chartsRoot.classList.add("empty-state");
    ui.chartsRoot.innerHTML = "<p>No analysis results yet.</p>";
    setLoadCheck(ui.checkCharts, "pending");
    return;
  }

  const slots = getReadySlots();
  if (!slots.length) {
    ui.chartsRoot.classList.remove("empty-state");
    ui.chartsRoot.innerHTML = `
      <div class="chart-empty">
        <p>No successful slot data available.</p>
        ${renderChartFailures()}
      </div>
    `;
    setLoadCheck(ui.checkCharts, "error");
    return;
  }

  const baseSlot = slots.find((slot) => slot.id === "A") || slots[0];
  const activeBands = getActiveBandFilterSet();
  state.chart.selectedBands = sortBands(Array.from(activeBands));
  const rankingBand = activeBands.size === 1 ? Array.from(activeBands)[0] : "";
  const ranking = getOrBuildRanking(baseSlot, rankingBand);
  const callsignLegend = renderCallsignLegend(slots);
  const cardsOrder = CONTINENT_ORDER.map((continent) => {
    const list = ranking?.byContinent.get(continent) || [];
    return {
      continent,
      list,
      topCount: list[0]?.count || 0,
    };
  }).sort((a, b) => {
    if (b.topCount !== a.topCount) return b.topCount - a.topCount;
    return continentSort(a.continent, b.continent);
  });

  const cardsHtml = cardsOrder
    .map(({ continent, list }) => {
      const saved = String(state.chart.selectedByContinent[continent] || "");
      const selectedSpotter = saved && list.some((item) => item.spotter === saved) ? saved : list[0]?.spotter || "";
      if (selectedSpotter) state.chart.selectedByContinent[continent] = selectedSpotter;

      const options = list.length
        ? list
            .slice(0, 80)
            .map(
              (item) =>
                `<option value="${escapeHtml(item.spotter)}" ${item.spotter === selectedSpotter ? "selected" : ""}>${escapeHtml(item.spotter)} (${formatNumber(item.count)})</option>`,
            )
            .join("")
        : "<option value=''>No skimmers</option>";

      const statusText = list.length ? "" : `No RBN spots found for ${continentLabel(continent)}.`;

      return `
        <article class="rbn-signal-card">
          <div class="rbn-signal-head">
            <h4>${continentLabel(continent)} skimmer</h4>
            <label class="rbn-signal-picker" aria-label="${continentLabel(continent)} skimmer selector">
              <select class="rbn-signal-select" data-continent="${continent}" ${list.length ? "" : "disabled"}>
                ${options}
              </select>
            </label>
            <button type="button" class="rbn-copy-btn" title="Copy as image" aria-label="Copy as image">Copy as image</button>
            <span class="rbn-signal-status" ${list.length ? "hidden" : ""}>${statusText}</span>
          </div>
          <div class="rbn-signal-body">
            <div class="rbn-signal-plot">
              <canvas class="rbn-signal-canvas" data-continent="${continent}" data-spotter="${escapeHtml(selectedSpotter)}" data-height="280"></canvas>
              <div class="rbn-zoom-brush" hidden aria-hidden="true"></div>
              <div class="rbn-signal-meta">0 points plotted · SNR range: N/A</div>
            </div>
            <div class="rbn-signal-side">
              <div class="rbn-signal-legend">
                <h5>Bands (click to filter)</h5>
                <span class="rbn-signal-legend-bands"></span>
              </div>
              <div class="rbn-signal-calls">
                <h5>Callsigns</h5>
                <div class="rbn-signal-calls-list">
                  ${callsignLegend}
                </div>
              </div>
            </div>
          </div>
        </article>
      `;
    })
    .join("");

  ui.chartsRoot.classList.remove("empty-state");
  ui.chartsRoot.innerHTML = `
    ${renderChartFailures()}
    <div class="rbn-signal-grid">${cardsHtml}</div>
  `;

  setLoadCheck(ui.checkCharts, "ok");
  bindChartInteractions(slots);
}

function teardownLiveChartObservers() {
  if (liveState.chart.resizeObserver) {
    liveState.chart.resizeObserver.disconnect();
    liveState.chart.resizeObserver = null;
  }
  if (liveState.chart.intersectionObserver) {
    liveState.chart.intersectionObserver.disconnect();
    liveState.chart.intersectionObserver = null;
  }
  if (liveState.chart.drawRaf) {
    cancelAnimationFrame(liveState.chart.drawRaf);
    liveState.chart.drawRaf = 0;
  }
}

function getLiveReadySlots() {
  return (liveState.analysis?.slots || []).filter((slot) => slot.status === "ready");
}

function getLiveActiveBandFilterSet() {
  return new Set((liveState.chart.selectedBands || []).map((band) => normalizeBandToken(band)).filter(Boolean));
}

function drawLiveCharts(slots) {
  const canvases = Array.from(ui.liveChartsRoot.querySelectorAll(".rbn-signal-canvas")).filter((canvas) => {
    if (!(canvas instanceof HTMLCanvasElement)) return false;
    if (!liveState.chart.intersectionObserver) return true;
    return canvas.dataset.visible === "1";
  });
  if (!canvases.length) return;

  const { minTs: globalMinTs, maxTs: globalMaxTs } = getGlobalTimeRange(slots);
  const availableBands = getAvailableBands(slots);
  const bandFilterSet = getLiveActiveBandFilterSet();

  for (const canvas of canvases) {
    const card = canvas.closest(".rbn-signal-card");
    const continent = String(canvas.dataset.continent || "N/A").toUpperCase();
    const scopeLabel = String(canvas.dataset.scopeLabel || "").trim();
    const regionLabel = scopeLabel || continentLabel(continent);
    const spotter = String(canvas.dataset.spotter || "");

    const zoomRange = resolveChartViewRange(globalMinTs, globalMaxTs, liveState.chart.zoomByContinent[continent]);
    const minTs = zoomRange.minTs;
    const maxTs = zoomRange.maxTs;

    if (!spotter) {
      drawRbnSignalCanvas(canvas, {
        title: `${regionLabel} · no skimmer`,
        minTs,
        maxTs,
        minY: -30,
        maxY: 40,
        series: [],
        trendlines: [],
      });
      if (card) {
        updateCardLegend(card, availableBands, bandFilterSet);
        updateCardMeta(card, 0, null, null);
      }
      canvas.dataset.globalMinTs = String(globalMinTs);
      canvas.dataset.globalMaxTs = String(globalMaxTs);
      canvas.dataset.viewMinTs = String(minTs);
      canvas.dataset.viewMaxTs = String(maxTs);
      continue;
    }

    const model = computeSeriesForSpotter(slots, spotter, bandFilterSet);
    let minY = Number(model.minSnr);
    let maxY = Number(model.maxSnr);
    if (!Number.isFinite(minY) || !Number.isFinite(maxY)) {
      minY = -30;
      maxY = 40;
    } else if (minY === maxY) {
      minY -= 5;
      maxY += 5;
    } else {
      const pad = Math.max(2, (maxY - minY) * 0.08);
      minY -= pad;
      maxY += pad;
    }

    const trendlines = buildTrendlines(model.series, minTs, maxTs);
    const title = `${regionLabel} · ${spotter}`;

    drawRbnSignalCanvas(canvas, {
      title,
      minTs,
      maxTs,
      minY,
      maxY,
      series: model.series,
      trendlines,
    });

    if (card) {
      updateCardLegend(card, availableBands, bandFilterSet);
      updateCardMeta(card, model.pointTotal, model.minSnr, model.maxSnr);
    }

    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", `${title}. ${formatNumber(model.pointTotal)} points plotted.`);
    canvas.dataset.globalMinTs = String(globalMinTs);
    canvas.dataset.globalMaxTs = String(globalMaxTs);
    canvas.dataset.viewMinTs = String(minTs);
    canvas.dataset.viewMaxTs = String(maxTs);
  }
}

function scheduleLiveChartDraw(slots) {
  if (liveState.chart.drawRaf) return;
  liveState.chart.drawRaf = requestAnimationFrame(() => {
    liveState.chart.drawRaf = 0;
    drawLiveCharts(slots);
  });
}

function bindLiveChartInteractions(slots) {
  teardownLiveChartObservers();

  const selects = Array.from(ui.liveChartsRoot.querySelectorAll(".rbn-signal-select"));
  for (const select of selects) {
    select.addEventListener("change", (event) => {
      const target = event.currentTarget;
      const continent = String(target.dataset.continent || "N/A").toUpperCase();
      const spotter = String(target.value || "");
      liveState.chart.selectedByContinent[continent] = spotter;
      const canvas = target.closest(".rbn-signal-card")?.querySelector(".rbn-signal-canvas");
      if (canvas) canvas.dataset.spotter = spotter;
      scheduleLiveChartDraw(slots);
    });
  }

  const canvases = Array.from(ui.liveChartsRoot.querySelectorAll(".rbn-signal-canvas"));
  bindZoomInteractions(canvases, liveState.chart, scheduleLiveChartDraw, slots);
  if (typeof ResizeObserver === "function") {
    liveState.chart.resizeObserver = new ResizeObserver(() => scheduleLiveChartDraw(slots));
    for (const canvas of canvases) {
      liveState.chart.resizeObserver.observe(canvas);
    }
  }

  if (typeof IntersectionObserver === "function") {
    liveState.chart.intersectionObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const target = entry.target;
          if (!(target instanceof HTMLCanvasElement)) continue;
          target.dataset.visible = entry.isIntersecting ? "1" : "0";
        }
        scheduleLiveChartDraw(slots);
      },
      { root: null, threshold: 0.05, rootMargin: "120px 0px" },
    );

    for (const canvas of canvases) {
      canvas.dataset.visible = "0";
      liveState.chart.intersectionObserver.observe(canvas);
    }
  } else {
    for (const canvas of canvases) {
      canvas.dataset.visible = "1";
    }
  }

  scheduleLiveChartDraw(slots);
}

function renderLiveChartFailures() {
  const failed = (liveState.analysis?.slots || []).filter((slot) => slot.status === "error" || slot.status === "qrx");
  if (!failed.length) return "";
  return `
    <div class="chart-failures">
      ${failed
        .map(
          (slot) => {
            if (slot.status === "qrx") {
              const wait = Math.ceil(Math.max(0, Number(slot.retryAfterMs) || 0) / 1000);
              const text = wait ? `Rate limited, will auto retry in ~${wait}s` : "Rate limited, will auto retry.";
              return `<p><b>${slotTitle(slot)} (${escapeHtml(slot.call)})</b>: ${text}</p>`;
            }
            return `<p><b>${slotTitle(slot)} (${escapeHtml(slot.call)})</b>: ${escapeHtml(slot.error || "Failed")}</p>`;
          },
        )
        .join("")}
    </div>
  `;
}

function renderLiveAnalysisCharts() {
  if (ui.liveChartsNote) ui.liveChartsNote.hidden = Boolean(liveState.analysis);

  if (!liveState.analysis) {
    ui.liveChartsRoot.classList.add("empty-state");
    ui.liveChartsRoot.innerHTML = "<p>No live analysis results yet.</p>";
    setLoadCheck(ui.liveCheckCharts, "pending");
    return;
  }

  const slots = getLiveReadySlots();
  if (!slots.length) {
    ui.liveChartsRoot.classList.remove("empty-state");
    ui.liveChartsRoot.innerHTML = `
      <div class="chart-empty">
        <p>No successful slot data available.</p>
        ${renderLiveChartFailures()}
      </div>
    `;
    setLoadCheck(ui.liveCheckCharts, "error");
    return;
  }

  const baseSlot = slots.find((slot) => slot.id === "A") || slots[0];
  const activeBands = getLiveActiveBandFilterSet();
  liveState.chart.selectedBands = sortBands(Array.from(activeBands));
  const rankingBand = activeBands.size === 1 ? Array.from(activeBands)[0] : "";
  const ranking = getOrBuildRanking(baseSlot, rankingBand);
  const callsignLegend = renderCallsignLegend(slots);
  const cardsOrder = CONTINENT_ORDER.map((continent) => {
    const list = ranking?.byContinent.get(continent) || [];
    return {
      continent,
      list,
      topCount: list[0]?.count || 0,
    };
  }).sort((a, b) => {
    if (b.topCount !== a.topCount) return b.topCount - a.topCount;
    return continentSort(a.continent, b.continent);
  });

  const cardsHtml = cardsOrder
    .map(({ continent, list }) => {
      const saved = String(liveState.chart.selectedByContinent[continent] || "");
      const selectedSpotter = saved && list.some((item) => item.spotter === saved) ? saved : list[0]?.spotter || "";
      if (selectedSpotter) liveState.chart.selectedByContinent[continent] = selectedSpotter;

      const options = list.length
        ? list
            .slice(0, 80)
            .map(
              (item) =>
                `<option value="${escapeHtml(item.spotter)}" ${item.spotter === selectedSpotter ? "selected" : ""}>${escapeHtml(item.spotter)} (${formatNumber(item.count)})</option>`,
            )
            .join("")
        : "<option value=''>No skimmers</option>";

      const statusText = list.length ? "" : `No RBN spots found for ${continentLabel(continent)}.`;

      return `
        <article class="rbn-signal-card">
          <div class="rbn-signal-head">
            <h4>${continentLabel(continent)} skimmer</h4>
            <label class="rbn-signal-picker" aria-label="${continentLabel(continent)} skimmer selector">
              <select class="rbn-signal-select" data-continent="${continent}" ${list.length ? "" : "disabled"}>
                ${options}
              </select>
            </label>
            <button type="button" class="rbn-copy-btn" title="Copy as image" aria-label="Copy as image">Copy as image</button>
            <span class="rbn-signal-status" ${list.length ? "hidden" : ""}>${statusText}</span>
          </div>
          <div class="rbn-signal-body">
            <div class="rbn-signal-plot">
              <canvas class="rbn-signal-canvas" data-continent="${continent}" data-spotter="${escapeHtml(selectedSpotter)}" data-height="280"></canvas>
              <div class="rbn-zoom-brush" hidden aria-hidden="true"></div>
              <div class="rbn-signal-meta">0 points plotted · SNR range: N/A</div>
            </div>
            <div class="rbn-signal-side">
              <div class="rbn-signal-legend">
                <h5>Bands (click to filter)</h5>
                <span class="rbn-signal-legend-bands"></span>
              </div>
              <div class="rbn-signal-calls">
                <h5>Callsigns</h5>
                <div class="rbn-signal-calls-list">
                  ${callsignLegend}
                </div>
              </div>
            </div>
          </div>
        </article>
      `;
    })
    .join("");

  ui.liveChartsRoot.classList.remove("empty-state");
  ui.liveChartsRoot.innerHTML = `
    ${renderLiveChartFailures()}
    <div class="rbn-signal-grid">${cardsHtml}</div>
  `;

  setLoadCheck(ui.liveCheckCharts, "ok");
  bindLiveChartInteractions(slots);
}

function teardownSkimmerChartObservers() {
  if (skimmerState.chart.resizeObserver) {
    skimmerState.chart.resizeObserver.disconnect();
    skimmerState.chart.resizeObserver = null;
  }
  if (skimmerState.chart.intersectionObserver) {
    skimmerState.chart.intersectionObserver.disconnect();
    skimmerState.chart.intersectionObserver = null;
  }
  if (skimmerState.chart.drawRaf) {
    cancelAnimationFrame(skimmerState.chart.drawRaf);
    skimmerState.chart.drawRaf = 0;
  }
}

function getSkimmerReadySlots() {
  return (skimmerState.analysis?.slots || []).filter((slot) => slot.status === "ready");
}

function getSkimmerActiveBandFilterSet() {
  return new Set((skimmerState.chart.selectedBands || []).map((band) => normalizeBandToken(band)).filter(Boolean));
}

function drawSkimmerCharts(slots) {
  const canvases = Array.from(ui.skimmerChartsRoot.querySelectorAll(".rbn-signal-canvas")).filter((canvas) => {
    if (!(canvas instanceof HTMLCanvasElement)) return false;
    if (!skimmerState.chart.intersectionObserver) return true;
    return canvas.dataset.visible === "1";
  });
  if (!canvases.length) return;

  const { minTs: globalMinTs, maxTs: globalMaxTs } = getGlobalTimeRange(slots);
  const availableBands = getAvailableBands(slots);
  const bandFilterSet = getSkimmerActiveBandFilterSet();

  for (const canvas of canvases) {
    const card = canvas.closest(".rbn-signal-card");
    const continent = String(canvas.dataset.continent || "N/A").toUpperCase();
    const spotter = String(canvas.dataset.spotter || "");

    const zoomRange = resolveChartViewRange(globalMinTs, globalMaxTs, skimmerState.chart.zoomByContinent[continent]);
    const minTs = zoomRange.minTs;
    const maxTs = zoomRange.maxTs;

    if (!spotter) {
      drawRbnSignalCanvas(canvas, {
        title: `${continentLabel(continent)} · no skimmer`,
        minTs,
        maxTs,
        minY: -30,
        maxY: 40,
        series: [],
        trendlines: [],
      });
      if (card) {
        updateCardLegend(card, availableBands, bandFilterSet);
        updateCardMeta(card, 0, null, null);
      }
      canvas.dataset.globalMinTs = String(globalMinTs);
      canvas.dataset.globalMaxTs = String(globalMaxTs);
      canvas.dataset.viewMinTs = String(minTs);
      canvas.dataset.viewMaxTs = String(maxTs);
      continue;
    }

    const model = computeSeriesForSpotter(slots, spotter, bandFilterSet);
    let minY = Number(model.minSnr);
    let maxY = Number(model.maxSnr);
    if (!Number.isFinite(minY) || !Number.isFinite(maxY)) {
      minY = -30;
      maxY = 40;
    } else if (minY === maxY) {
      minY -= 5;
      maxY += 5;
    } else {
      const pad = Math.max(2, (maxY - minY) * 0.08);
      minY -= pad;
      maxY += pad;
    }

    const trendlines = buildTrendlines(model.series, minTs, maxTs);
    const title = `${continentLabel(continent)} · ${spotter}`;

    drawRbnSignalCanvas(canvas, {
      title,
      minTs,
      maxTs,
      minY,
      maxY,
      series: model.series,
      trendlines,
    });

    if (card) {
      updateCardLegend(card, availableBands, bandFilterSet);
      updateCardMeta(card, model.pointTotal, model.minSnr, model.maxSnr);
    }

    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", `${title}. ${formatNumber(model.pointTotal)} points plotted.`);
    canvas.dataset.globalMinTs = String(globalMinTs);
    canvas.dataset.globalMaxTs = String(globalMaxTs);
    canvas.dataset.viewMinTs = String(minTs);
    canvas.dataset.viewMaxTs = String(maxTs);
  }
}

function scheduleSkimmerChartDraw(slots) {
  if (skimmerState.chart.drawRaf) return;
  skimmerState.chart.drawRaf = requestAnimationFrame(() => {
    skimmerState.chart.drawRaf = 0;
    drawSkimmerCharts(slots);
  });
}

function bindSkimmerChartInteractions(slots) {
  teardownSkimmerChartObservers();

  const selects = Array.from(ui.skimmerChartsRoot.querySelectorAll(".rbn-signal-select"));
  for (const select of selects) {
    select.addEventListener("change", (event) => {
      const target = event.currentTarget;
      const continent = String(target.dataset.continent || "N/A").toUpperCase();
      const spotter = String(target.value || "");
      skimmerState.chart.selectedByContinent[continent] = spotter;
      const canvas = target.closest(".rbn-signal-card")?.querySelector(".rbn-signal-canvas");
      if (canvas) canvas.dataset.spotter = spotter;
      scheduleSkimmerChartDraw(slots);
    });
  }

  const canvases = Array.from(ui.skimmerChartsRoot.querySelectorAll(".rbn-signal-canvas"));
  bindZoomInteractions(canvases, skimmerState.chart, scheduleSkimmerChartDraw, slots);
  if (typeof ResizeObserver === "function") {
    skimmerState.chart.resizeObserver = new ResizeObserver(() => scheduleSkimmerChartDraw(slots));
    for (const canvas of canvases) {
      skimmerState.chart.resizeObserver.observe(canvas);
    }
  }

  if (typeof IntersectionObserver === "function") {
    skimmerState.chart.intersectionObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const target = entry.target;
          if (!(target instanceof HTMLCanvasElement)) continue;
          target.dataset.visible = entry.isIntersecting ? "1" : "0";
        }
        scheduleSkimmerChartDraw(slots);
      },
      { root: null, threshold: 0.05, rootMargin: "120px 0px" },
    );

    for (const canvas of canvases) {
      canvas.dataset.visible = "0";
      skimmerState.chart.intersectionObserver.observe(canvas);
    }
  } else {
    for (const canvas of canvases) {
      canvas.dataset.visible = "1";
    }
  }

  scheduleSkimmerChartDraw(slots);
}

function renderSkimmerChartFailures() {
  const failed = (skimmerState.analysis?.slots || []).filter((slot) => slot.status === "error" || slot.status === "qrx");
  if (!failed.length) return "";
  return `
    <div class="chart-failures">
      ${failed
        .map((slot) => {
          if (slot.status === "qrx") {
            const wait = Math.ceil(Math.max(0, Number(slot.retryAfterMs) || 0) / 1000);
            const text = wait ? `Rate limited, will auto retry in ~${wait}s` : "Rate limited, will auto retry.";
            return `<p><b>${slotTitle(slot)} (${escapeHtml(slot.call)})</b>: ${text}</p>`;
          }
          return `<p><b>${slotTitle(slot)} (${escapeHtml(slot.call)})</b>: ${escapeHtml(slot.error || "Failed")}</p>`;
        })
        .join("")}
    </div>
  `;
}

function renderSkimmerAnalysisCharts() {
  if (ui.skimmerChartsNote) ui.skimmerChartsNote.hidden = Boolean(skimmerState.analysis);

  if (!skimmerState.analysis) {
    ui.skimmerChartsRoot.classList.add("empty-state");
    ui.skimmerChartsRoot.innerHTML = "<p>No skimmer comparison results yet.</p>";
    setLoadCheck(ui.skimmerCheckCharts, "pending");
    return;
  }

  const slots = getSkimmerReadySlots();
  if (!slots.length) {
    ui.skimmerChartsRoot.classList.remove("empty-state");
    ui.skimmerChartsRoot.innerHTML = `
      <div class="chart-empty">
        <p>No successful slot data available.</p>
        ${renderSkimmerChartFailures()}
      </div>
    `;
    setLoadCheck(ui.skimmerCheckCharts, "error");
    return;
  }

  const baseSlot = slots.find((slot) => slot.id === "A") || slots[0];
  const activeBands = getSkimmerActiveBandFilterSet();
  skimmerState.chart.selectedBands = sortBands(Array.from(activeBands));
  const rankingBand = activeBands.size === 1 ? Array.from(activeBands)[0] : "";
  const ranking = getOrBuildRankingByP75(baseSlot, rankingBand, { minSamples: 1 });
  const callsignLegend = renderCallsignLegend(slots);

  const mergedMap = new Map();
  for (const continent of CONTINENT_ORDER) {
    const list = ranking?.byContinent.get(continent) || [];
    for (const item of list) {
      const spotter = String(item?.spotter || "");
      if (!spotter) continue;
      const count = Number(item?.count || 0);
      const p75 = Number(item?.p75);
      const prev = mergedMap.get(spotter);
      if (!prev || count > prev.count) {
        mergedMap.set(spotter, {
          spotter,
          count,
          p75: Number.isFinite(p75) ? p75 : prev?.p75 ?? null,
        });
      }
    }
  }

  const listByCount = Array.from(mergedMap.values()).sort((a, b) => {
    const countDiff = Number(b?.count || 0) - Number(a?.count || 0);
    if (countDiff !== 0) return countDiff;
    return String(a?.spotter || "").localeCompare(String(b?.spotter || ""));
  });

  const key = "SCOPE";
  const saved = String(skimmerState.chart.selectedByContinent[key] || "");
  const selectedSpotter = saved && listByCount.some((item) => item.spotter === saved) ? saved : listByCount[0]?.spotter || "";
  if (selectedSpotter) skimmerState.chart.selectedByContinent[key] = selectedSpotter;

  const options = listByCount.length
    ? listByCount
        .slice(0, 200)
        .map(
          (item) =>
            `<option value="${escapeHtml(item.spotter)}" ${item.spotter === selectedSpotter ? "selected" : ""}>` +
            `${escapeHtml(item.spotter)} (${formatNumber(item.count)} spots${Number.isFinite(item.p75) ? ` · P75 ${Number(item.p75).toFixed(1)} dB` : ""})</option>`,
        )
        .join("")
    : "<option value=''>No spotted stations</option>";

  const statusText = listByCount.length ? "" : "No spotted stations found for the selected scope and time window.";

  const cardsHtml = `
    <article class="rbn-signal-card">
      <div class="rbn-signal-head">
        <h4>Target station</h4>
        <label class="rbn-signal-picker" aria-label="Target station selector">
          <select class="rbn-signal-select" data-continent="${key}" ${listByCount.length ? "" : "disabled"}>
            ${options}
          </select>
        </label>
        <button type="button" class="rbn-copy-btn" title="Copy as image" aria-label="Copy as image">Copy as image</button>
        <span class="rbn-signal-status" ${listByCount.length ? "hidden" : ""}>${statusText}</span>
      </div>
      <div class="rbn-signal-body">
        <div class="rbn-signal-plot">
          <canvas class="rbn-signal-canvas" data-continent="SCOPE" data-scope-label="Selected scope" data-spotter="${escapeHtml(selectedSpotter)}" data-height="320"></canvas>
          <div class="rbn-zoom-brush" hidden aria-hidden="true"></div>
          <div class="rbn-signal-meta">0 points plotted · SNR range: N/A</div>
        </div>
        <div class="rbn-signal-side">
          <div class="rbn-signal-legend">
            <h5>Bands (click to filter)</h5>
            <span class="rbn-signal-legend-bands"></span>
          </div>
          <div class="rbn-signal-calls">
            <h5>SKIMMER CALLSIGNS</h5>
            <div class="rbn-signal-calls-list">
              ${callsignLegend}
            </div>
          </div>
        </div>
      </div>
    </article>
  `;

  ui.skimmerChartsRoot.classList.remove("empty-state");
  ui.skimmerChartsRoot.innerHTML = `
    ${renderSkimmerChartFailures()}
    <div class="rbn-signal-grid">${cardsHtml}</div>
  `;

  setLoadCheck(ui.skimmerCheckCharts, "ok");
  bindSkimmerChartInteractions(slots);
}

function refreshFormState(options = {}) {
  const { silentStatus = false } = options;
  const model = collectInputModel();
  const validation = validateModel(model);
  syncStateFromModel(model);
  updateAnalysisFieldValidity(model);

  if (state.status === "running") {
    ui.startButton.disabled = true;
    setStartButtonMode("running");
    return { model, validation };
  }

  ui.startButton.disabled = !validation.ok;
  setStartButtonMode(validation.ok ? "ready" : "idle");
  const retryActive = state.retry.untilTs > Date.now();
  if (!silentStatus && !retryActive) {
    if (validation.ok) {
      setStatus("ready", validation.reason);
    } else {
      setStatus("idle", validation.reason);
    }
  }

  return { model, validation };
}

function handleInput() {
  if (state.retry.untilTs > Date.now() && state.status !== "running") {
    clearRetryCountdown();
  }
  refreshFormState();
}

function handleReset() {
  queueMicrotask(() => {
    clearRetryCountdown();
    state.datePickers.primary?.clear();
    state.datePickers.secondary?.clear();
    state.analysis = null;
    state.chart.selectedBands = [];
    state.chart.selectedByContinent = {};
    state.chart.zoomByContinent = {};
    teardownChartObservers();
    suggestSecondaryDateFromPrimary();
    resetLoadChecks();
    setStatus("idle", "Enter required fields to enable analysis.");
    renderAnalysisCharts();
    refreshFormState();
  });
}

function refreshLiveFormState(options = {}) {
  const { silentStatus = false } = options;
  const model = collectLiveInputModel();
  const validation = validateLiveInput(model);
  syncLiveStateFromModel(model);
  updateLiveFieldValidity(model);

  if (liveState.status === "running") {
    ui.liveStartButton.disabled = true;
    setLiveStartButtonMode("running");
    return { model, validation };
  }

  ui.liveStartButton.disabled = !validation.ok;
  setLiveStartButtonMode(validation.ok ? "ready" : "idle");
  if (!silentStatus) {
    if (validation.ok) {
      setLiveStatus("ready", validation.reason);
    } else {
      setLiveStatus("idle", validation.reason);
    }
  }
  return { model, validation };
}

function handleLiveInput() {
  clearLiveRetryCountdown();
  refreshLiveFormState();
}

function clearLiveRefreshTimer() {
  if (!liveState.refresh.timer) return;
  clearInterval(liveState.refresh.timer);
  liveState.refresh.timer = 0;
}

function shouldRunLiveRefreshTimer() {
  return state.activeChapter === "live" && !document.hidden && Boolean(liveState.refresh.lastModel);
}

function triggerLiveRefresh(reason = "interval") {
  if (!liveState.refresh.lastModel || liveState.refresh.inFlight) return;
  runLiveAnalysis(liveState.refresh.lastModel, { source: reason });
}

function syncLiveRefreshTimer() {
  if (!shouldRunLiveRefreshTimer()) {
    clearLiveRefreshTimer();
    return;
  }
  if (liveState.refresh.timer) return;
  liveState.refresh.timer = setInterval(() => triggerLiveRefresh("interval"), liveState.refresh.intervalMs);
}

function handleLiveReset() {
  queueMicrotask(() => {
    clearLiveRetryCountdown();
    liveState.analysis = null;
    liveState.chart.selectedBands = [];
    liveState.chart.selectedByContinent = {};
    liveState.chart.zoomByContinent = {};
    teardownLiveChartObservers();
    liveState.refresh.lastModel = null;
    liveState.refresh.inFlight = false;
    clearLiveRefreshTimer();
    resetLiveLoadChecks();
    setLiveStatus("idle", "Enter required fields to enable live analysis.");
    renderLiveAnalysisCharts();
    refreshLiveFormState();
  });
}

function setSkimmerRangeLastHours(hoursInput) {
  const hours = Math.max(1, Math.min(48, Number(hoursInput) || 6));
  const now = Date.now();
  const roundedNow = now - (now % (5 * 60 * 1000));
  const fromTs = roundedNow - hours * 3600 * 1000;
  const fromText = formatUtcTsToDateTimeDisplay(fromTs);
  const toText = formatUtcTsToDateTimeDisplay(roundedNow);
  if (ui.skimmerFrom) ui.skimmerFrom.value = fromText;
  if (ui.skimmerTo) ui.skimmerTo.value = toText;
  state.datePickers.skimmerFrom?.setDate(fromText, false, "d-m-Y H:i");
  state.datePickers.skimmerTo?.setDate(toText, false, "d-m-Y H:i");
}

function applySkimmerPreset(presetKey) {
  const key = String(presetKey || "").trim().toLowerCase();
  if (!ui.skimmerAreaType || !ui.skimmerAreaValue) return;

  if (key === "global_6h") {
    ui.skimmerAreaType.value = "GLOBAL";
    ui.skimmerAreaValue.value = "";
    setSkimmerRangeLastHours(6);
    return;
  }

  if (key === "eu_24h") {
    ui.skimmerAreaType.value = "CONTINENT";
    ui.skimmerAreaValue.value = "EU";
    setSkimmerRangeLastHours(24);
    return;
  }

  if (key === "dxcc_ja_12h") {
    ui.skimmerAreaType.value = "DXCC";
    ui.skimmerAreaValue.value = "JA";
    setSkimmerRangeLastHours(12);
  }
}

function focusSkimmerValidationSummary() {
  if (!ui.skimmerValidationSummary || ui.skimmerValidationSummary.hidden) return;
  ui.skimmerValidationSummary.focus({ preventScroll: false });
}

function refreshSkimmerFormState(options = {}) {
  const { silentStatus = false } = options;
  const model = collectSkimmerInputModel();

  const needsValue = model.areaType !== "GLOBAL";
  if (ui.skimmerAreaValue) {
    ui.skimmerAreaValue.placeholder = skimmerAreaPlaceholder(model.areaType);
    ui.skimmerAreaValue.inputMode = model.areaType === "CQ" || model.areaType === "ITU" ? "numeric" : "text";
    ui.skimmerAreaValue.disabled = !needsValue;
    if (!needsValue) {
      ui.skimmerAreaValue.value = "";
      model.areaValue = "";
    }
  }
  if (ui.skimmerHelpAreaValue) {
    ui.skimmerHelpAreaValue.textContent = skimmerAreaValueHelpText(model.areaType);
  }

  const validation = validateSkimmerInput(model);
  syncSkimmerStateFromModel(model);
  updateSkimmerFieldValidity(model, { showFeedback: skimmerState.validation.showErrors });

  if (skimmerState.status === "running") {
    ui.skimmerStartButton.disabled = true;
    setSkimmerStartButtonMode("running");
    return { model, validation };
  }

  ui.skimmerStartButton.disabled = !validation.ok;
  setSkimmerStartButtonMode(validation.ok ? "ready" : "idle");
  if (!silentStatus) {
    if (validation.ok) {
      setSkimmerStatus("ready", validation.reason);
    } else {
      setSkimmerStatus("idle", validation.reason);
    }
  }

  return { model, validation };
}

function handleSkimmerInput() {
  clearSkimmerRetryCountdown();
  skimmerState.validation.showErrors = true;
  refreshSkimmerFormState();
}

function handleSkimmerQuickActionClick(event) {
  const target = event.target;
  if (!(target instanceof Element)) return;

  const hoursButton = target.closest("[data-skimmer-hours]");
  if (hoursButton instanceof HTMLButtonElement) {
    event.preventDefault();
    skimmerState.validation.showErrors = true;
    setSkimmerRangeLastHours(Number(hoursButton.dataset.skimmerHours || 6));
    refreshSkimmerFormState();
    return;
  }

  const presetButton = target.closest("[data-skimmer-preset]");
  if (presetButton instanceof HTMLButtonElement) {
    event.preventDefault();
    skimmerState.validation.showErrors = true;
    applySkimmerPreset(presetButton.dataset.skimmerPreset || "");
    refreshSkimmerFormState();
  }
}

function focusSkimmerField(fieldId) {
  const map = {
    skimmerFrom: ui.skimmerFrom,
    skimmerTo: ui.skimmerTo,
    skimmerAreaType: ui.skimmerAreaType,
    skimmerAreaValue: ui.skimmerAreaValue,
    skimmerCallPrimary: ui.skimmerCallPrimary,
    skimmerCallCompare1: ui.skimmerCallCompare1,
    skimmerCallCompare2: ui.skimmerCallCompare2,
    skimmerCallCompare3: ui.skimmerCallCompare3,
  };
  const node = map[String(fieldId || "")];
  if (!node) return;
  node.focus({ preventScroll: false });
}

function handleSkimmerSummaryClick(event) {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const button = target.closest("[data-focus-field]");
  if (!(button instanceof HTMLButtonElement)) return;
  event.preventDefault();
  focusSkimmerField(button.dataset.focusField || "");
}

function handleSkimmerReset() {
  queueMicrotask(() => {
    clearSkimmerRetryCountdown();
    state.datePickers.skimmerFrom?.clear();
    state.datePickers.skimmerTo?.clear();
    skimmerState.analysis = null;
    skimmerState.chart.selectedBands = [];
    skimmerState.chart.selectedByContinent = {};
    skimmerState.chart.zoomByContinent = {};
    teardownSkimmerChartObservers();
    const now = Date.now();
    const roundedNow = now - (now % (5 * 60 * 1000));
    const defaultFrom = roundedNow - 6 * 3600 * 1000;
    if (ui.skimmerFrom) ui.skimmerFrom.value = formatUtcTsToDateTimeDisplay(defaultFrom);
    if (ui.skimmerTo) ui.skimmerTo.value = formatUtcTsToDateTimeDisplay(roundedNow);
    if (ui.skimmerAreaType) ui.skimmerAreaType.value = "GLOBAL";
    if (ui.skimmerAreaValue) ui.skimmerAreaValue.value = "";
    skimmerState.validation.showErrors = false;
    resetSkimmerLoadChecks();
    setSkimmerStatus("idle", "Enter required fields to enable skimmer comparison.");
    renderSkimmerAnalysisCharts();
    refreshSkimmerFormState();
  });
}

async function runSkimmerAnalysis(model, options = {}) {
  const source = String(options.source || "manual");
  const runToken = skimmerState.activeRunToken + 1;
  skimmerState.activeRunToken = runToken;
  resetSkimmerLoadChecks();
  setLoadCheck(ui.skimmerCheckCty, "loading");
  setSkimmerStatus("running", "Loading continent prefixes (cty.dat)...");
  ui.skimmerStartButton.disabled = true;
  setSkimmerStartButtonMode("running");

  try {
    const ctyState = await preloadCtyData();
    if (runToken !== skimmerState.activeRunToken) return;
    if (ctyState?.status === "ok") {
      setLoadCheck(ui.skimmerCheckCty, "ok");
    } else {
      setLoadCheck(ui.skimmerCheckCty, "error");
      throw new Error("cty.dat is required for skimmer area filtering.");
    }

    let effectiveModel = {
      ...model,
      comparisons: [...(model.comparisons || [])],
    };
    if (effectiveModel.areaType === "DXCC") {
      const rawDxccInput = String(effectiveModel.areaValue || "").trim();
      if (rawDxccInput) {
        const resolvedDxcc = resolveDxccFromInput(rawDxccInput);
        if (resolvedDxcc) {
          effectiveModel.areaValue = resolvedDxcc;
        } else if (/^[A-Z0-9/]{1,4}$/i.test(rawDxccInput)) {
          throw new Error(`DXCC prefix ${rawDxccInput.toUpperCase()} not found in cty.dat.`);
        }
      }
    }

    setLoadCheck(ui.skimmerCheckFetch, "loading");
    setSkimmerStatus("running", "Fetching RBN data for skimmer comparison...");
    const result = await runRbnSkimmerComparison(effectiveModel);
    if (runToken !== skimmerState.activeRunToken) return;
    setLoadCheck(ui.skimmerCheckFetch, "ok");

    skimmerState.chart.selectedBands = [];
    skimmerState.chart.selectedByContinent = {};
    skimmerState.chart.zoomByContinent = {};
    skimmerState.analysis = result;
    renderSkimmerAnalysisCharts();

    const loaded = result.slots.filter((slot) => slot.status === "ready").length;
    const qrxSlots = result.slots.filter((slot) => slot.status === "qrx");
    const failed = result.slots.filter((slot) => slot.status === "error" || slot.status === "qrx").length;
    if (failed && loaded) {
      setSkimmerStatus("ready", `Skimmer comparison completed with partial results (${loaded} loaded, ${failed} failed).`);
    } else if (failed && !loaded) {
      setSkimmerStatus("error", "Skimmer comparison failed for all callsigns.");
    } else if (!result.hasAnyData) {
      setSkimmerStatus("ready", "Skimmer comparison completed but no spots matched the selected filter.");
    } else {
      setSkimmerStatus("ready", `Skimmer comparison completed for ${loaded} callsign${loaded === 1 ? "" : "s"}.`);
    }

    if (qrxSlots.length && skimmerState.retry.attempts < skimmerState.retry.maxAttempts) {
      const retryMs = Math.max(...qrxSlots.map((slot) => Number(slot.retryAfterMs) || 15000));
      const baseMessage = `${qrxSlots.length} slot${qrxSlots.length === 1 ? "" : "s"} rate limited.`;
      startSkimmerRetryCountdown(retryMs, model, baseMessage);
    } else if (!qrxSlots.length) {
      clearSkimmerRetryCountdown();
    } else if (source !== "manual") {
      setSkimmerStatus("error", "Skimmer auto-retry limit reached. Please retry manually.");
    }
  } catch (error) {
    if (runToken !== skimmerState.activeRunToken) return;
    if (ui.skimmerCheckFetch?.dataset.state === "loading") setLoadCheck(ui.skimmerCheckFetch, "error");
    if (ui.skimmerCheckCty?.dataset.state === "loading") setLoadCheck(ui.skimmerCheckCty, "error");
    setLoadCheck(ui.skimmerCheckCharts, "error");
    setSkimmerStatus("error", error?.message || "Skimmer comparison failed.");
  } finally {
    if (runToken === skimmerState.activeRunToken) {
      const next = refreshSkimmerFormState({ silentStatus: true });
      if (next.validation.ok && skimmerState.status !== "running") {
        ui.skimmerStartButton.disabled = false;
      }
    }
  }
}

async function runLiveAnalysis(model, options = {}) {
  const source = String(options.source || "manual");
  liveState.refresh.inFlight = true;
  const runToken = liveState.activeRunToken + 1;
  liveState.activeRunToken = runToken;

  resetLiveLoadChecks();
  setLoadCheck(ui.liveCheckFetch, "loading");
  setLiveStatus("running", source === "manual" ? "Fetching live RBN data..." : "Refreshing live RBN data...");
  ui.liveStartButton.disabled = true;
  setLiveStartButtonMode("running");

  try {
    const result = await runRbnLiveAnalysis(model);
    if (runToken !== liveState.activeRunToken) return;
    setLoadCheck(ui.liveCheckFetch, "ok");

    setLoadCheck(ui.liveCheckCty, "loading");
    const ctyState = await preloadCtyData();
    if (runToken !== liveState.activeRunToken) return;
    if (ctyState?.status === "ok") {
      setLoadCheck(ui.liveCheckCty, "ok");
    } else if (ctyState?.status === "loading") {
      setLoadCheck(ui.liveCheckCty, "loading");
    } else {
      setLoadCheck(ui.liveCheckCty, "error");
    }

    liveState.analysis = result;
    renderLiveAnalysisCharts();

    const loaded = result.slots.filter((slot) => slot.status === "ready").length;
    const qrxSlots = result.slots.filter((slot) => slot.status === "qrx");
    const failed = result.slots.filter((slot) => slot.status === "error" || slot.status === "qrx").length;
    if (failed && loaded) {
      setLiveStatus("ready", `Live update completed with partial results (${loaded} loaded, ${failed} failed).`);
    } else if (failed && !loaded) {
      setLiveStatus("error", "Live update failed for all callsigns.");
    } else if (!result.hasAnyData) {
      setLiveStatus("ready", "Live update completed but no RBN spots matched selected callsigns.");
    } else {
      setLiveStatus("ready", `Live update completed for ${loaded} callsign${loaded === 1 ? "" : "s"}.`);
    }

    trackLiveRefreshEvent("live_refresh_success", {
      trigger: source,
      window_hours: Number(result.windowHours || model.windowHours || 24),
      callsign_count: 1 + (Array.isArray(model.comparisons) ? model.comparisons.length : 0),
      slots_loaded: loaded,
      duration_ms: Number(result.durationMs || 0),
    });

    liveState.refresh.lastModel = { ...model, comparisons: [...(model.comparisons || [])] };

    if (qrxSlots.length && liveState.retry.attempts < liveState.retry.maxAttempts) {
      const retryMs = Math.max(...qrxSlots.map((slot) => Number(slot.retryAfterMs) || 15000));
      const baseMessage = `${qrxSlots.length} slot${qrxSlots.length === 1 ? "" : "s"} rate limited.`;
      startLiveRetryCountdown(retryMs, model, baseMessage);
    } else if (!qrxSlots.length) {
      clearLiveRetryCountdown();
    } else if (source !== "manual") {
      setLiveStatus("error", "Live auto-retry limit reached. Please retry manually.");
    }
  } catch (error) {
    if (runToken !== liveState.activeRunToken) return;
    if (ui.liveCheckFetch?.dataset.state === "loading") {
      setLoadCheck(ui.liveCheckFetch, "error");
    }
    if (ui.liveCheckCty?.dataset.state === "loading") {
      setLoadCheck(ui.liveCheckCty, "error");
    }
    setLiveStatus("error", error?.message || "Live analysis run failed.");
    trackLiveRefreshEvent("live_refresh_error", {
      trigger: source,
      window_hours: Number(model?.windowHours || 24),
      callsign_count: 1 + (Array.isArray(model?.comparisons) ? model.comparisons.length : 0),
      error_message: String(error?.message || "Live analysis run failed."),
    });
  } finally {
    if (runToken === liveState.activeRunToken) {
      liveState.refresh.inFlight = false;
      const next = refreshLiveFormState({ silentStatus: true });
      if (next.validation.ok && liveState.status !== "running") {
        ui.liveStartButton.disabled = false;
      }
    }
    syncLiveRefreshTimer();
  }
}

async function handleLiveSubmit(event) {
  event.preventDefault();
  const { model, validation } = refreshLiveFormState({ silentStatus: true });
  if (!validation.ok) {
    setLiveStatus("error", validation.reason);
    return;
  }
  clearLiveRetryCountdown();
  liveState.retry.attempts = 0;
  liveState.chart.zoomByContinent = {};
  trackCallsignEntryEvents(model);
  liveState.refresh.lastModel = { ...model, comparisons: [...(model.comparisons || [])] };
  await runLiveAnalysis(model, { source: "manual" });
}

async function handleSkimmerSubmit(event) {
  event.preventDefault();
  const { model, validation } = refreshSkimmerFormState({ silentStatus: true });
  if (!validation.ok) {
    skimmerState.validation.showErrors = true;
    const refreshed = refreshSkimmerFormState({ silentStatus: true });
    focusSkimmerValidationSummary();
    setSkimmerStatus("error", refreshed.validation.reason);
    return;
  }
  clearSkimmerRetryCountdown();
  skimmerState.retry.attempts = 0;
  skimmerState.chart.zoomByContinent = {};
  trackCallsignEntryEvents(model);
  await runSkimmerAnalysis(model);
}

async function runHistoricalAnalysis(model, options = {}) {
  const source = String(options.source || "manual");
  const runToken = state.activeRunToken + 1;
  state.activeRunToken = runToken;
  resetLoadChecks();
  setLoadCheck(ui.checkFetch, "loading");
  setStatus("running", "Fetching RBN data for selected callsigns...");
  ui.startButton.disabled = true;
  setStartButtonMode("running");

  try {
    const result = await runRbnAnalysis(model);
    if (runToken !== state.activeRunToken) return;
    setLoadCheck(ui.checkFetch, "ok");

    setLoadCheck(ui.checkCty, "loading");
    setStatus("running", "Loading continent prefixes (cty.dat)...");
    const ctyState = await preloadCtyData();
    if (runToken !== state.activeRunToken) return;
    if (ctyState?.status === "ok") {
      setLoadCheck(ui.checkCty, "ok");
    } else if (ctyState?.status === "loading") {
      setLoadCheck(ui.checkCty, "loading");
    } else {
      setLoadCheck(ui.checkCty, "error");
    }

    state.analysis = result;
    renderAnalysisCharts();

    const loaded = result.slots.filter((slot) => slot.status === "ready").length;
    const qrxSlots = result.slots.filter((slot) => slot.status === "qrx");
    const failed = result.slots.filter((slot) => slot.status === "error" || slot.status === "qrx").length;
    const hasData = result.slots.some((slot) => slot.status === "ready" && (slot.totalOfUs > 0 || slot.totalByUs > 0));

    if (failed && loaded && hasData) {
      setStatus("ready", `Analysis completed with partial results (${loaded} loaded, ${failed} failed).`);
    } else if (failed && loaded && !hasData) {
      setStatus("ready", `Analysis loaded but found no spots (${loaded} loaded, ${failed} failed).`);
    } else if (failed && !loaded) {
      setStatus("error", "Analysis failed for all callsigns.");
    } else if (!hasData) {
      setStatus("ready", "Analysis completed but no RBN spots matched the selected callsigns/dates.");
    } else {
      setStatus("ready", `Analysis completed for ${loaded} callsign${loaded === 1 ? "" : "s"}.`);
    }

    if (qrxSlots.length) {
      const retryMs = Math.max(...qrxSlots.map((slot) => Number(slot.retryAfterMs) || 15000));
      const baseMessage = loaded
        ? `Partial results shown. ${qrxSlots.length} slot${qrxSlots.length === 1 ? "" : "s"} rate limited.`
        : `Rate limited for ${qrxSlots.length} slot${qrxSlots.length === 1 ? "" : "s"}.`;
      if (state.retry.attempts < state.retry.maxAttempts) {
        startRetryCountdown(retryMs, baseMessage, loaded ? "ready" : "error", {
          autoRetry: true,
          trigger: async () => {
            if (!state.retry.model) return;
            await runHistoricalAnalysis(state.retry.model, { source: "auto_retry" });
          },
        });
      } else if (source !== "manual") {
        setStatus("error", "Historical auto-retry limit reached. Please retry manually.");
      }
    } else {
      clearRetryCountdown();
    }
  } catch (error) {
    if (runToken !== state.activeRunToken) return;
    if (ui.checkFetch?.dataset.state === "loading") {
      setLoadCheck(ui.checkFetch, "error");
    }
    if (ui.checkCty?.dataset.state === "loading") {
      setLoadCheck(ui.checkCty, "error");
    }
    setLoadCheck(ui.checkCharts, "error");
    setStatus("error", error?.message || "Analysis run failed.");
  } finally {
    if (runToken === state.activeRunToken) {
      const next = refreshFormState({ silentStatus: true });
      if (next.validation.ok && state.status !== "running") {
        ui.startButton.disabled = false;
      }
    }
  }
}

async function handleSubmit(event) {
  event.preventDefault();
  const { model, validation } = refreshFormState({ silentStatus: true });
  if (!validation.ok) {
    setStatus("error", validation.reason);
    return;
  }
  trackCallsignEntryEvents(model);
  clearRetryCountdown();
  state.retry.attempts = 0;
  state.chart.zoomByContinent = {};
  state.retry.model = { ...model, comparisons: [...(model.comparisons || [])] };
  await runHistoricalAnalysis(model, { source: "manual" });
}

function handleLegendBandClick(event) {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const button = target.closest(".rbn-legend-toggle");
  if (!button) return;
  const root = button.closest(".charts-root");
  if (!root) return;
  const isLive = root === ui.liveChartsRoot;
  const isSkimmer = root === ui.skimmerChartsRoot;
  const token = String(button.dataset.band || "");
  if (token === "__ALL__") {
    if (isLive) {
      liveState.chart.selectedBands = [];
      renderLiveAnalysisCharts();
    } else if (isSkimmer) {
      skimmerState.chart.selectedBands = [];
      renderSkimmerAnalysisCharts();
    } else {
      state.chart.selectedBands = [];
      renderAnalysisCharts();
    }
    return;
  }
  const band = normalizeBandToken(token);
  if (!band) return;
  // Single-select behavior: clicking a band focuses that one band only.
  if (isLive) {
    liveState.chart.selectedBands = [band];
    renderLiveAnalysisCharts();
  } else if (isSkimmer) {
    skimmerState.chart.selectedBands = [band];
    renderSkimmerAnalysisCharts();
  } else {
    state.chart.selectedBands = [band];
    renderAnalysisCharts();
  }
}

function sanitizeFilenameToken(value, fallback = "item") {
  const safe = String(value == null ? "" : value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return safe || fallback;
}

function downloadBlobFile(blob, filename) {
  if (!(blob instanceof Blob)) return;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename || "image.png";
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 1200);
}

function canvasToBlobAsync(canvas, type = "image/png", quality) {
  return new Promise((resolve, reject) => {
    if (!(canvas instanceof HTMLCanvasElement)) {
      reject(new Error("Invalid canvas"));
      return;
    }
    if (canvas.toBlob) {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Failed to create PNG blob"));
      }, type, quality);
      return;
    }
    try {
      const dataUrl = canvas.toDataURL(type, quality);
      const payload = dataUrl.split(",")[1] || "";
      const bytes = atob(payload);
      const buffer = new Uint8Array(bytes.length);
      for (let i = 0; i < bytes.length; i += 1) buffer[i] = bytes.charCodeAt(i);
      resolve(new Blob([buffer], { type }));
    } catch (err) {
      reject(err);
    }
  });
}

function loadImageFromUrl(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Unable to load rendered SVG image"));
    img.src = url;
  });
}

function loadHtml2CanvasLibrary() {
  if (typeof window.html2canvas === "function") {
    return Promise.resolve(window.html2canvas);
  }
  if (html2CanvasLoadPromise) return html2CanvasLoadPromise;
  html2CanvasLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js";
    script.async = true;
    script.crossOrigin = "anonymous";
    script.referrerPolicy = "strict-origin-when-cross-origin";
    script.onload = () => {
      if (typeof window.html2canvas === "function") {
        resolve(window.html2canvas);
      } else {
        reject(new Error("html2canvas loaded but API is unavailable"));
      }
    };
    script.onerror = () => reject(new Error("Failed to load html2canvas"));
    document.head.appendChild(script);
  }).catch((err) => {
    html2CanvasLoadPromise = null;
    throw err;
  });
  return html2CanvasLoadPromise;
}

function copyComputedStyleToNode(sourceNode, targetNode) {
  if (!(sourceNode instanceof Element) || !(targetNode instanceof Element)) return;
  const computed = window.getComputedStyle(sourceNode);
  for (let i = 0; i < computed.length; i += 1) {
    const prop = computed[i];
    targetNode.style.setProperty(prop, computed.getPropertyValue(prop), computed.getPropertyPriority(prop));
  }
}

function inlineComputedStylesDeep(sourceRoot, cloneRoot) {
  if (!(sourceRoot instanceof Element) || !(cloneRoot instanceof Element)) return;
  copyComputedStyleToNode(sourceRoot, cloneRoot);
  const sourceChildren = Array.from(sourceRoot.children);
  const cloneChildren = Array.from(cloneRoot.children);
  const count = Math.min(sourceChildren.length, cloneChildren.length);
  for (let i = 0; i < count; i += 1) {
    inlineComputedStylesDeep(sourceChildren[i], cloneChildren[i]);
  }
}

function replaceCanvasWithImageSnapshots(sourceRoot, cloneRoot) {
  if (!(sourceRoot instanceof Element) || !(cloneRoot instanceof Element)) return;
  const sourceCanvases = Array.from(sourceRoot.querySelectorAll("canvas"));
  const cloneCanvases = Array.from(cloneRoot.querySelectorAll("canvas"));
  const count = Math.min(sourceCanvases.length, cloneCanvases.length);
  for (let i = 0; i < count; i += 1) {
    const sourceCanvas = sourceCanvases[i];
    const cloneCanvas = cloneCanvases[i];
    if (!(sourceCanvas instanceof HTMLCanvasElement) || !(cloneCanvas instanceof HTMLCanvasElement)) continue;
    let dataUrl = "";
    try {
      dataUrl = sourceCanvas.toDataURL("image/png");
    } catch {
      dataUrl = "";
    }
    if (!dataUrl) continue;
    const image = document.createElement("img");
    image.src = dataUrl;
    image.alt = sourceCanvas.getAttribute("aria-label") || "Graph image";
    copyComputedStyleToNode(sourceCanvas, image);
    const width = sourceCanvas.clientWidth || sourceCanvas.width || 1;
    const height = sourceCanvas.clientHeight || sourceCanvas.height || 1;
    image.style.width = `${Math.max(1, Math.round(width))}px`;
    image.style.height = `${Math.max(1, Math.round(height))}px`;
    image.width = Math.max(1, Math.round(width));
    image.height = Math.max(1, Math.round(height));
    image.style.display = "block";
    cloneCanvas.replaceWith(image);
  }
}

function applyRbnSignalExportLayout(root) {
  if (!(root instanceof Element)) return;
  root.querySelectorAll(".rbn-signal-side").forEach((side) => {
    side.style.overflowX = "visible";
    side.style.overflowY = "visible";
  });
  root.querySelectorAll(".rbn-signal-legend").forEach((legend) => {
    legend.style.overflowX = "visible";
    legend.style.overflowY = "visible";
    legend.style.flexWrap = "wrap";
    legend.style.alignItems = "flex-start";
  });
  root.querySelectorAll(".rbn-signal-calls").forEach((calls) => {
    calls.style.flexWrap = "wrap";
    calls.style.alignItems = "flex-start";
  });
  root.querySelectorAll(".rbn-signal-legend-bands").forEach((bands) => {
    bands.style.flexWrap = "wrap";
    bands.style.overflow = "visible";
    bands.style.whiteSpace = "normal";
  });
  root.querySelectorAll(".rbn-signal-calls-list").forEach((callsList) => {
    callsList.style.flexWrap = "wrap";
    callsList.style.overflow = "visible";
    callsList.style.whiteSpace = "normal";
  });
}

async function renderElementToPngBlob(element, options = {}) {
  if (!(element instanceof HTMLElement)) {
    throw new Error("Element not found");
  }
  const rect = element.getBoundingClientRect();
  const baseWidth = Math.max(1, Math.ceil(rect.width || element.offsetWidth || 1));
  const clone = element.cloneNode(true);
  if (!(clone instanceof HTMLElement)) {
    throw new Error("Unable to clone element");
  }
  inlineComputedStylesDeep(element, clone);
  replaceCanvasWithImageSnapshots(element, clone);
  if (typeof options.prepareClone === "function") {
    options.prepareClone(clone);
  }

  const host = document.createElement("div");
  host.style.position = "fixed";
  host.style.left = "-100000px";
  host.style.top = "0";
  host.style.opacity = "0";
  host.style.pointerEvents = "none";
  host.style.zIndex = "-1";
  host.style.width = `${baseWidth}px`;
  clone.style.width = `${baseWidth}px`;
  clone.style.maxWidth = `${baseWidth}px`;
  host.appendChild(clone);
  document.body.appendChild(host);
  let width = baseWidth;
  let height = Math.max(1, Math.ceil(element.getBoundingClientRect().height || element.offsetHeight || 1));
  let serialized = "";
  try {
    if (document.fonts && document.fonts.ready) {
      try {
        await document.fonts.ready;
      } catch {
        // Continue even when fonts cannot be awaited.
      }
    }

    const measureRect = clone.getBoundingClientRect();
    width = Math.max(1, Math.ceil(measureRect.width || baseWidth));
    height = Math.max(1, Math.ceil(measureRect.height || clone.scrollHeight || element.scrollHeight || 1));

    const wrapper = document.createElement("div");
    wrapper.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
    wrapper.style.width = `${width}px`;
    wrapper.style.height = `${height}px`;
    wrapper.style.boxSizing = "border-box";
    wrapper.appendChild(clone);
    serialized = new XMLSerializer().serializeToString(wrapper);
  } finally {
    if (host.parentNode) host.parentNode.removeChild(host);
  }
  if (!serialized) throw new Error("Failed to serialize graph content");

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<foreignObject x="0" y="0" width="100%" height="100%">${serialized}</foreignObject></svg>`;
  const svgBlob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const svgUrl = URL.createObjectURL(svgBlob);
  try {
    const img = await loadImageFromUrl(svgUrl);
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas context unavailable");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    return await canvasToBlobAsync(canvas, "image/png");
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

async function renderElementToPngBlobWithHtml2Canvas(element) {
  if (!(element instanceof HTMLElement)) {
    throw new Error("Element not found");
  }
  const html2canvas = await loadHtml2CanvasLibrary();
  const token = `rbn-export-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  element.dataset.exportToken = token;
  try {
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const canvas = await html2canvas(element, {
      backgroundColor: "#ffffff",
      scale: dpr,
      useCORS: true,
      logging: false,
      onclone: (doc) => {
        const clone = doc.querySelector(`[data-export-token="${token}"]`);
        if (clone) applyRbnSignalExportLayout(clone);
      },
    });
    return await canvasToBlobAsync(canvas, "image/png");
  } finally {
    delete element.dataset.exportToken;
  }
}

async function copyImageBlobToClipboard(blob) {
  if (!(blob instanceof Blob)) return false;
  if (!(navigator.clipboard && navigator.clipboard.write) || typeof ClipboardItem === "undefined") {
    return false;
  }
  try {
    const item = new ClipboardItem({ [blob.type || "image/png"]: blob });
    await navigator.clipboard.write([item]);
    return true;
  } catch {
    return false;
  }
}

async function copyCardAsImage(card, button) {
  if (!(card instanceof HTMLElement) || !(button instanceof HTMLButtonElement)) return;
  const body = card.querySelector(".rbn-signal-body");
  if (!(body instanceof HTMLElement)) {
    button.dataset.state = "error";
    button.title = "Graph not found";
    return;
  }

  const prevState = button.dataset.state || "";
  const prevTitle = button.title || "Copy as image";
  const prevText = button.textContent || "Copy as image";
  const continent = String(card.querySelector(".rbn-signal-select")?.dataset.continent || "N/A").trim().toUpperCase() || "N/A";
  const spotter = String(card.querySelector(".rbn-signal-select")?.value || "spotter").trim() || "spotter";
  const filename = `rbn_compare_signal_${sanitizeFilenameToken(continent)}_${sanitizeFilenameToken(spotter)}.png`;

  button.disabled = true;
  button.dataset.state = "";
  button.title = "Preparing image...";
  button.textContent = "Copying...";

  try {
    let blob = null;
    try {
      blob = await renderElementToPngBlob(body, {
        prepareClone: applyRbnSignalExportLayout,
      });
    } catch (primaryErr) {
      console.warn("Primary graph export failed, trying html2canvas fallback:", primaryErr);
      blob = await renderElementToPngBlobWithHtml2Canvas(body);
    }

    const copied = await copyImageBlobToClipboard(blob);
    if (copied) {
      button.dataset.state = "copied";
      button.title = "Copied to clipboard";
      button.textContent = "Copied";
    } else {
      downloadBlobFile(blob, filename);
      button.dataset.state = "copied";
      button.title = "Clipboard unavailable, PNG downloaded";
      button.textContent = "Downloaded";
    }
  } catch (err) {
    console.error("Copy graph as image failed:", err);
    button.dataset.state = "error";
    button.title = "Unable to copy or download image";
    button.textContent = "Copy failed";
  } finally {
    setTimeout(() => {
      button.dataset.state = prevState;
      button.title = prevTitle;
      button.textContent = prevText;
    }, 1500);
    button.disabled = false;
  }
}

function handleCopyCardClick(event) {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const button = target.closest(".rbn-copy-btn");
  if (!button) return;
  const root = button.closest(".charts-root");
  if (!root || (root !== ui.chartsRoot && root !== ui.liveChartsRoot && root !== ui.skimmerChartsRoot)) return;
  const card = button.closest(".rbn-signal-card");
  if (!card) return;
  copyCardAsImage(card, button);
}

function handleChapterTabClick(event) {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const button = target.closest("[data-chapter-tab]");
  if (!(button instanceof HTMLButtonElement)) return;
  setActiveChapter(button.dataset.chapterTab || "historical");
}

function handleChapterTabKeydown(event) {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const button = target.closest("[data-chapter-tab]");
  if (!(button instanceof HTMLButtonElement)) return;
  if (!TAB_NAV_KEYS.has(event.key)) return;
  event.preventDefault();

  const tabs = ui.chapterTabs.filter((tab) => tab instanceof HTMLButtonElement);
  const currentIndex = tabs.indexOf(button);
  if (currentIndex < 0) return;

  let nextIndex = currentIndex;
  if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % tabs.length;
  if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
  if (event.key === "Home") nextIndex = 0;
  if (event.key === "End") nextIndex = tabs.length - 1;

  const next = tabs[nextIndex];
  if (!next) return;
  setActiveChapter(next.dataset.chapterTab || "historical");
  next.focus();
}

function bindEvents() {
  const onDatePrimaryChange = () => {
    suggestSecondaryDateFromPrimary();
    refreshFormState();
  };
  ui.datePrimary.addEventListener("change", onDatePrimaryChange);
  ui.datePrimary.addEventListener("input", onDatePrimaryChange);
  ui.dateSecondary.addEventListener("focus", suggestSecondaryDateFromPrimary);
  ui.dateSecondary.addEventListener("change", refreshFormState);
  ui.callPrimary.addEventListener("change", refreshFormState);
  ui.callCompare1.addEventListener("change", refreshFormState);
  ui.callCompare2.addEventListener("change", refreshFormState);
  ui.callCompare3.addEventListener("change", refreshFormState);
  ui.form.addEventListener("input", handleInput);
  ui.form.addEventListener("submit", handleSubmit);
  ui.form.addEventListener("reset", handleReset);
  ui.liveForm.addEventListener("input", handleLiveInput);
  ui.liveForm.addEventListener("submit", handleLiveSubmit);
  ui.liveForm.addEventListener("reset", handleLiveReset);
  ui.skimmerForm.addEventListener("input", handleSkimmerInput);
  ui.skimmerAreaType.addEventListener("change", handleSkimmerInput);
  ui.skimmerForm.addEventListener("click", handleSkimmerQuickActionClick);
  ui.skimmerForm.addEventListener("submit", handleSkimmerSubmit);
  ui.skimmerForm.addEventListener("reset", handleSkimmerReset);
  ui.skimmerValidationList?.addEventListener("click", handleSkimmerSummaryClick);
  ui.chartsRoot.addEventListener("click", handleLegendBandClick);
  ui.chartsRoot.addEventListener("click", handleCopyCardClick);
  ui.liveChartsRoot.addEventListener("click", handleLegendBandClick);
  ui.liveChartsRoot.addEventListener("click", handleCopyCardClick);
  ui.skimmerChartsRoot.addEventListener("click", handleLegendBandClick);
  ui.skimmerChartsRoot.addEventListener("click", handleCopyCardClick);
  document.addEventListener("visibilitychange", syncLiveRefreshTimer);
  for (const tab of ui.chapterTabs) {
    tab.addEventListener("click", handleChapterTabClick);
    tab.addEventListener("keydown", handleChapterTabKeydown);
  }
}

function preloadBackgroundData() {
  preloadCtyData().catch(() => {
    // Keep fallback continent inference if cty.dat is unavailable.
  });
}

bindEvents();
initDatePickers();
preloadBackgroundData();
setActiveChapter(state.activeChapter);
resetLoadChecks();
resetLiveLoadChecks();
resetSkimmerLoadChecks();
renderAnalysisCharts();
renderLiveAnalysisCharts();
renderSkimmerAnalysisCharts();
refreshFormState();
refreshLiveFormState();
refreshSkimmerFormState();

export { validateModel };
