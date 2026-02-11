import { normalizeBandToken, normalizeCall, normalizeSpotterBase } from "./rbn-normalize.mjs";

const CONTINENT_ORDER = ["NA", "SA", "EU", "AF", "AS", "OC", "N/A"];

const indexCache = new Map();
const rankingCache = new Map();

const CONTINENT_HINTS = [
  { continent: "NA", re: /^(K|N|W|A[A-L]|V[A-G]|VE|XE|KP|CO|CM|C6|V3|TG|TI|HP|YN|YN|ZF|8P)/ },
  { continent: "SA", re: /^(LU|LW|AY|AZ|CX|CE|OA|YV|HK|PY|PP|PR|PU|P[Q-U]|CP|ZP|HC|HC|TI9|FY|P4|PJ)/ },
  { continent: "EU", re: /^(9A|9H|CT|CU|DL|DA|DB|DC|DD|DE|DF|DG|DH|DJ|DK|DM|DN|DO|F|G|M|2E|EI|GW|GI|GM|GD|I|IS|IZ|OE|OK|OM|O[N-W]|PA|PB|PC|PD|PE|PF|PG|PH|PI|PJ2|S5|S[0-9]|SP|SQ|SR|SM|LA|LB|LC|LY|YL|ES|ER|HA|HB|HE|HF|HG|LZ|YO|YU|E7|Z3|SV|SX|OH|OJ|UA[1-6]|R[1-6])/ },
  { continent: "AF", re: /^(ZS|ZT|ZU|5[H-NR]|7X|CN|3V|SU|9J|9Q|5A|5V|TU|D2|ET|TR|TT|V5|A2|C5|C9)/ },
  { continent: "AS", re: /^(JA|JE|JF|JG|JH|JI|JJ|JK|JL|JM|JN|JO|JP|JQ|JR|JS|JT|BY|BA|BD|BG|BH|BI|BL|BM|BN|BO|BP|BQ|BV|HL|DS|DT|VU|4X|4J|4L|UN|EX|EY|EP|A[4-9]|HZ|YB0|YB1|9M2|9M6|DU|HS|E2|B[0-9]|VR)/ },
  { continent: "OC", re: /^(VK|AX|ZL|E5|YB|YC|YD|YE|YF|YG|YH|9M6|P2|H4|A3|KH[2-9]|FO|FK)/ },
];

const BAND_ORDER_INDEX = new Map([
  "2190M",
  "630M",
  "560M",
  "160M",
  "80M",
  "60M",
  "40M",
  "30M",
  "20M",
  "17M",
  "15M",
  "12M",
  "10M",
  "8M",
  "6M",
  "5M",
  "4M",
  "2M",
  "1.25M",
  "70CM",
  "33CM",
  "23CM",
  "13CM",
  "9CM",
  "6CM",
  "3CM",
  "1.25CM",
  "6MM",
  "4MM",
  "2.5MM",
  "2MM",
  "1MM",
].map((band, index) => [band, index]));

function bandOrderIndex(band) {
  const key = normalizeBandToken(band || "");
  if (BAND_ORDER_INDEX.has(key)) return BAND_ORDER_INDEX.get(key);
  const number = parseFloat(key);
  if (Number.isFinite(number)) return 1000 + number;
  return 9999;
}

function sortBands(list) {
  return (Array.isArray(list) ? list : []).slice().sort((a, b) => {
    const ai = bandOrderIndex(a);
    const bi = bandOrderIndex(b);
    if (ai !== bi) return ai - bi;
    return String(a || "").localeCompare(String(b || ""));
  });
}

function formatBandLabel(band) {
  return normalizeBandToken(band || "") || String(band || "").toUpperCase();
}

function continentLabel(continent) {
  const key = String(continent || "").toUpperCase();
  if (key === "NA") return "North America";
  if (key === "SA") return "South America";
  if (key === "EU") return "Europe";
  if (key === "AF") return "Africa";
  if (key === "AS") return "Asia";
  if (key === "OC") return "Oceania";
  return "Unknown";
}

function inferContinentFromCall(call) {
  const normalized = normalizeCall(call || "");
  if (!normalized) return "N/A";
  for (const hint of CONTINENT_HINTS) {
    if (hint.re.test(normalized)) return hint.continent;
  }
  return "N/A";
}

function slotDataKey(slot) {
  if (!slot || slot.status !== "ready") return "";
  const days = Array.isArray(slot.days) ? slot.days.join(",") : "";
  const count = Number.isFinite(slot.totalOfUs) ? slot.totalOfUs : slot.raw?.ofUsSpots?.length || 0;
  return `${slot.call}|${days}|${count}`;
}

function clearSlotCaches(slotId) {
  for (const key of rankingCache.keys()) {
    if (key.startsWith(`${slotId}|`)) rankingCache.delete(key);
  }
}

