const canvasJobs = new WeakMap();

function bandColorForChart(band) {
  const key = String(band || "").trim().toUpperCase();
  if (key === "160M") return "#334155";
  if (key === "80M") return "#2563eb";
  if (key === "40M") return "#16a34a";
  if (key === "20M") return "#f59e0b";
  if (key === "15M") return "#dc2626";
  if (key === "10M") return "#7c3aed";
  if (key === "6M") return "#be185d";
  return "#0f172a";
}

function slotMarkerShape(slotId) {
  const id = String(slotId || "A").toUpperCase();
  if (id === "B") return "triangle";
  if (id === "C") return "square";
  if (id === "D") return "diamond";
  return "circle";
}

function slotLineDash(slotId) {
  const id = String(slotId || "A").toUpperCase();
  if (id === "B") return [8, 6];
  if (id === "C") return [2, 5];
  if (id === "D") return [10, 5, 2, 5];
  return [];
}

function formatUtcTick(ts) {
  if (!Number.isFinite(ts)) return "";
  const date = new Date(ts);
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  return `${day} ${hour}Z`;
}

function drawMarkerPath(ctx, x, y, shape, size) {
  if (shape === "triangle") {
    ctx.moveTo(x, y - size);
    ctx.lineTo(x + size, y + size);
    ctx.lineTo(x - size, y + size);
    ctx.closePath();
    return;
  }

  if (shape === "square") {
    ctx.rect(x - size, y - size, size * 2, size * 2);
    return;
  }

  if (shape === "diamond") {
    ctx.moveTo(x, y - size);
    ctx.lineTo(x + size, y);
    ctx.lineTo(x, y + size);
    ctx.lineTo(x - size, y);
    ctx.closePath();
    return;
  }

  ctx.moveTo(x + size, y);
  ctx.arc(x, y, size, 0, Math.PI * 2);
}

function buildDeterministicJitter(ts, snr, scale) {
  if (!scale) return { x: 0, y: 0 };
  const a = (Number.isFinite(ts) ? Math.floor(ts / 1000) : 0) | 0;
  const b = (Number.isFinite(snr) ? Math.round(snr * 100) : 0) | 0;
  const hash = (Math.imul(a, 2654435761) ^ Math.imul(b, 1597334677)) >>> 0;
  const x = (((hash & 1023) / 1023) - 0.5) * 2 * scale;
  const y = ((((hash >>> 10) & 1023) / 1023) - 0.5) * 2 * scale;
  return { x, y };
}

