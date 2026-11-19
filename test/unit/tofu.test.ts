import { test } from "node:test";
import assert from "node:assert/strict";
import { keyFingerprint, verifyDocument } from "@mdsig/core";
import { knownSignersStore, newKeys, type KnownSigners } from "../../src/verify/tofu.ts";
import { scanBody } from "../../src/verify/findings.ts";
import { read } from "./harness.ts";

function memory(initial: Record<string, string> = {}): KnownSigners & { data: Record<string, string> } {
  const m = { data: { ...initial } } as KnownSigners & { data: Record<string, string> };
  m.read = async () => ({ ...m.data });
  m.update = async (change) => {
    const d = { ...m.data };
    change(d);
    m.data = d;
  };
  return m;
}

async function run(known: KnownSigners, text: string, accept = false, now?: Date) {
  const r = await verifyDocument(text, { offline: true, tofuStore: await knownSignersStore(known), acceptNewTofuKey: accept, confirmNewTofuKeys: true, now });
  return { r, newKeys: newKeys(r) };
}

test("a key seen for the first time is reported, not stored", async () => {
  const known = memory();
  const { r, newKeys } = await run(known, read("valid-single.md"));
  assert.equal(r.signatures[0]!.status, "valid");
  assert.equal(newKeys.length, 1);
  assert.equal(newKeys[0]!.signer, "bob@laptop");
  assert.match(newKeys[0]!.fingerprint, /^SHA256:/);
  assert.equal(newKeys[0]!.fingerprint, await keyFingerprint(newKeys[0]!.key));
  assert.equal(r.signatures[0]!.tofu?.status, "new");
  assert.deepEqual(known.data, {});
});

test("a trusted key is no longer new, and a different key is key-changed", async () => {
  const text = read("valid-single.md");
  const first = await run(memory(), text);
  const known = memory({ [first.newKeys[0]!.signer]: first.newKeys[0]!.key });
  assert.equal((await run(known, text)).newKeys.length, 0);
  const other = memory({ "bob@laptop": "ed25519:AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl" });
  const changed = await run(other, text);
  assert.equal(changed.r.signatures[0]!.code, "key-changed");
  assert.equal(changed.newKeys.length, 0);
});

test("a key that is new but whose block fails is not offered", async () => {
  const known = memory();
  const { r, newKeys } = await run(known, read("expired.md"), false, new Date("2026-12-01T00:00:00Z"));
  assert.equal(r.signatures[0]!.code, "expired");
  assert.equal(r.signatures[0]!.tofu, undefined);
  assert.equal(newKeys.length, 0);
  assert.deepEqual(known.data, {});
});

test("accepting a changed key stores it", async () => {
  const text = read("valid-single.md");
  const known = memory({ "bob@laptop": "ed25519:AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl" });
  const { r } = await run(known, text, true);
  assert.equal(r.signatures[0]!.status, "valid");
  assert.notEqual(known.data["bob@laptop"], "ed25519:AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl");
});

test("hidden content is found outside code and section markers", () => {
  const f = scanBody("# T\n\n<!-- mdsig:section a -->\nPay 100. <!-- 1,000 -->\n<!-- /mdsig:section -->\n\n```\n<!-- code -->\n```\n\n[x](https://evil.example) zero​width\n");
  assert.deepEqual(f.map((x) => `${x.kind}@${x.line}`), ["comment@4", "chars@11"]);
  assert.deepEqual(scanBody("[example.com](https://evil.example/)").map((x) => x.kind), ["link"]);
});
