import { runRbnAnalysis } from "./src/rbn-orchestrator.mjs";
import { normalizeBandToken, normalizeCall } from "./src/rbn-normalize.mjs";
import { validateAnalysisInput } from "./src/input-validation.mjs";
import { preloadCtyData } from "./src/cty-lookup.mjs";
import {
  CONTINENT_ORDER,
  continentLabel,
  continentSort,
  formatBandLabel,
  sortBands,
  getOrBuildSlotIndex,
  getOrBuildRanking,
  sampleFlatStrideSeeded,
  computeProportionalCaps,
} from "./src/rbn-compare-index.mjs";
import { bandColorForChart, drawRbnSignalCanvas, slotLineDash, slotMarkerShape } from "./src/rbn-canvas.mjs";

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
  retry: {
    timer: 0,
    untilTs: 0,
    status: "ready",
    baseMessage: "",
  },
  datePickers: {
    primary: null,
    secondary: null,
  },
  chart: {
    selectedBands: [],
    selectedByContinent: {},
    drawRaf: 0,
    resizeObserver: null,
    intersectionObserver: null,
  },
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
  checkFetch: document.querySelector("#check-fetch"),
  checkCty: document.querySelector("#check-cty"),
  checkCharts: document.querySelector("#check-charts"),
  chartsNote: document.querySelector("#charts-note"),
  chartsRoot: document.querySelector("#charts-root"),
};

let html2CanvasLoadPromise = null;

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

