import test from "node:test";
import assert from "node:assert/strict";

import { normalizeBandToken, normalizeRbnSpot, normalizeSelectedDays } from "../src/rbn-normalize.mjs";

test("normalizeSelectedDays converts ISO to compact UTC day", () => {
  const days = normalizeSelectedDays(["2026-01-15", "2026-01-16", "bad"]);
  assert.deepEqual(days, ["20260115", "20260116"]);
});

test("normalizeBandToken canonicalizes common values", () => {
  assert.equal(normalizeBandToken("40m"), "40M");
  assert.equal(normalizeBandToken("7000"), "40M");
  assert.equal(normalizeBandToken("14.05"), "20M");
});

test("normalizeRbnSpot maps and filters fields", () => {
  const spot = normalizeRbnSpot({
    spotter: "DL1AAA-2",
    dxCall: "w1aw",
    freqKHz: 7034,
    band: "40m",
    mode: "cq",
    snr: 12,
    speed: 26,
    txMode: "CW",
    ts: 1768437278000,
  });

  assert.equal(spot.spotter, "DL1AAA");
  assert.equal(spot.dxCall, "W1AW");
  assert.equal(spot.band, "40M");
  assert.equal(spot.snr, 12);
  assert.equal(typeof spot.comment, "string");
});