function getOrBuildSlotIndex(slot) {
  const key = slotDataKey(slot);
  if (!key) return null;
  const slotId = String(slot.id || "");
  const cached = indexCache.get(slotId);
  if (cached && cached.dataKey === key) return cached;

  const bySpotter = new Map();
  const spots = Array.isArray(slot.raw?.ofUsSpots) ? slot.raw.ofUsSpots : [];
  for (const spot of spots) {
    if (!spot?.spotter || !Number.isFinite(spot.ts) || !Number.isFinite(spot.snr)) continue;
    const spotter = normalizeSpotterBase(spot.spotter);
    if (!spotter) continue;
    const band = normalizeBandToken(spot.band || "") || "";
    let entry = bySpotter.get(spotter);
    if (!entry) {
      entry = {
        spotter,
        continent: inferContinentFromCall(spotter),
        totalCount: 0,
        bandCounts: new Map(),
        byBand: new Map(),
        minSnr: null,
        maxSnr: null,
      };
      bySpotter.set(spotter, entry);
    }

    entry.totalCount += 1;
    entry.bandCounts.set(band, (entry.bandCounts.get(band) || 0) + 1);
    if (!entry.byBand.has(band)) entry.byBand.set(band, []);
    entry.byBand.get(band).push(spot.ts, spot.snr);
    entry.minSnr = entry.minSnr == null ? spot.snr : Math.min(entry.minSnr, spot.snr);
    entry.maxSnr = entry.maxSnr == null ? spot.snr : Math.max(entry.maxSnr, spot.snr);
  }

  const built = { dataKey: key, bySpotter };
  indexCache.set(slotId, built);
  clearSlotCaches(slotId);
  return built;
}

function getOrBuildRanking(slot, bandKey) {
  const index = getOrBuildSlotIndex(slot);
  if (!index) return null;
  const normalizedBand = normalizeBandToken(bandKey || "");
  const cacheKey = `${slot.id}|${normalizedBand || "ALL"}`;
  const cached = rankingCache.get(cacheKey);
  if (cached && cached.dataKey === index.dataKey) return cached;

  const byContinent = new Map();
  for (const entry of index.bySpotter.values()) {
    const count = normalizedBand ? entry.bandCounts.get(normalizedBand) || 0 : entry.totalCount || 0;
    if (!count) continue;
    const continent = entry.continent || "N/A";
    if (!byContinent.has(continent)) byContinent.set(continent, []);
    byContinent.get(continent).push({ spotter: entry.spotter, count });
  }

  for (const [continent, list] of byContinent.entries()) {
    list.sort((a, b) => b.count - a.count || a.spotter.localeCompare(b.spotter));
    byContinent.set(continent, list);
  }

  const built = { dataKey: index.dataKey, byContinent };
  rankingCache.set(cacheKey, built);
  return built;
}

function hashString32(value) {
  const text = String(value || "");
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function sampleFlatStrideSeeded(data, capPoints, seed) {
  const list = Array.isArray(data) ? data : [];
  const totalPoints = Math.floor(list.length / 2);
  const cap = Math.max(0, Math.floor(Number(capPoints) || 0));
  if (!cap || totalPoints <= cap) return list;
  const stride = Math.max(1, Math.ceil(totalPoints / cap));
  const offset = stride > 1 ? hashString32(seed) % stride : 0;
  const out = [];
  for (let index = offset; index < totalPoints; index += stride) {
    const flatIndex = index * 2;
    out.push(list[flatIndex], list[flatIndex + 1]);
  }
  return out;
}

function computeProportionalCaps(entries, total, capTotal, minEach = 200) {
  const fullTotal = Math.max(0, Math.floor(total || 0));
  const cap = Math.max(0, Math.floor(capTotal || 0));
  if (!cap || fullTotal <= cap) {
    return entries.map(([band, count]) => [band, count]);
  }

  const out = entries.map(([band, count]) => {
    const safeCount = Math.max(0, Math.floor(count || 0));
    const raw = Math.floor((cap * safeCount) / Math.max(1, fullTotal));
    return [band, Math.min(safeCount, Math.max(minEach, raw))];
  });

  let sum = out.reduce((acc, [, count]) => acc + count, 0);
  if (sum > cap) {
    const order = out.map(([, count], index) => ({ index, count })).sort((a, b) => b.count - a.count);
    for (const item of order) {
      if (sum <= cap) break;
      const current = out[item.index][1];
      const next = Math.max(minEach, current - (sum - cap));
      out[item.index][1] = next;
      sum -= current - next;
    }
  }

  return out;
}

function continentSort(continentA, continentB) {
  const a = String(continentA || "N/A").toUpperCase();
  const b = String(continentB || "N/A").toUpperCase();
  const ai = CONTINENT_ORDER.indexOf(a);
  const bi = CONTINENT_ORDER.indexOf(b);
  return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
}

export {
  CONTINENT_ORDER,
  continentLabel,
  continentSort,
  formatBandLabel,
  sortBands,
  getOrBuildSlotIndex,
  getOrBuildRanking,
  sampleFlatStrideSeeded,
  computeProportionalCaps,
  slotDataKey,
};
