import { existsSync, readFileSync } from "node:fs";
import { decodePublicKey, fromBase64, parseDnsRecord, parseSshPublicKeys, verifyDocument, type Resolver, type VerifyResult } from "@mdsig/core";
import { layout } from "../../src/verify/ranges.ts";
import type { Entry } from "../../src/verify/controller.ts";

export const dir = new URL("../fixtures/examples/", import.meta.url);
export const read = (n: string) => readFileSync(new URL(n, dir), "utf8");
const keys = JSON.parse(read("keys.json"));
export const expected: Record<string, { ok: boolean; signatures: string[] }> = JSON.parse(read("expected.json"));

const resolvers: Record<string, Resolver> = {
  "git-hosting": async (f) => ({ keys: parseSshPublicKeys(keys["git-hosting"][f.signer!].keys_file).map((k) => ({ alg: "ed25519", key: k.key!, source: "keys.json" })), warnings: [] }),
  dns: async (f) => {
    const rec = parseDnsRecord(keys.dns[`${f.selector}._mdsig.${f.signer}`].txt)!;
    return { keys: [{ alg: rec.k, key: decodePublicKey(rec.k, fromBase64(rec.p)), source: "keys.json" }], warnings: [] };
  },
};

const DOH = "https://cloudflare-dns.com/dns-query?";
const fetch = (async (url: string) => {
  if (url.startsWith(DOH)) {
    const records: string[] | undefined = keys.txt?.[new URLSearchParams(url.slice(DOH.length)).get("name")!];
    return Response.json(records ? { Status: 0, Answer: records.map((r) => ({ type: 16, data: JSON.stringify(r) })) } : { Status: 3 });
  }
  const file = keys.fetch?.[url];
  if (!file) throw new TypeError(`network disabled in tests: ${url}`);
  if (file === "404") return new Response("", { status: 404 });
  return new Response(read(file));
}) as typeof globalThis.fetch;

const loadResource = async (ref: string) => {
  const u = new URL(ref, dir);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : null;
};

export async function entry(file: string): Promise<Entry> {
  const text = read(file);
  const result: VerifyResult = await verifyDocument(text, { resolvers, fetch, loadResource, now: new Date(keys.now) });
  return { uri: `file:///${file}`, version: 1, text, online: true, result, layout: layout(text), newKeys: [] };
}
