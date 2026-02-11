import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeInputModel,
  validateAnalysisInput,
  normalizeLiveInputModel,
  validateLiveInput,
} from "../src/input-validation.mjs";

test("normalizeInputModel uppercases calls and trims list", () => {
  const normalized = normalizeInputModel({
    dates: ["2026-01-15", "2026-01-16"],
    primary: " w1aw ",
    comparisons: [" k1jt", " dl1abc ", "", "too-many"],
  });

  assert.deepEqual(normalized, {
    dates: ["2026-01-15", "2026-01-16"],
    primary: "W1AW",
    comparisons: ["K1JT", "DL1ABC", "TOO-MANY"],
  });
});

test("validateAnalysisInput accepts valid model", () => {
  const result = validateAnalysisInput({
    dates: ["2026-01-15", "2026-01-16"],
    primary: "W1AW",
    comparisons: ["K1JT"],
  });

  assert.equal(result.ok, true);
});

test("validateAnalysisInput rejects duplicate dates", () => {
  const result = validateAnalysisInput({
    dates: ["2026-01-15", "2026-01-15"],
    primary: "W1AW",
    comparisons: [],
  });

  assert.equal(result.ok, false);
  assert.match(result.reason, /must be different/i);
});

test("validateAnalysisInput rejects duplicate callsigns", () => {
  const result = validateAnalysisInput({
    dates: ["2026-01-15"],
    primary: "W1AW",
    comparisons: ["W1AW"],
  });

  assert.equal(result.ok, false);
  assert.match(result.reason, /unique/i);
});

test("normalizeLiveInputModel uppercases calls and sets default window", () => {
  const normalized = normalizeLiveInputModel({
    primary: " s53zo ",
    comparisons: [" k1jt", " dl1abc "],
  });

  assert.deepEqual(normalized, {
    primary: "S53ZO",
    comparisons: ["K1JT", "DL1ABC"],
    windowHours: 24,
  });
});

test("validateLiveInput accepts valid model", () => {
  const result = validateLiveInput({
    primary: "S53ZO",
    comparisons: ["K1JT"],
    windowHours: 48,
  });
  assert.equal(result.ok, true);
});

test("validateLiveInput rejects invalid window", () => {
  const result = validateLiveInput({
    primary: "S53ZO",
    comparisons: [],
    windowHours: 72,
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /window/i);
});

test("validateLiveInput rejects duplicate callsigns", () => {
  const result = validateLiveInput({
    primary: "S53ZO",
    comparisons: ["S53ZO"],
    windowHours: 24,
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /unique/i);
});
