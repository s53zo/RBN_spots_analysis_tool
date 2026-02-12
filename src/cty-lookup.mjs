import { normalizeCall } from "./rbn-normalize.mjs";

const CTY_URLS = [
  "https://azure.s53m.com/cors/cty.dat",
  "https://www.country-files.com/cty/cty.dat",
  "cty.dat",
  "./cty.dat",
  "/cty.dat",
  "CTY.DAT",
  "./CTY.DAT",
  "/CTY.DAT",
];

let ctyTable = null;
let loadPromise = null;
const prefixCache = new Map();
const ctyState = {
  status: "idle",
  source: "",
  error: "",
};

const FALLBACK_HINTS = [
  { continent: "NA", re: /^(K|N|W|A[A-L]|V[A-G]|VE|XE|KP|CO|CM|C6|V3|TG|TI|HP|YN|ZF|8P)/ },
  { continent: "SA", re: /^(LU|LW|AY|AZ|CX|CE|OA|YV|HK|PY|PP|PR|PU|P[Q-U]|CP|ZP|HC|FY|P4|PJ)/ },
  { continent: "EU", re: /^(9A|9H|CT|CU|DL|DA|DB|DC|DD|DE|DF|DG|DH|DJ|DK|DM|DN|DO|F|G|M|2E|EI|GW|GI|GM|GD|I|IS|IZ|OE|OK|OM|O[N-W]|PA|PB|PC|PD|PE|PF|PG|PH|PI|S5|S[0-9]|SP|SQ|SR|SM|LA|LB|LC|LY|YL|ES|ER|HA|HB|HE|HF|HG|LZ|YO|YU|E7|Z3|SV|SX|OH|OJ|UA[1-6]|R[1-6])/ },
  { continent: "AF", re: /^(ZS|ZT|ZU|5[H-NR]|7X|CN|3V|SU|9J|9Q|5A|5V|TU|D2|ET|TR|TT|V5|A2|C5|C9)/ },
  { continent: "AS", re: /^(JA|JE|JF|JG|JH|JI|JJ|JK|JL|JM|JN|JO|JP|JQ|JR|JS|JT|BY|BA|BD|BG|BH|BI|BL|BM|BN|BO|BP|BQ|BV|HL|DS|DT|VU|4X|4J|4L|UN|EX|EY|EP|A[4-9]|HZ|DU|HS|E2|VR)/ },
  { continent: "OC", re: /^(VK|AX|ZL|E5|YB|YC|YD|YE|YF|YG|YH|9M6|P2|H4|A3|KH[2-9]|FO|FK)/ },
];

function normalizeContinent(code) {
  const raw = String(code || "").trim().toUpperCase();
  if (!raw) return "";
  if (["NA", "SA", "EU", "AF", "AS", "OC"].includes(raw)) return raw;

  const words = raw.replace(/[^A-Z]/g, " ").split(/\s+/).filter(Boolean);
  if (raw.includes("AMERICA")) {
    if (raw.includes("SOUTH") || words.includes("S")) return "SA";
    if (raw.includes("NORTH") || words.includes("N")) return "NA";
    return "NA";
  }
  if (raw.includes("EUROPE")) return "EU";
  if (raw.includes("AFRICA")) return "AF";
  if (raw.includes("ASIA")) return "AS";
  if (raw.includes("OCEANIA") || raw.includes("AUSTRALIA")) return "OC";
  return "";
}

