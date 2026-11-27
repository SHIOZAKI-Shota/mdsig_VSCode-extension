import { existsSync, readFileSync } from "node:fs";
import { documentLayout, verifyDocument, type VerifyResult } from "@mdsig/core";
import { vectorOptions } from "@mdsig/core/testing";
import type { Entry } from "../../src/verify/controller.ts";

export const dir = new URL("../fixtures/examples/", import.meta.url);
export const read = (n: string) => readFileSync(new URL(n, dir), "utf8");
const keys = JSON.parse(read("keys.json"));
export const expected: Record<string, { ok: boolean; signatures: string[]; agreement: string; table: unknown[]; marker: unknown; verdict: string }> = JSON.parse(read("expected.json"));

const options = vectorOptions(keys, (path) => {
  const u = new URL(path.split("/").map(encodeURIComponent).join("/"), dir);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : null;
});

export async function entry(file: string): Promise<Entry> {
  const text = read(file);
  const result: VerifyResult = await verifyDocument(text, options);
  return { uri: `file:///${file}`, version: 1, text, online: true, result, layout: documentLayout(text), newKeys: [] };
}
