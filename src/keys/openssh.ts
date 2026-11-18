import { createDecipheriv } from "node:crypto";
import { fromBase64, parseOpenSshPrivateKey } from "@mdsig/core";
// @ts-expect-error: no type declarations
import bcryptPbkdf from "bcrypt-pbkdf";

export class PassphraseRequired extends Error {}

export interface OpenSshKey {
  seed: Uint8Array;
  publicKey: Uint8Array;
  comment: string;
}

const MAGIC = "openssh-key-v1\0";
const dec = new TextDecoder();

class Reader {
  o = 0;
  readonly b: Uint8Array;
  constructor(b: Uint8Array) {
    this.b = b;
  }
  u32(): number {
    if (this.o + 4 > this.b.length) throw new Error("truncated OpenSSH key");
    const v = ((this.b[this.o]! << 24) | (this.b[this.o + 1]! << 16) | (this.b[this.o + 2]! << 8) | this.b[this.o + 3]!) >>> 0;
    this.o += 4;
    return v;
  }
  bytes(): Uint8Array {
    const n = this.u32();
    if (this.o + n > this.b.length) throw new Error("truncated OpenSSH key");
    const v = this.b.subarray(this.o, this.o + n);
    this.o += n;
    return v;
  }
  str(): string {
    return dec.decode(this.bytes());
  }
}

function container(pem: string): Uint8Array {
  const m = /-----BEGIN OPENSSH PRIVATE KEY-----([\s\S]+?)-----END OPENSSH PRIVATE KEY-----/.exec(pem);
  if (!m) throw new Error("not an OpenSSH private key");
  return fromBase64(m[1]!.replace(/\s+/g, ""));
}

export function isEncrypted(pem: string): boolean {
  const b = container(pem);
  const r = new Reader(b);
  r.o = MAGIC.length;
  return r.str() !== "none";
}

export function readOpenSshKey(pem: string, passphrase?: string): OpenSshKey {
  if (!isEncrypted(pem)) return parseOpenSshPrivateKey(pem);
  if (!passphrase) throw new PassphraseRequired("the key is protected by a passphrase");
  const b = container(pem);
  if (dec.decode(b.subarray(0, MAGIC.length)) !== MAGIC) throw new Error("not an OpenSSH private key");
  const r = new Reader(b);
  r.o = MAGIC.length;
  const cipher = r.str();
  const kdf = r.str();
  const kdfOpts = new Reader(r.bytes());
  if (r.u32() !== 1) throw new Error("only files with one key are supported");
  r.bytes();
  const enc = r.bytes();
  if (kdf !== "bcrypt") throw new Error(`unsupported key derivation "${kdf}"`);
  const salt = kdfOpts.bytes();
  const rounds = kdfOpts.u32();
  const spec: Record<string, { name: string; key: number; iv: number }> = {
    "aes256-ctr": { name: "aes-256-ctr", key: 32, iv: 16 },
    "aes256-cbc": { name: "aes-256-cbc", key: 32, iv: 16 },
    "aes256-gcm@openssh.com": { name: "aes-256-gcm", key: 32, iv: 12 },
  };
  const c = spec[cipher];
  if (!c) throw new Error(`unsupported cipher "${cipher}"`);
  const pass = new TextEncoder().encode(passphrase);
  const out = new Uint8Array(c.key + c.iv);
  if (bcryptPbkdf.pbkdf(pass, pass.length, salt, salt.length, out, out.length, rounds) !== 0) throw new Error("key derivation failed");
  let plain: Buffer;
  const d = createDecipheriv(c.name, out.subarray(0, c.key), out.subarray(c.key));
  if (c.name === "aes-256-gcm") {
    const tag = b.subarray(r.o, r.o + 16);
    (d as ReturnType<typeof createDecipheriv> & { setAuthTag(t: Uint8Array): void }).setAuthTag(tag);
  } else {
    d.setAutoPadding(false);
  }
  try {
    plain = Buffer.concat([d.update(enc), d.final()]);
  } catch {
    throw new PassphraseRequired("wrong passphrase");
  }
  const p = new Reader(new Uint8Array(plain));
  if (p.u32() !== p.u32()) throw new PassphraseRequired("wrong passphrase");
  if (p.str() !== "ssh-ed25519") throw new Error("only Ed25519 keys can sign md-signature documents");
  const publicKey = new Uint8Array(p.bytes());
  const priv = p.bytes();
  const comment = p.str();
  if (publicKey.length !== 32 || priv.length !== 64) throw new Error("malformed Ed25519 key");
  return { seed: new Uint8Array(priv.subarray(0, 32)), publicKey, comment };
}
