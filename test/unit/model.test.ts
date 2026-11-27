import { test } from "node:test";
import assert from "node:assert/strict";
import { entry, expected } from "./harness.ts";
import { buildModel } from "../../src/view/model.ts";
import { scanBody } from "../../src/verify/findings.ts";
import { coreText, lensText, setMessageLang, summarize, summaryText } from "../../src/verify/present.ts";

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
    assert.equal(e.result.agreement.status, expected[file]!.agreement, file);
    if (expected[file]!.ok && !file.startsWith("directory")) assert.ok(["verified", "pending"].includes(summarize(e.result)), `${file}: ${summarize(e.result)}`);
    if (e.result.agreement.status === "undetermined" && e.result.signatures.every((s) => s.status === "valid")) assert.equal(summarize(e.result), "undetermined");
    if (e.result.agreement.status === "unsupported") assert.equal(summarize(e.result), "unsupported");
    assert.equal(m.agreement.length, e.result.agreement.declarations.length);
    assert.equal(m.table !== null, expected[file]!.marker !== null && e.result.signatures.length > 0, file);
    assert.equal(summarize(e.result) === "verified" ? "valid" : summarize(e.result) === "incomplete" ? "unresolved" : summarize(e.result), expected[file]!.verdict, file);
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
  const [d] = m.agreement;
  assert.equal(d!.steps.length, 2);
  assert.deepEqual(d!.steps.map((s) => [s.label, s.done]), [["Step 1", true], ["Step 2", false]]);
  assert.deepEqual(d!.steps[0]!.members, [{ text: "dns:example.com with role approver", done: true, notes: ["signed by #3"] }]);
  assert.deepEqual(d!.steps[1]!.members[0]!.notes, ["#2 came before the previous step was complete"]);
});

test("a step with any= counts different signers, including pattern lines", async () => {
  const e = await entry("table-marker.md");
  const [d] = buildModel(t, e, "x.md", false).agreement;
  assert.equal(d!.steps[1]!.label, "Step 2: 2 of these");
  assert.equal(d!.steps[1]!.done, false);
  assert.equal(d!.steps[1]!.members[0]!.text, "any subdomain of example.com (not example.com itself) with role witness, not the declaring signer");
});

test("an unreachable roster leaves the agreement undetermined", async () => {
  const e = await entry("require-member-unreachable.md");
  assert.equal(summarize(e.result), "undetermined");
  const [d] = buildModel(t, e, "x.md", false).agreement;
  assert.equal(d!.tone, "warn");
  assert.ok(d!.steps[0]!.members[0]!.notes.some((n) => n.includes("member list could not be obtained")));
});

test("the signature table is built when the body has a marker", async () => {
  const e = await entry("table-marker.md");
  const m = buildModel(t, e, "x.md", false);
  assert.ok(m.table);
  assert.equal(m.table![0]!.name, "“Example Corp” (self-declared)");
  assert.equal(m.table![0]!.signer, "example.com");
  assert.ok(m.table!.some((r) => r.number === "" && r.status.startsWith("Not signed yet")));
});

test("a display name is shown as self-declared next to the signer", async () => {
  const e = await entry("valid-display-name.md");
  const s = e.result.signatures[0]!;
  assert.ok(lensText(t, s).includes("(self-declared)"));
  assert.ok(lensText(t, s).includes(s.fields.signer!));
});

test("a signature block shows the time of the later timestamp block", async () => {
  const e = await entry("valid-cosigned.md");
  const s = e.result.signatures[0]!;
  if (s.time) assert.ok(lensText(t, s).includes(s.time.at));
});

test("long documents are shortened but keep every block edge", async () => {
  const e = await entry("valid-cosigned.md");
  const m = buildModel(t, e, "x.md", false);
  const shown = new Set(m.rows.filter((r) => r.line).map((r) => r.line));
  for (const b of e.layout.blocks) assert.ok(shown.has(b.from) && shown.has(b.to));
  assert.ok(m.rows.some((r) => r.kind === "gap"));
  assert.equal(buildModel(t, e, "x.md", true).rows.length, e.layout.lineCount);
});

test("blocks that cannot be checked and broken blocks give different reasons", async () => {
  const e = await entry("require-rejected-reasons.md");
  const [d] = buildModel(t, e, "x.md", false).agreement;
  const notes = d!.steps[0]!.members.flatMap((m) => m.notes);
  assert.ok(notes.includes("#2 could not be checked yet"), notes.join(" | "));
  assert.ok(notes.includes("#3 is not a valid signature"), notes.join(" | "));
  assert.equal(d!.steps[0]!.done, false);
});

test("messages from the library follow the display language", async () => {
  const e = await entry("unclosed-fence.md");
  const w = e.result.warnings[0]!;
  setMessageLang("ja");
  try {
    assert.match(coreText(w), /[\u3040-\u30ff\u4e00-\u9fff]/);
    assert.match(buildModel(t, e, "x.md", false).warnings[0]!, /[\u3040-\u30ff\u4e00-\u9fff]/);
  } finally {
    setMessageLang("en");
  }
  assert.equal(coreText(w), w);
});

test("hidden characters are reported unless they belong to an emoji or a joining script", () => {
  const kinds = (body: string) => scanBody(body).filter((f) => f.kind === "chars").map((f) => f.text);
  assert.deepEqual(kinds("tag \u{E0041}\u{E0042} smuggling\n"), ["U+E0041", "U+E0042"]);
  assert.deepEqual(kinds("family 👨\u200D👩\u200D👧 and \u0645\u06CC\u200C\u062E\u0648\u0627\u0647\u0645\n"), []);
  assert.deepEqual(kinds("pay\u200Dpal\n"), ["U+200D"]);
});
