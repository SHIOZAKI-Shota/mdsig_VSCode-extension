import { test } from "node:test";
import assert from "node:assert/strict";
import { entry, expected } from "./harness.ts";
import { buildModel } from "../../src/view/model.ts";
import { lensText, summarize, summaryText } from "../../src/verify/present.ts";

const t = (m: string, ...a: (string | number)[]) => m.replace(/\{(\d+)\}/g, (_x, i: string) => String(a[Number(i)]));

for (const file of Object.keys(expected)) {
  test(`model for ${file}`, async () => {
    const e = await entry(file);
    const m = buildModel(t, e, file, false);
    assert.equal(e.layout.blocks.length, e.result.signatures.length);
    assert.equal(m.cards.length, e.result.signatures.length);
    for (const b of m.brackets) assert.ok(b.from >= 1 && b.to >= b.from && b.to <= e.layout.lineCount, `${file} ${JSON.stringify(b)}`);
    for (const s of e.result.signatures) assert.ok(lensText(t, s).includes(`#${s.index}`));
    assert.ok(summaryText(t, e.result).title);
    if (expected[file]!.ok && !file.startsWith("directory")) assert.ok(["verified", "pending"].includes(summarize(e.result)), `${file}: ${summarize(e.result)}`);
  });
}

test("a co-signature covers the earlier block", async () => {
  const e = await entry("valid-cosigned.md");
  const [b1, b2] = e.layout.blocks;
  assert.equal(b1!.from, 15);
  assert.equal(b1!.to, 28);
  assert.equal(b2!.from, 29);
  assert.ok(e.layout.coverage[0]!.ranges[0]!.to < 15);
  assert.deepEqual(e.layout.coverage[1]!.ranges, [{ from: 1, to: 28 }]);
  assert.equal(summarize(e.result), "verified");
});

test("text after the last signature is the tail", async () => {
  const e = await entry("unsigned-trailer.md");
  assert.equal(e.layout.blocks.length, 0);
  assert.deepEqual(e.layout.tail, { from: 30, to: 30 });
  assert.equal(summarize(e.result), "broken");
  const m = buildModel(t, e, "x.md", false);
  assert.ok(m.brackets.some((b) => b.dashed && b.from === 30));
});

test("a scoped signature covers its sections only", async () => {
  const e = await entry("valid-scoped-edited.md");
  assert.deepEqual(e.layout.coverage[0], { index: 1, ranges: [{ from: 3, to: 6 }, { from: 11, to: 15 }], sections: ["terms", "fees"] });
});

test("required signatures are shown by step", async () => {
  const e = await entry("require-serial-pending.md");
  assert.equal(summarize(e.result), "pending");
  const m = buildModel(t, e, "x.md", false);
  assert.ok(m.steps.length >= 2);
  assert.ok(m.steps.some((s) => !s.done));
});

test("long documents are shortened but keep every block edge", async () => {
  const e = await entry("valid-cosigned.md");
  const m = buildModel(t, e, "x.md", false);
  const shown = new Set(m.rows.filter((r) => r.line).map((r) => r.line));
  for (const b of e.layout.blocks) assert.ok(shown.has(b.from) && shown.has(b.to));
  assert.ok(m.rows.some((r) => r.kind === "gap"));
  assert.equal(buildModel(t, e, "x.md", true).rows.length, e.layout.lineCount);
});
