import { runRbnAnalysis } from "./src/rbn-orchestrator.mjs";
import { normalizeBandToken, normalizeCall } from "./src/rbn-normalize.mjs";
import { validateAnalysisInput } from "./src/input-validation.mjs";
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
  chart: {
    selectedBand: "",
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
  summary: document.querySelector("#run-summary"),
  summaryExtra: document.querySelector("#run-summary-extra"),
  chartsRoot: document.querySelector("#charts-root"),
};

const summaryCells = {
  dates: ui.summary.querySelector("div:nth-child(1) dd"),
  primary: ui.summary.querySelector("div:nth-child(2) dd"),
  comparisons: ui.summary.querySelector("div:nth-child(3) dd"),
  status: ui.summary.querySelector("div:nth-child(4) dd"),
};

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

const validateModel = validateAnalysisInput;

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

function setSummaryExtra(html) {
  ui.summaryExtra.innerHTML = html;
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

function renderSummaryFromAnalysis() {
  if (!state.analysis) {
    setSummaryExtra("<p>No run metadata yet.</p>");
    return;
  }

  const durationSec = Math.max(0, Math.round((state.analysis.durationMs || 0) / 1000));
  const slotLines = state.analysis.slots
    .map((slot) => {
      if (slot.status === "ready") {
        return `${slotTitle(slot)} ${escapeHtml(slot.call)}: ${formatNumber(slot.totalOfUs)} of-us, ${formatNumber(slot.totalByUs)} by-us`;
      }
      if (slot.status === "qrx") {
        return `${slotTitle(slot)} ${escapeHtml(slot.call)}: rate limited`;
      }
      return `${slotTitle(slot)} ${escapeHtml(slot.call)}: ${escapeHtml(slot.error || "error")}`;
    })
    .map((line) => `<p>${line}</p>`)
    .join("");

  const skimmerPairs = Object.entries(state.chart.selectedByContinent || {}).filter(([, value]) => Boolean(value));
  const skimmers = skimmerPairs.length
    ? skimmerPairs
        .map(([continent, value]) => `${continentLabel(continent)}: ${escapeHtml(value)}`)
        .map((line) => `<p>${line}</p>`)
        .join("")
    : "<p>No skimmer selected yet.</p>";

  setSummaryExtra(`
    <p>Run duration: ${durationSec}s</p>
    <p>Slot outcomes:</p>
    ${slotLines}
    <p>Selected skimmers:</p>
    ${skimmers}
  `);
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

function computeSeriesForSpotter(slots, spotter, bandKey) {
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

    if (bandKey) {
      const raw = entry.byBand.get(bandKey) || [];
      const sampled = sampleFlatStrideSeeded(raw, perSlotCap, `${spotter}|${slot.id}|${index.dataKey}|${bandKey}`);
      if (!sampled.length) continue;
      series.push({ band: bandKey, slotId: slot.id, shape, color: bandColorForChart(bandKey), data: sampled });
      pointTotal += Math.floor(sampled.length / 2);
      bandsPlotted.add(bandKey);
      for (let i = 1; i < sampled.length; i += 2) {
        const snr = sampled[i];
        if (!Number.isFinite(snr)) continue;
        minSnr = minSnr == null ? snr : Math.min(minSnr, snr);
        maxSnr = maxSnr == null ? snr : Math.max(maxSnr, snr);
      }
      continue;
    }

    const counts = Array.from(entry.bandCounts.entries()).filter(([, count]) => count > 0);
    const total = entry.totalCount || counts.reduce((acc, [, count]) => acc + count, 0);
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

function updateCardLegend(card, bands) {
  const node = card.querySelector(".rbn-signal-legend-bands");
  if (!node) return;
  const list = sortBands(Array.from(bands).filter(Boolean));
  node.innerHTML = list
    .map((band) => `<span class="rbn-legend-item"><i style="background:${bandColorForChart(band)}"></i>${formatBandLabel(band)}</span>`)
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
  const bandKey = normalizeBandToken(state.chart.selectedBand || "");

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
        updateCardLegend(card, []);
        updateCardMeta(card, 0, null, null);
      }
      continue;
    }

    const model = computeSeriesForSpotter(slots, spotter, bandKey);
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
    const titleBand = bandKey ? formatBandLabel(bandKey) : "All bands";
    const title = `${continentLabel(continent)} · ${spotter} · ${titleBand}`;

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
      updateCardLegend(card, model.bandsPlotted);
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

  const bandSelect = ui.chartsRoot.querySelector("#chart-band-filter");
  if (bandSelect) {
    bandSelect.addEventListener("change", (event) => {
      state.chart.selectedBand = String(event.currentTarget.value || "");
      renderAnalysisCharts();
    });
  }

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

function renderSlotLegend(slots) {
  return slots
    .map(
      (slot) => `
        <span class="slot-chip">
          <span class="slot-chip-call">${escapeHtml(slot.call)}</span>
          <span class="slot-chip-marker">${slotMarkerSymbol(slot.id)}</span>
          <span class="slot-chip-line">${slotLineSample(slot.id)}</span>
        </span>
      `,
    )
    .join("");
}

function renderAnalysisCharts() {
  if (!state.analysis) {
    ui.chartsRoot.classList.add("empty-state");
    ui.chartsRoot.innerHTML = "<p>No analysis results yet.</p>";
    renderSummaryFromAnalysis();
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
    renderSummaryFromAnalysis();
    return;
  }

  const baseSlot = slots.find((slot) => slot.id === "A") || slots[0];
  const bandOptions = getAvailableBands(slots);
  const selectedBand = normalizeBandToken(state.chart.selectedBand || "");
  state.chart.selectedBand = selectedBand;

  const ranking = getOrBuildRanking(baseSlot, selectedBand);
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
            <h4>${continentLabel(continent)} top skimmer</h4>
            <label class="rbn-signal-picker">
              <span>Skimmer</span>
              <select class="rbn-signal-select" data-continent="${continent}" ${list.length ? "" : "disabled"}>
                ${options}
              </select>
            </label>
            <span class="rbn-signal-status" ${list.length ? "hidden" : ""}>${statusText}</span>
          </div>
          <div class="rbn-signal-body">
            <div class="rbn-signal-plot">
              <canvas class="rbn-signal-canvas" data-continent="${continent}" data-spotter="${escapeHtml(selectedSpotter)}" data-height="280"></canvas>
              <div class="rbn-signal-meta">0 points plotted · SNR range: N/A</div>
            </div>
            <div class="rbn-signal-legend">
              <span class="rbn-signal-legend-bands"></span>
            </div>
          </div>
        </article>
      `;
    })
    .join("");

  ui.chartsRoot.classList.remove("empty-state");
  ui.chartsRoot.innerHTML = `
    <div class="chart-controls">
      <label for="chart-band-filter">Band filter</label>
      <select id="chart-band-filter">
        <option value="" ${selectedBand ? "" : "selected"}>All bands</option>
        ${bandOptions
          .map(
            (band) => `<option value="${band}" ${band === selectedBand ? "selected" : ""}>${formatBandLabel(band)}</option>`,
          )
          .join("")}
      </select>
      <span class="chart-controls-note">Primary ranking source: ${escapeHtml(baseSlot.call)}</span>
    </div>
    <div class="slot-legend">${renderSlotLegend(slots)}</div>
    ${renderChartFailures()}
    <div class="rbn-signal-grid">${cardsHtml}</div>
  `;

  renderSummaryFromAnalysis();
  bindChartInteractions(slots);
}

function refreshFormState(options = {}) {
  const { silentStatus = false } = options;
  const model = collectInputModel();
  const validation = validateModel(model);
  writeSummary(model);
  syncStateFromModel(model);

  if (state.status === "running") {
    ui.startButton.disabled = true;
    return { model, validation };
  }

  ui.startButton.disabled = !validation.ok;
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
    state.analysis = null;
    state.chart.selectedBand = "";
    state.chart.selectedByContinent = {};
    teardownChartObservers();
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
  setStatus("running", "Fetching RBN data for selected callsigns...");
  ui.startButton.disabled = true;

  try {
    const result = await runRbnAnalysis(model);
    if (runToken !== state.activeRunToken) return;

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

function bindEvents() {
  ui.form.addEventListener("input", handleInput);
  ui.form.addEventListener("submit", handleSubmit);
  ui.form.addEventListener("reset", handleReset);
}

bindEvents();
renderAnalysisCharts();
refreshFormState();

export { validateModel };
