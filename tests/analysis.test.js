// Draai met: node tests/analysis.test.js
const assert = require("assert");
global.window = global;
require("../js/analysis.js");
const { normalize } = Beleg.analysis;
const S = (pairs) => ({ days: pairs.map((p) => p[0]), close: pairs.map((p) => p[1]) });

let r = normalize({ A: S([["2024-01-01", 10], ["2024-01-02", 11], ["2024-01-03", 12]]), B: S([["2024-01-02", 50], ["2024-01-03", 25]]) });
assert.strictEqual(r.start, "2024-01-02");
assert.deepStrictEqual(r.series.A, [100, 109.0909]);
assert.deepStrictEqual(r.series.B, [100, 50]);

r = normalize({ A: S([["2024-01-01", 10], ["2024-01-03", 20]]), B: S([["2024-01-01", 5], ["2024-01-02", 6], ["2024-01-03", 7]]) });
assert.deepStrictEqual(r.dates, ["2024-01-01", "2024-01-02", "2024-01-03"]);
assert.deepStrictEqual(r.series.A, [100, 100, 200]);

// startdatum op een dag zonder handel voor A: laatste eerdere koers telt niet mee (A begint pas later)
r = normalize({ A: S([["2024-01-01", 10], ["2024-01-05", 20]]), B: S([["2024-01-03", 5], ["2024-01-05", 10]]) }, "2024-01-02");
assert.strictEqual(r.start, "2024-01-05");

r = normalize({ A: S(Array.from({ length: 10 }, (_, i) => [`2024-01-${String(i + 1).padStart(2, "0")}`, i + 1])) }, "2024-01-05", "2024-01-06");
assert.deepStrictEqual(r.series.A, [100, 120]);
assert.deepStrictEqual(normalize({}).dates, []);
console.log("analysis: alle tests geslaagd");
