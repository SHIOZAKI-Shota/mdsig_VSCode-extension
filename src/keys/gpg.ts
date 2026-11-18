import { spawn } from "node:child_process";
import type { PgpSigner } from "@mdsig/core";

function run(args: string[], input?: Uint8Array): Promise<{ code: number; out: Buffer; err: string }> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn("gpg", args, { stdio: ["pipe", "pipe", "pipe"] });
    } catch {
      return resolve({ code: -1, out: Buffer.alloc(0), err: "gpg not found" });
    }
    const out: Buffer[] = [];
    let err = "";
    child.stdout.on("data", (d: Buffer) => out.push(d));
    child.stderr.on("data", (d: Buffer) => (err += d.toString()));
    child.on("error", () => resolve({ code: -1, out: Buffer.alloc(0), err: "gpg not found" }));
    child.on("close", (code) => resolve({ code: code ?? -1, out: Buffer.concat(out), err }));
    child.stdin.end(input ? Buffer.from(input) : undefined);
  });
}

export interface GpgKey {
  fpr: string;
  primary: string;
  keyAlg: string;
  uids: string[];
  emails: string[];
}

const ALG: Record<string, string> = { "1": "rsa", "19": "ecdsa", "22": "ed25519", "27": "ed25519" };

export async function listGpgKeys(): Promise<GpgKey[]> {
  const r = await run(["--batch", "--with-colons", "--fixed-list-mode", "--list-secret-keys"]);
  if (r.code !== 0) return [];
  const keys: GpgKey[] = [];
  let cur: { primary: string; uids: string[]; candidates: { fpr: string; alg: string }[] } | null = null;
  let pending: { alg: string; usable: boolean } | null = null;
  const done = () => {
    if (cur && cur.candidates.length) {
      const c = cur.candidates.at(-1)!;
      const emails = cur.uids.map((u) => (/<([^>]+)>/.exec(u)?.[1] ?? u).toLowerCase()).filter((e) => /^[^@\s]+@[^@\s]+$/.test(e));
      keys.push({ fpr: c.fpr, primary: cur.primary, keyAlg: c.alg, uids: cur.uids, emails });
    }
  };
  for (const line of r.out.toString("utf8").split("\n")) {
    const f = line.split(":");
    if (f[0] === "sec") {
      done();
      cur = { primary: "", uids: [], candidates: [] };
      pending = { alg: ALG[f[3]!] ?? f[3]!, usable: !/[rei]/.test(f[1] ?? "") && (f[11] ?? "").includes("s") };
    } else if (f[0] === "ssb") {
      pending = { alg: ALG[f[3]!] ?? f[3]!, usable: !/[rei]/.test(f[1] ?? "") && (f[11] ?? "").includes("s") };
    } else if (f[0] === "fpr" && cur && pending) {
      if (!cur.primary) cur.primary = f[9]!;
      if (pending.usable) cur.candidates.push({ fpr: f[9]!, alg: pending.alg });
      pending = null;
    } else if (f[0] === "uid" && cur && !/[re]/.test(f[1] ?? "")) {
      cur.uids.push(f[9]!.replace(/\\x([0-9a-f]{2})/gi, (_m, h: string) => String.fromCharCode(parseInt(h, 16))));
    }
  }
  done();
  return keys;
}

function dearmor(b: Buffer): Uint8Array {
  const s = b.toString("latin1");
  const m = /-----BEGIN PGP SIGNATURE-----\r?\n(?:[^\r\n]*: [^\r\n]*\r?\n)*\r?\n([\s\S]+?)\r?\n(?:=[^\r\n]*\r?\n)?-----END PGP SIGNATURE-----/.exec(s);
  return m ? new Uint8Array(Buffer.from(m[1]!.replace(/\s+/g, ""), "base64")) : new Uint8Array(b);
}

export function gpgSigner(k: GpgKey): PgpSigner {
  return {
    alg: "openpgp",
    fpr: k.fpr.toUpperCase(),
    keyAlg: k.keyAlg,
    uids: k.uids,
    emails: k.emails,
    async sign(payload: Uint8Array): Promise<Uint8Array> {
      const r = await run(["--no-tty", "--detach-sign", "--digest-algo", "SHA256", "--local-user", `${k.fpr}!`, "--output", "-"], payload);
      if (r.code !== 0) throw new Error(r.err.trim().split("\n").at(-1) || "gpg failed to sign");
      return dearmor(r.out);
    },
    dispose() {},
  };
}

export async function gpgKeyring(fpr: string): Promise<Uint8Array | null> {
  const r = await run(["--batch", "--export", "--", fpr]);
  return r.code === 0 && r.out.length ? new Uint8Array(r.out) : null;
}
