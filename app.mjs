const CALLSIGN_PATTERN = /^[A-Z0-9/-]{3,20}$/;

const state = {
  status: "idle",
  dates: [],
  slots: {
    A: { call: "" },
    B: { call: "" },
    C: { call: "" },
    D: { call: "" },
  },
  lastError: "",
};

const ui = {
  form: document.querySelector("#analysis-form"),
  datePrimary: document.querySelector("#date-primary"),
  dateSecondary: document.querySelector("#date-secondary"),
  callPrimary: document.querySelector("#call-primary"),
  callCompare1: document.querySelector("#call-compare-1"),
  callCompare2: document.querySelector("#call-compare-2"),
  callCompare3: document.querySelector("#call-compare-3"),
  startButton: document.querySelector("#start-analysis"),
  statusPill: document.querySelector("#status-pill"),
  statusMessage: document.querySelector("#status-message"),
  summary: document.querySelector("#run-summary"),
};

const summaryCells = {
  dates: ui.summary.querySelector("div:nth-child(1) dd"),
  primary: ui.summary.querySelector("div:nth-child(2) dd"),
  comparisons: ui.summary.querySelector("div:nth-child(3) dd"),
  status: ui.summary.querySelector("div:nth-child(4) dd"),
};

function normalizeCallsign(value) {
  return (value || "").trim().toUpperCase();
}

function collectInputModel() {
  const dates = [ui.datePrimary.value, ui.dateSecondary.value].filter(Boolean);
  const calls = [
    normalizeCallsign(ui.callPrimary.value),
    normalizeCallsign(ui.callCompare1.value),
    normalizeCallsign(ui.callCompare2.value),
    normalizeCallsign(ui.callCompare3.value),
  ];

  return {
    dates,
    primary: calls[0],
    comparisons: calls.slice(1).filter(Boolean),
  };
}

function validateModel(model) {
  if (!model.dates.length) {
    return { ok: false, reason: "Pick at least one UTC date." };
  }

  if (model.dates.length > 2) {
    return { ok: false, reason: "A maximum of two dates is allowed." };
  }

  if (new Set(model.dates).size !== model.dates.length) {
    return { ok: false, reason: "Date 1 and Date 2 must be different." };
  }

  if (!model.primary) {
    return { ok: false, reason: "Enter your primary callsign." };
  }

  if (!CALLSIGN_PATTERN.test(model.primary)) {
    return { ok: false, reason: "Primary callsign format looks invalid." };
  }

  for (const compareCall of model.comparisons) {
    if (!CALLSIGN_PATTERN.test(compareCall)) {
      return { ok: false, reason: `Compare callsign ${compareCall} format looks invalid.` };
    }
  }

  const allCalls = [model.primary, ...model.comparisons];
  if (new Set(allCalls).size !== allCalls.length) {
    return { ok: false, reason: "Callsigns must be unique within one analysis run." };
  }

  return { ok: true, reason: "Ready to start analysis." };
}

function setStatus(status, message) {
  state.status = status;
  ui.statusPill.dataset.state = status;
  ui.statusPill.textContent =
    status === "ready" ? "Ready" : status === "running" ? "Running" : status === "error" ? "Error" : "Idle";
  ui.statusMessage.textContent = message;
  summaryCells.status.textContent = ui.statusPill.textContent;
}

function writeSummary(model) {
  summaryCells.dates.textContent = model.dates.length ? model.dates.join(" and ") : "-";
  summaryCells.primary.textContent = model.primary || "-";
  summaryCells.comparisons.textContent = model.comparisons.length ? model.comparisons.join(", ") : "None";
}

function syncStateFromModel(model) {
  state.dates = [...model.dates];
  state.slots.A.call = model.primary;
  state.slots.B.call = model.comparisons[0] || "";
  state.slots.C.call = model.comparisons[1] || "";
  state.slots.D.call = model.comparisons[2] || "";
}

function refreshFormState() {
  const model = collectInputModel();
  const validation = validateModel(model);
  writeSummary(model);
  syncStateFromModel(model);

  if (state.status === "running") {
    ui.startButton.disabled = true;
    return { model, validation };
  }

  ui.startButton.disabled = !validation.ok;
  if (validation.ok) {
    setStatus("ready", validation.reason);
  } else {
    setStatus("idle", validation.reason);
  }
  return { model, validation };
}

function handleInput() {
  refreshFormState();
}

function handleReset() {
  queueMicrotask(() => {
    state.lastError = "";
    setStatus("idle", "Enter required fields to enable analysis.");
    refreshFormState();
  });
}

function handleSubmit(event) {
  event.preventDefault();
  const { model, validation } = refreshFormState();
  if (!validation.ok) {
    setStatus("error", validation.reason);
    state.lastError = validation.reason;
    return;
  }

  setStatus("running", "Sprint 1 scaffold complete. Data fetch wiring starts in Sprint 2.");
  ui.startButton.disabled = true;
  writeSummary(model);
}

function bindEvents() {
  ui.form.addEventListener("input", handleInput);
  ui.form.addEventListener("submit", handleSubmit);
  ui.form.addEventListener("reset", handleReset);
}

bindEvents();
refreshFormState();

export { normalizeCallsign, validateModel };
