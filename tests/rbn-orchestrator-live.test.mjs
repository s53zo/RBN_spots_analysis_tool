import test from "node:test";
import assert from "node:assert/strict";

import { resolveLiveWindow } from "../src/rbn-orchestrator.mjs";

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
