import test from "node:test";
import assert from "node:assert/strict";

import { resolveLiveWindow, resolveSkimmerWindow, normalizeSkimmerArea } from "../src/rbn-orchestrator.mjs";

test("resolveLiveWindow keeps single UTC day for short windows", () => {
  const nowTs = Date.parse("2026-02-11T05:30:00Z");
  const result = resolveLiveWindow(1, nowTs);

  assert.equal(result.windowHours, 1);
  assert.deepEqual(result.days, ["20260211"]);
  assert.equal(result.cutoffTs, nowTs - 3600 * 1000);
});

test("resolveLiveWindow spans two UTC days for 24h near midnight", () => {
  const nowTs = Date.parse("2026-02-11T00:20:00Z");
  const result = resolveLiveWindow(24, nowTs);

  assert.equal(result.windowHours, 24);
  assert.deepEqual(result.days, ["20260210", "20260211"]);
});

test("resolveLiveWindow spans three UTC days for 48h late in UTC day", () => {
  const nowTs = Date.parse("2026-02-11T23:30:00Z");
  const result = resolveLiveWindow(48, nowTs);

  assert.equal(result.windowHours, 48);
  assert.deepEqual(result.days, ["20260209", "20260210", "20260211"]);
});

test("resolveLiveWindow falls back to 24h on invalid input", () => {
  const nowTs = Date.parse("2026-02-11T12:00:00Z");
  const result = resolveLiveWindow(72, nowTs);

  assert.equal(result.windowHours, 24);
  assert.deepEqual(result.days, ["20260210", "20260211"]);
});

test("resolveSkimmerWindow spans UTC days and enforces max 48h", () => {
  const fromTs = Date.parse("2026-02-10T00:00:00Z");
  const toTs = Date.parse("2026-02-12T12:00:00Z");
  const result = resolveSkimmerWindow(fromTs, toTs, 48);

  assert.equal(result.fromTs, fromTs);
  assert.equal(result.toTs, Date.parse("2026-02-12T00:00:00Z"));
  assert.deepEqual(result.days, ["20260210", "20260211", "20260212"]);
});

test("normalizeSkimmerArea normalizes area type and values", () => {
  const cq = normalizeSkimmerArea("cq", " 14 ");
  const continent = normalizeSkimmerArea("continent", " eu ");
  const callsign = normalizeSkimmerArea("callsign", " dl8las ");
  const fallback = normalizeSkimmerArea("foo", "bar");

  assert.deepEqual(cq, {
    type: "CQ",
    value: "14",
    continent: "",
    dxcc: "",
    callsign: "",
    cqZone: 14,
    ituZone: null,
  });
  assert.deepEqual(continent, {
    type: "CONTINENT",
    value: "EU",
    continent: "EU",
    dxcc: "",
    callsign: "",
    cqZone: null,
    ituZone: null,
  });
  assert.deepEqual(callsign, {
    type: "CALLSIGN",
    value: "DL8LAS",
    continent: "",
    dxcc: "",
    callsign: "DL8LAS",
    cqZone: null,
    ituZone: null,
  });
  assert.deepEqual(fallback, {
    type: "GLOBAL",
    value: "",
    continent: "",
    dxcc: "",
    callsign: "",
    cqZone: null,
    ituZone: null,
  });
});