function collectInputModel() {
  const dates = [parseDateInputToIso(ui.datePrimary.value), parseDateInputToIso(ui.dateSecondary.value)].filter(Boolean);
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

function addUtcDay(isoDate, daysToAdd = 1) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(isoDate || ""))) return "";
  const date = new Date(`${isoDate}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) return "";
  date.setUTCDate(date.getUTCDate() + daysToAdd);
  return date.toISOString().slice(0, 10);
}

function suggestSecondaryDateFromPrimary() {
  const primaryIso = parseDateInputToIso(ui.datePrimary.value);
  if (!primaryIso) return;

  const suggestedIso = addUtcDay(primaryIso, 1);
  const secondaryIso = parseDateInputToIso(ui.dateSecondary.value);
  if (!secondaryIso) {
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
  };

  state.datePickers.primary = flatpickrFn(ui.datePrimary, {
    ...baseOptions,
    onChange: () => {
      suggestSecondaryDateFromPrimary();
      refreshFormState();
    },
    onClose: () => refreshFormState(),
  });

  state.datePickers.secondary = flatpickrFn(ui.dateSecondary, {
    ...baseOptions,
    onChange: () => refreshFormState(),
    onClose: () => refreshFormState(),
  });
}

const validateModel = validateAnalysisInput;

function setStatus(status, message) {
  state.status = status;
  ui.statusPill.dataset.state = status;
  ui.statusPill.textContent =
    status === "ready" ? "Ready" : status === "running" ? "Running" : status === "error" ? "Error" : "Idle";
  ui.statusMessage.textContent = message;
}

function setStartButtonMode(mode) {
  if (!ui.startButton) return;
  ui.startButton.dataset.state = mode || "idle";
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

function clearRetryCountdown() {
  if (state.retry.timer) {
    clearInterval(state.retry.timer);
    state.retry.timer = 0;
  }
  state.retry.untilTs = 0;
  state.retry.baseMessage = "";
}

function startRetryCountdown(ms, baseMessage, status = "ready") {
  clearRetryCountdown();
  const durationMs = Math.max(1000, Number(ms) || 1000);
  state.retry.untilTs = Date.now() + durationMs;
  state.retry.baseMessage = baseMessage;
  state.retry.status = status;

  const tick = () => {
    const remainingMs = state.retry.untilTs - Date.now();
    if (remainingMs <= 0) {
      clearRetryCountdown();
      setStatus(status, `${baseMessage} Retry available now.`);
      return;
    }
    const remainingSec = Math.ceil(remainingMs / 1000);
    setStatus(status, `${baseMessage} Retry in ${remainingSec}s.`);
  };

  tick();
  state.retry.timer = setInterval(tick, 1000);
}

function syncStateFromModel(model) {
  state.dates = [...model.dates];
  state.slots.A.call = model.primary;
  state.slots.B.call = model.comparisons[0] || "";
  state.slots.C.call = model.comparisons[1] || "";
  state.slots.D.call = model.comparisons[2] || "";
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
      return `
        <button type="button" class="rbn-legend-item rbn-legend-toggle${active ? " is-active" : ""}" data-band="${band}">
          <i style="background:${bandColorForChart(band)}"></i>${formatBandLabel(band)}
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

function drawCharts(slots) {
  const canvases = Array.from(ui.chartsRoot.querySelectorAll(".rbn-signal-canvas")).filter((canvas) => {
    if (!(canvas instanceof HTMLCanvasElement)) return false;
    if (!state.chart.intersectionObserver) return true;
    return canvas.dataset.visible === "1";
  });
  if (!canvases.length) return;

  const { minTs, maxTs } = getGlobalTimeRange(slots);
  const availableBands = getAvailableBands(slots);
  const bandFilterSet = getActiveBandFilterSet();

  for (const canvas of canvases) {
    const card = canvas.closest(".rbn-signal-card");
    const continent = String(canvas.dataset.continent || "N/A").toUpperCase();
    const spotter = String(canvas.dataset.spotter || "");

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
              const text = wait ? `Rate limited, retry in ~${wait}s` : "Rate limited";
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
            <button type="button" class="rbn-copy-btn" title="Copy as image" aria-label="Copy as image">🖼</button>
            <span class="rbn-signal-status" ${list.length ? "hidden" : ""}>${statusText}</span>
          </div>
          <div class="rbn-signal-body">
            <div class="rbn-signal-plot">
              <canvas class="rbn-signal-canvas" data-continent="${continent}" data-spotter="${escapeHtml(selectedSpotter)}" data-height="280"></canvas>
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

function refreshFormState(options = {}) {
  const { silentStatus = false } = options;
  const model = collectInputModel();
  const validation = validateModel(model);
  syncStateFromModel(model);

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
    teardownChartObservers();
    suggestSecondaryDateFromPrimary();
    resetLoadChecks();
    setStatus("idle", "Enter required fields to enable analysis.");
    renderAnalysisCharts();
    refreshFormState();
  });
}

async function handleSubmit(event) {
  event.preventDefault();
  clearRetryCountdown();
  const { model, validation } = refreshFormState({ silentStatus: true });
  if (!validation.ok) {
    setStatus("error", validation.reason);
    return;
  }

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
      startRetryCountdown(retryMs, baseMessage, loaded ? "ready" : "error");
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

function handleLegendBandClick(event) {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const button = target.closest(".rbn-legend-toggle");
  if (!button || !ui.chartsRoot.contains(button)) return;
  const token = String(button.dataset.band || "");
  if (token === "__ALL__") {
    state.chart.selectedBands = [];
    renderAnalysisCharts();
    return;
  }
  const band = normalizeBandToken(token);
  if (!band) return;
  // Single-select behavior: clicking a band focuses that one band only.
  state.chart.selectedBands = [band];
  renderAnalysisCharts();
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
  const prevText = button.textContent || "🖼";
  const continent = String(card.querySelector(".rbn-signal-select")?.dataset.continent || "N/A").trim().toUpperCase() || "N/A";
  const spotter = String(card.querySelector(".rbn-signal-select")?.value || "spotter").trim() || "spotter";
  const filename = `rbn_compare_signal_${sanitizeFilenameToken(continent)}_${sanitizeFilenameToken(spotter)}.png`;

  button.disabled = true;
  button.dataset.state = "";
  button.title = "Preparing image...";
  button.textContent = "…";

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
      button.textContent = "✓";
    } else {
      downloadBlobFile(blob, filename);
      button.dataset.state = "copied";
      button.title = "Clipboard unavailable, PNG downloaded";
      button.textContent = "↓";
    }
  } catch (err) {
    console.error("Copy graph as image failed:", err);
    button.dataset.state = "error";
    button.title = "Unable to copy or download image";
    button.textContent = "!";
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
  if (!button || !ui.chartsRoot.contains(button)) return;
  const card = button.closest(".rbn-signal-card");
  if (!card) return;
  copyCardAsImage(card, button);
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
  ui.chartsRoot.addEventListener("click", handleLegendBandClick);
  ui.chartsRoot.addEventListener("click", handleCopyCardClick);
}

function preloadBackgroundData() {
  preloadCtyData().catch(() => {
    // Keep fallback continent inference if cty.dat is unavailable.
  });
}

bindEvents();
initDatePickers();
preloadBackgroundData();
resetLoadChecks();
renderAnalysisCharts();
refreshFormState();

export { validateModel };
