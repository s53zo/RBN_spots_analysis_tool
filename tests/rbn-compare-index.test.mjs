import test from "node:test";
import assert from "node:assert/strict";

import { getOrBuildSlotIndex, getOrBuildRanking, getOrBuildRankingByP75 } from "../src/rbn-compare-index.mjs";

function buildSlot() {
  return {
    id: "A",
    status: "ready",
    call: "W1AW",
    days: ["20260115"],
    totalOfUs: 4,
    raw: {
      ofUsSpots: [
        { spotter: "K1ABC", band: "40M", ts: 1000, snr: 8 },
        { spotter: "K1ABC", band: "20M", ts: 2000, snr: 15 },
        { spotter: "DL1AAA", band: "40M", ts: 3000, snr: 10 },
        { spotter: "PY2KNK", band: "20M", ts: 4000, snr: 11 },
      ],
    },
  };
}

test("getOrBuildSlotIndex groups spots by spotter and band", () => {
  const slot = buildSlot();
  const index = getOrBuildSlotIndex(slot);

  assert.ok(index);
  assert.equal(index.bySpotter.get("K1ABC").totalCount, 2);
  assert.equal(index.bySpotter.get("K1ABC").bandCounts.get("40M"), 1);
  assert.equal(index.bySpotter.get("K1ABC").bandCounts.get("20M"), 1);
});

test("getOrBuildRanking returns continent grouped ranking", () => {
  const slot = buildSlot();
  const rankingAll = getOrBuildRanking(slot, "");
  const ranking40 = getOrBuildRanking(slot, "40M");

  assert.ok(rankingAll.byContinent.get("NA")?.length);
  assert.ok(rankingAll.byContinent.get("EU")?.length);
  assert.ok(rankingAll.byContinent.get("SA")?.length);

  const na40 = ranking40.byContinent.get("NA") || [];
  assert.equal(na40[0].spotter, "K1ABC");
  assert.equal(na40[0].count, 1);
});

test("getOrBuildRankingByP75 ranks by p75 with count tiebreak", () => {
  const slot = buildSlot();
  // Add one more North America spotter so we can verify p75 ordering.
  slot.raw.ofUsSpots.push({ spotter: "K2ZZZ", band: "40M", ts: 5000, snr: 18 });
  slot.raw.ofUsSpots.push({ spotter: "K2ZZZ", band: "40M", ts: 6000, snr: 20 });
  slot.totalOfUs = slot.raw.ofUsSpots.length;

  const ranking40 = getOrBuildRankingByP75(slot, "40M", { minSamples: 1 });
  const na40 = ranking40.byContinent.get("NA") || [];

  assert.equal(na40[0].spotter, "K2ZZZ");
  assert.equal(na40[0].count, 2);
  assert.equal(Math.round(na40[0].p75), 18);
});