function parseCtyDat(text) {
  if (!text || /<html|<body/i.test(text)) return [];

  const lines = text.split(/\r?\n/);
  const entries = [];

  const parseToken = (token, base, isPrimary) => {
    const cleaned = token.replace(/[:\s]+$/g, "");
    const match = cleaned.match(/^(=)?([^([\s]+)(?:\((\d+)\))?(?:\[(\d+)\])?$/);
    if (!match) return null;

    const [, exactMark, bodyRaw, cqOverride, ituOverride] = match;
    const body = bodyRaw.replace(/^\*+/, "");
    if (!body) return null;

    return {
      prefix: body.toUpperCase(),
      exact: exactMark === "=",
      primary: Boolean(isPrimary),
      country: base.country,
      cqZone: cqOverride ? parseInt(cqOverride, 10) : base.cqZone,
      ituZone: ituOverride ? parseInt(ituOverride, 10) : base.ituZone,
      continent: base.continent,
      lat: base.lat,
      lon: base.lon,
      tz: base.tz,
    };
  };

  let buffer = "";
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    buffer += (buffer ? " " : "") + line;
    while (buffer.includes(";")) {
      const [entryChunk, restChunk] = buffer.split(/;\s*/, 2);
      buffer = restChunk || "";
      const entryLine = entryChunk.trim();
      if (!entryLine) continue;

      const fields = entryLine.split(":");
      if (fields.length < 8) continue;

      const [name, cqZone, ituZone, continent, lat, lon, tz, ...restFields] = fields;
      const prefixBlock = restFields.join(":").replace(/;+$/, "");
      const prefixes = prefixBlock.split(/[, \t]+/).filter(Boolean);

      const lonVal = parseFloat(lon);
      const base = {
        country: name,
        cqZone: parseInt(cqZone, 10) || null,
        ituZone: parseInt(ituZone, 10) || null,
        continent: String(continent || "").trim() || null,
        lat: parseFloat(lat) || null,
        lon: Number.isFinite(lonVal) ? -lonVal : null,
        tz: parseFloat(tz) || null,
      };

      let primarySet = false;
      for (const prefixToken of prefixes) {
        const parsed = parseToken(prefixToken.trim(), base, !primarySet);
        if (!parsed) continue;
        entries.push(parsed);
        if (!primarySet) primarySet = true;
      }
    }
  }

  return entries.sort((a, b) => {
    if (a.exact !== b.exact) return a.exact ? -1 : 1;
    return b.prefix.length - a.prefix.length;
  });
}

function lookupPrefix(call) {
  if (!ctyTable || !ctyTable.length) return null;
  const key = normalizeCall(call || "");
  if (!key) return null;

  if (prefixCache.has(key)) return prefixCache.get(key);

  let found = null;
  for (const entry of ctyTable) {
    if (entry.exact) {
      if (key === entry.prefix) {
        found = entry;
        break;
      }
    } else if (key.startsWith(entry.prefix)) {
      found = entry;
      break;
    }
  }

  if (prefixCache.size > 10000) prefixCache.clear();
  prefixCache.set(key, found);
  return found;
}

function inferFallbackContinent(call) {
  const key = normalizeCall(call || "");
  if (!key) return "N/A";
  for (const hint of FALLBACK_HINTS) {
    if (hint.re.test(key)) return hint.continent;
  }
  return "N/A";
}

function getContinentForCall(call) {
  const entry = lookupPrefix(call);
  const continent = normalizeContinent(entry?.continent || "");
  if (continent) return continent;
  return inferFallbackContinent(call);
}

function normalizeZoneValue(value) {
  const num = Number(value);
  if (!Number.isInteger(num) || num < 1 || num > 99) return null;
  return num;
}

function getCallGeoMeta(call, options = {}) {
  const strict = Boolean(options?.strict);
  const normalized = normalizeCall(call || "");
  if (!normalized) {
    return {
      call: "",
      matched: false,
      continent: "",
      cqZone: null,
      ituZone: null,
      dxcc: "",
    };
  }

  const entry = lookupPrefix(normalized);
  const continentFromEntry = normalizeContinent(entry?.continent || "");
  const fallbackContinent = inferFallbackContinent(normalized);
  const continent = continentFromEntry || (strict || fallbackContinent === "N/A" ? "" : fallbackContinent);

  return {
    call: normalized,
    matched: Boolean(entry),
    continent: continent || "",
    cqZone: normalizeZoneValue(entry?.cqZone),
    ituZone: normalizeZoneValue(entry?.ituZone),
    dxcc: String(entry?.country || "").trim(),
  };
}

async function fetchText(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

async function preloadCtyData() {
  if (ctyTable && ctyTable.length) return ctyState;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    ctyState.status = "loading";
    ctyState.error = "";

    let lastError = "";
    for (const url of CTY_URLS) {
      try {
        const text = await fetchText(url);
        const table = parseCtyDat(text);
        if (!table.length) {
          lastError = `Parsed 0 prefixes from ${url}`;
          continue;
        }

        ctyTable = table;
        prefixCache.clear();
        ctyState.status = "ok";
        ctyState.source = url;
        ctyState.error = "";
        return ctyState;
      } catch (error) {
        lastError = error?.message || `Failed to load ${url}`;
      }
    }

    ctyState.status = "error";
    ctyState.error = lastError || "Unable to load cty.dat";
    return ctyState;
  })();

  try {
    return await loadPromise;
  } finally {
    loadPromise = null;
  }
}

function getCtyState() {
  return { ...ctyState, loaded: Boolean(ctyTable && ctyTable.length) };
}

export { preloadCtyData, getCtyState, getContinentForCall, getCallGeoMeta, normalizeContinent, lookupPrefix };
