import { runRbnAnalysis } from "./src/rbn-orchestrator.mjs";
import { normalizeCall } from "./src/rbn-normalize.mjs";

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
  activeRunToken: 0,
  analysis: null,
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
  chartsRoot: document.querySelector("#charts-root"),
};

const summaryCells = {
  dates: ui.summary.querySelector("div:nth-child(1) dd"),
  primary: ui.summary.querySelector("div:nth-child(2) dd"),
  comparisons: ui.summary.querySelector("div:nth-child(3) dd"),
  status: ui.summary.querySelector("div:nth-child(4) dd"),
};

function collectInputModel() {
  const dates = [ui.datePrimary.value, ui.dateSecondary.value].filter(Boolean);
  const calls = [
    normalizeCall(ui.callPrimary.value),
    normalizeCall(ui.callCompare1.value),
    normalizeCall(ui.callCompare2.value),
    normalizeCall(ui.callCompare3.value),
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

function formatSlotLine(slot) {
  const label = slot.id === "A" ? "Primary" : `Compare ${slot.id}`;
  if (slot.status === "ready") {
    const qty = Number(slot.totalOfUs || 0);
    const suffix = qty === 1 ? "spot" : "spots";
    return `${label} (${slot.call}): ${qty} of-us ${suffix}`;
  }
  if (slot.status === "qrx") {
    return `${label} (${slot.call}): rate limited`;
  }
  return `${label} (${slot.call}): ${slot.error || "error"}`;
}

function renderSlotResults(result) {
  if (!result || !Array.isArray(result.slots) || !result.slots.length) {
    ui.chartsRoot.classList.add("empty-state");
    ui.chartsRoot.innerHTML = "<p>No analysis results yet.</p>";
    return;
  }

  const rows = result.slots
    .map((slot) => {
      const stateClass = `slot-${slot.status}`;
      const totals = slot.status === "ready" ? `${slot.totalOfUs} of-us / ${slot.totalByUs} by-us` : "-";
      return `
        <article class="slot-card ${stateClass}">
          <header>
            <h3>${slot.id === "A" ? "Primary" : `Compare ${slot.id}`}</h3>
            <p>${slot.call}</p>
          </header>
          <dl>
            <div><dt>Status</dt><dd>${slot.status}</dd></div>
            <div><dt>Totals</dt><dd>${totals}</dd></div>
            <div><dt>Days</dt><dd>${result.days.join(", ") || "-"}</dd></div>
          </dl>
        </article>
      `;
    })
    .join("");

  ui.chartsRoot.classList.remove("empty-state");
  ui.chartsRoot.innerHTML = `<div class="slot-grid">${rows}</div>`;
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
    state.analysis = null;
    setStatus("idle", "Enter required fields to enable analysis.");
    renderSlotResults(null);
    refreshFormState();
  });
}

async function handleSubmit(event) {
  event.preventDefault();
  const { model, validation } = refreshFormState();
  if (!validation.ok) {
    setStatus("error", validation.reason);
    return;
  }

  const runToken = state.activeRunToken + 1;
  state.activeRunToken = runToken;
  setStatus("running", "Fetching RBN data for selected callsigns...");
  ui.startButton.disabled = true;

  try {
    const result = await runRbnAnalysis(model);
    if (runToken !== state.activeRunToken) return;
    state.analysis = result;
    renderSlotResults(result);

    const lines = result.slots.map(formatSlotLine).join(" | ");
    if (result.hasAnyFailure && result.hasAnyLoaded) {
      setStatus("ready", `Analysis finished with partial results. ${lines}`);
    } else if (result.hasAnyFailure && !result.hasAnyLoaded) {
      setStatus("error", `Analysis failed. ${lines}`);
    } else {
      setStatus("ready", `Analysis finished. ${lines}`);
    }
  } catch (error) {
    if (runToken !== state.activeRunToken) return;
    setStatus("error", error?.message || "Analysis run failed.");
  } finally {
    if (runToken === state.activeRunToken) {
      const current = refreshFormState();
      if (current.validation.ok && state.status !== "error") {
        setStatus("ready", ui.statusMessage.textContent);
      }
    }
  }
}

function bindEvents() {
  ui.form.addEventListener("input", handleInput);
  ui.form.addEventListener("submit", handleSubmit);
  ui.form.addEventListener("reset", handleReset);
}

bindEvents();
renderSlotResults(null);
refreshFormState();

export { validateModel };
