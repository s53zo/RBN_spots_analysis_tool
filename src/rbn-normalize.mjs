const BAND_DEFS = [
  { label: "2190M", min: 0.1357, max: 0.1378 },
  { label: "630M", min: 0.472, max: 0.479 },
  { label: "560M", min: 0.5, max: 0.51 },
  { label: "160M", min: 1.8, max: 2.0 },
  { label: "80M", min: 3.4, max: 4.0 },
  { label: "60M", min: 5.0, max: 5.5 },
  { label: "40M", min: 6.9, max: 7.5 },
  { label: "30M", min: 10.0, max: 10.2 },
  { label: "20M", min: 13.9, max: 15.0 },
  { label: "17M", min: 18.0, max: 18.2 },
  { label: "15M", min: 20.8, max: 22.0 },
  { label: "12M", min: 24.8, max: 25.0 },
  { label: "10M", min: 27.9, max: 29.8 },
  { label: "6M", min: 50.0, max: 54.0 },
  { label: "4M", min: 70.0, max: 71.0 },
  { label: "2M", min: 144.0, max: 148.0 },
  { label: "1.25M", min: 222.0, max: 225.0 },
  { label: "70CM", min: 420.0, max: 450.0 },
  { label: "33CM", min: 902.0, max: 928.0 },
  { label: "23CM", min: 1240.0, max: 1300.0 },
  { label: "13CM", min: 2300.0, max: 2450.0 },
  { label: "9CM", min: 3300.0, max: 3500.0 },
  { label: "6CM", min: 5650.0, max: 5925.0 },
  { label: "3CM", min: 10000.0, max: 10500.0 },
  { label: "1.25CM", min: 24000.0, max: 24250.0 },
  { label: "6MM", min: 47000.0, max: 47200.0 },
  { label: "4MM", min: 75500.0, max: 81000.0 },
  { label: "2.5MM", min: 122000.0, max: 123000.0 },
  { label: "2MM", min: 134000.0, max: 141000.0 },
  { label: "1MM", min: 241000.0, max: 250000.0 },
];

const METER_TOKEN_MAP = new Map();
for (const band of BAND_DEFS) {
  const match = band.label.match(/^(\d+(?:\.\d+)?)(M)$/i);
  if (!match) continue;
  const num = match[1];
  const norm = String(parseFloat(num));
  METER_TOKEN_MAP.set(num, band.label);
  METER_TOKEN_MAP.set(norm, band.label);
}

function normalizeCall(call) {
  return (call || "").trim().toUpperCase();
}

function normalizeSpotterBase(call) {
  const norm = normalizeCall(call || "");
  if (!norm) return "";
  return norm.replace(/-\d+$/, "");
}

function parseBandFromFreq(freqMHz) {
  if (!Number.isFinite(freqMHz)) return "";
  for (const band of BAND_DEFS) {
    if (freqMHz >= band.min && freqMHz < band.max) return band.label;
  }
  return "";
}

function normalizeBandToken(raw) {
  if (!raw) return "";
  const cleaned = String(raw).trim();
  if (!cleaned) return "";

  let token = cleaned.toLowerCase().replace(/\s+/g, "");
  token = token
    .replace(/meters?|metres?/g, "m")
    .replace(/centimeters?|centimetres?/g, "cm")
    .replace(/millimeters?|millimetres?/g, "mm");

  let match = token.match(/^(\d+(?:\.\d+)?)(mm|cm|m)$/);
  if (match) {
    const num = String(parseFloat(match[1]));
    return `${num}${match[2]}`.toUpperCase();
  }

  match = token.match(/^(\d+(?:\.\d+)?)g(?:hz)?$/);
  if (match) {
    const ghz = parseFloat(match[1]);
    if (Number.isFinite(ghz)) {
      const band = parseBandFromFreq(ghz * 1000);
      return band || `${match[1]}G`.toUpperCase();
    }
  }

  if (/^\d+(\.\d+)?$/.test(token)) {
    const fromToken = METER_TOKEN_MAP.get(token) || METER_TOKEN_MAP.get(String(parseFloat(token)));
    if (fromToken) return fromToken;
    const num = parseFloat(token);
    if (!Number.isFinite(num)) return "";
    const mhz = num >= 1000 ? num / 1000 : num;
    const band = parseBandFromFreq(mhz);
    return band || String(num).toUpperCase();
  }

  const safe = cleaned.toUpperCase().replace(/[^A-Z0-9./-]/g, "");
  return safe;
}

function formatRbnComment(spot) {
  const parts = [];
  if (Number.isFinite(spot.snr)) parts.push(`SNR ${spot.snr} dB`);
  if (Number.isFinite(spot.speed)) parts.push(`Speed ${spot.speed}`);
  if (spot.mode) parts.push(String(spot.mode).toUpperCase());
  if (spot.txMode && spot.txMode !== spot.mode) parts.push(`TX ${String(spot.txMode).toUpperCase()}`);
  if (spot.spotterRaw && spot.spotterRaw !== spot.spotter) parts.push(`Skimmer ${spot.spotterRaw}`);
  return parts.join(" · ");
}

function normalizeRbnSpot(raw) {
  if (!raw || typeof raw !== "object") return null;

  const spotterRaw = normalizeCall(raw.spotterRaw || raw.spotter || "");
  const spotter = normalizeSpotterBase(raw.spotter || spotterRaw);
  const dxCall = normalizeCall(raw.dxCall || "");
  const ts = Number(raw.ts);
  const freqKHz = raw.freqKHz != null ? Number(raw.freqKHz) : Number(raw.freq);
  const freqMHz = Number.isFinite(raw.freqMHz) ? Number(raw.freqMHz) : Number.isFinite(freqKHz) ? freqKHz / 1000 : null;
  let band = normalizeBandToken(raw.band || "");
  if (!band && Number.isFinite(freqMHz)) band = normalizeBandToken(parseBandFromFreq(freqMHz));
  const snr = raw.snr != null ? Number(raw.snr) : raw.db != null ? Number(raw.db) : null;
  const speed = raw.speed != null ? Number(raw.speed) : null;
  const mode = String(raw.mode || "").trim();
  const txMode = String(raw.txMode || raw.tx_mode || "").trim();

  if (!spotter || !dxCall || !Number.isFinite(ts)) return null;

  const spot = {
    spotter,
    spotterRaw,
    dxCall,
    ts,
    freqKHz: Number.isFinite(freqKHz) ? freqKHz : null,
    freqMHz: Number.isFinite(freqMHz) ? freqMHz : null,
    band: band || "",
    mode,
    snr: Number.isFinite(snr) ? snr : null,
    speed: Number.isFinite(speed) ? speed : null,
    txMode,
  };

  spot.comment = formatRbnComment(spot);
  return spot;
}

function normalizeSelectedDays(dates) {
  return (Array.isArray(dates) ? dates : [])
    .map((value) => String(value || "").trim())
    .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value))
    .map((value) => value.replace(/-/g, ""));
}

export {
  normalizeCall,
  normalizeSpotterBase,
  parseBandFromFreq,
  normalizeBandToken,
  normalizeRbnSpot,
  normalizeSelectedDays,
  BAND_DEFS,
};