function drawRbnSignalCanvas(canvas, model) {
  if (!(canvas instanceof HTMLCanvasElement) || !model) return;
  const context = canvas.getContext("2d");
  if (!context) return;

  const previous = canvasJobs.get(canvas);
  if (previous?.raf) cancelAnimationFrame(previous.raf);
  const token = (previous?.token || 0) + 1;
  const job = { token, raf: 0 };
  canvasJobs.set(canvas, job);

  const devicePixelRatio = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  const cssWidth = Math.max(320, canvas.clientWidth || 920);
  const cssHeight = Math.max(220, Number(canvas.dataset.height) || 280);
  const width = Math.round(cssWidth * devicePixelRatio);
  const height = Math.round(cssHeight * devicePixelRatio);

  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  canvas.style.height = `${cssHeight}px`;

  context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  context.clearRect(0, 0, cssWidth, cssHeight);

  const margin = { left: 52, right: 12, top: 16, bottom: 26 };
  const plotWidth = Math.max(10, cssWidth - margin.left - margin.right);
  const plotHeight = Math.max(10, cssHeight - margin.top - margin.bottom);

  const minTs = Number(model.minTs);
  const maxTs = Number(model.maxTs);
  const minY = Number(model.minY);
  const maxY = Number(model.maxY);
  const series = Array.isArray(model.series) ? model.series : [];

  const xOf = (ts) => margin.left + ((ts - minTs) / Math.max(1, maxTs - minTs)) * plotWidth;
  const yOf = (snr) => margin.top + (1 - (snr - minY) / Math.max(1e-9, maxY - minY)) * plotHeight;

  context.strokeStyle = "#b9cbe7";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(margin.left, margin.top);
  context.lineTo(margin.left, margin.top + plotHeight);
  context.lineTo(margin.left + plotWidth, margin.top + plotHeight);
  context.stroke();

  context.fillStyle = "#23456f";
  context.font = "11px Barlow, sans-serif";
  context.textBaseline = "middle";

  const yTicks = 5;
  for (let index = 0; index <= yTicks; index += 1) {
    const t = index / yTicks;
    const yValue = minY + (1 - t) * (maxY - minY);
    const y = margin.top + t * plotHeight;

    context.strokeStyle = "rgba(185, 203, 231, 0.45)";
    context.beginPath();
    context.moveTo(margin.left, y);
    context.lineTo(margin.left + plotWidth, y);
    context.stroke();

    context.fillText(`${Math.round(yValue)}`, 6, y);
  }

  context.textBaseline = "top";
  const xTicks = Math.max(2, Math.min(10, Math.floor(plotWidth / 120)));
  for (let index = 0; index <= xTicks; index += 1) {
    const t = index / xTicks;
    const ts = minTs + t * (maxTs - minTs);
    const x = margin.left + t * plotWidth;

    context.strokeStyle = "rgba(185, 203, 231, 0.45)";
    context.beginPath();
    context.moveTo(x, margin.top);
    context.lineTo(x, margin.top + plotHeight);
    context.stroke();

    const label = formatUtcTick(ts);
    const labelWidth = context.measureText(label).width || 0;
    const clamped = Math.max(margin.left, Math.min(x - labelWidth / 2, margin.left + plotWidth - labelWidth));
    context.fillText(label, clamped, margin.top + plotHeight + 6);
  }

  const trendBreakMs = 30 * 60 * 1000;
  const trendlines = Array.isArray(model.trendlines) ? model.trendlines : [];
  if (trendlines.length) {
    context.save();
    context.globalAlpha = 0.45;
    context.lineWidth = 1.8;
    context.lineJoin = "round";
    context.lineCap = "round";

    for (const trend of trendlines) {
      const data = Array.isArray(trend?.data) ? trend.data : [];
      if (data.length < 4) continue;
      context.strokeStyle = trend.color || bandColorForChart(trend.band);
      context.lineWidth = Number.isFinite(trend.width) ? trend.width : 1.8;
      context.setLineDash(Array.isArray(trend.dash) ? trend.dash : []);

      let started = false;
      let previousTs = null;
      context.beginPath();
      for (let i = 0; i < data.length; i += 2) {
        const ts = data[i];
        const snr = data[i + 1];
        if (!Number.isFinite(ts) || !Number.isFinite(snr)) continue;
        const x = xOf(ts);
        const y = yOf(snr);
        const shouldBreak = started && Number.isFinite(previousTs) && ts - previousTs > trendBreakMs;
        if (!started || shouldBreak) {
          if (started) context.stroke();
          context.beginPath();
          context.moveTo(x, y);
          started = true;
        } else {
          context.lineTo(x, y);
        }
        previousTs = ts;
      }
      if (started) context.stroke();
      context.setLineDash([]);
    }

    context.restore();
  }

  context.fillStyle = "#193d6e";
  context.font = "12px Barlow, sans-serif";
  context.textBaseline = "top";
  context.fillText(String(model.title || "RBN signal"), margin.left, 2);

  const pointCount = series.reduce((sum, item) => sum + Math.floor((item?.data?.length || 0) / 2), 0);
  const pointAlpha = pointCount > 20000 ? 0.14 : pointCount > 12000 ? 0.18 : pointCount > 7000 ? 0.22 : pointCount > 3500 ? 0.26 : 0.32;
  const jitterScale = pointCount > 20000 ? 0.55 : pointCount > 12000 ? 0.45 : pointCount > 7000 ? 0.35 : pointCount > 3500 ? 0.2 : 0;
  const budgetPerFrame = pointCount > 20000 ? 4200 : pointCount > 12000 ? 5000 : 6200;

  let seriesIndex = 0;
  let pointIndex = 0;

  const drawStep = () => {
    const live = canvasJobs.get(canvas);
    if (!live || live.token !== token) return;

    context.save();
    context.globalAlpha = pointAlpha;

    let remaining = budgetPerFrame;
    while (remaining > 0 && seriesIndex < series.length) {
      const row = series[seriesIndex] || {};
      const data = Array.isArray(row.data) ? row.data : [];
      const shape = row.shape || "circle";
      const color = row.color || bandColorForChart(row.band);

      if (!data.length) {
        seriesIndex += 1;
        pointIndex = 0;
        continue;
      }

      context.fillStyle = color;
      context.beginPath();
      let drawn = 0;

      while (remaining > 0 && pointIndex < data.length) {
        const ts = data[pointIndex];
        const snr = data[pointIndex + 1];
        pointIndex += 2;
        if (!Number.isFinite(ts) || !Number.isFinite(snr)) continue;

        const jitter = buildDeterministicJitter(ts, snr, jitterScale);
        const x = xOf(ts) + jitter.x;
        const y = yOf(snr) + jitter.y;
        drawMarkerPath(context, x, y, shape, 3);

        drawn += 1;
        remaining -= 1;
      }

      if (drawn) context.fill();
      if (pointIndex >= data.length) {
        seriesIndex += 1;
        pointIndex = 0;
      }
    }

    context.restore();

    if (seriesIndex < series.length) {
      job.raf = requestAnimationFrame(drawStep);
      canvasJobs.set(canvas, job);
    }
  };

  job.raf = requestAnimationFrame(drawStep);
  canvasJobs.set(canvas, job);
}

export {
  bandColorForChart,
  slotMarkerShape,
  slotLineDash,
  drawRbnSignalCanvas,
};
