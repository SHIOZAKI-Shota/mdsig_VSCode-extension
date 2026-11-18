import * as net from "node:net";
import { sshFingerprint, type Signer } from "@mdsig/core";

const REQUEST_IDENTITIES = 11;
const IDENTITIES_ANSWER = 12;
const SIGN_REQUEST = 13;
const SIGN_RESPONSE = 14;

export interface AgentKey {
  publicKey: Uint8Array;
  comment: string;
  fingerprint: string;
}

function u32(n: number): Uint8Array {
  return new Uint8Array([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
}

function sshString(b: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + b.length);
  out.set(u32(b.length));
  out.set(b, 4);
  return out;
}

class Reader {
  private o = 0;
  private readonly b: Uint8Array;
  constructor(b: Uint8Array) {
    this.b = b;
  }
  u8(): number {
    if (this.o + 1 > this.b.length) throw new Error("short agent message");
    return this.b[this.o++]!;
  }
  u32(): number {
    if (this.o + 4 > this.b.length) throw new Error("short agent message");
    const v = ((this.b[this.o]! << 24) | (this.b[this.o + 1]! << 16) | (this.b[this.o + 2]! << 8) | this.b[this.o + 3]!) >>> 0;
    this.o += 4;
    return v;
  }
  bytes(): Uint8Array {
    const n = this.u32();
    if (this.o + n > this.b.length) throw new Error("short agent message");
    const v = this.b.subarray(this.o, this.o + n);
    this.o += n;
    return v;
  }
}

export function agentSocket(): string | undefined {
  if (process.env.SSH_AUTH_SOCK) return process.env.SSH_AUTH_SOCK;
  return process.platform === "win32" ? "\\\\.\\pipe\\openssh-ssh-agent" : undefined;
}

function request(socket: string, body: Uint8Array): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const conn = net.createConnection(socket);
    const chunks: Buffer[] = [];
    let total = 0;
    const timer = setTimeout(() => {
      conn.destroy();
      reject(new Error("ssh-agent did not answer"));
    }, 10_000);
    conn.on("connect", () => {
      const msg = new Uint8Array(4 + body.length);
      msg.set(u32(body.length));
      msg.set(body, 4);
      conn.write(msg);
    });
    conn.on("data", (d: Buffer) => {
      chunks.push(d);
      total += d.length;
      const all = Buffer.concat(chunks, total);
      if (all.length >= 4) {
        const len = all.readUInt32BE(0);
        if (len > 256 * 1024) {
          conn.destroy();
          reject(new Error("ssh-agent message too large"));
        } else if (all.length >= 4 + len) {
          clearTimeout(timer);
          conn.end();
          resolve(new Uint8Array(all.subarray(4, 4 + len)));
        }
      }
    });
    conn.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

const ED25519 = new TextEncoder().encode("ssh-ed25519");
const isEd25519Blob = (blob: Uint8Array) => {
  try {
    const r = new Reader(blob);
    const type = r.bytes();
    return type.length === ED25519.length && type.every((b, i) => b === ED25519[i]) && r.bytes().length === 32;
  } catch {
    return false;
  }
};

export async function listAgentKeys(socket = agentSocket()): Promise<AgentKey[]> {
  if (!socket) return [];
  const res = new Reader(await request(socket, new Uint8Array([REQUEST_IDENTITIES])));
  if (res.u8() !== IDENTITIES_ANSWER) throw new Error("ssh-agent refused to list keys");
  const n = res.u32();
  const out: AgentKey[] = [];
  for (let i = 0; i < n && i < 1000; i++) {
    const blob = res.bytes();
    const comment = new TextDecoder().decode(res.bytes());
    if (!isEd25519Blob(blob)) continue;
    const r = new Reader(blob);
    r.bytes();
    const publicKey = new Uint8Array(r.bytes());
    out.push({ publicKey, comment, fingerprint: await sshFingerprint(publicKey) });
  }
  return out;
}

export function agentSigner(key: AgentKey, socket = agentSocket()): Signer {
  const blob = new Uint8Array([...sshString(ED25519), ...sshString(key.publicKey)]);
  return {
    alg: "ed25519",
    publicKey: key.publicKey,
    async sign(data: Uint8Array): Promise<Uint8Array> {
      if (!socket) throw new Error("no ssh-agent");
      const body = new Uint8Array([SIGN_REQUEST, ...sshString(blob), ...sshString(data), ...u32(0)]);
      const res = new Reader(await request(socket, body));
      if (res.u8() !== SIGN_RESPONSE) throw new Error("ssh-agent refused to sign");
      const sig = new Reader(res.bytes());
      const format = sig.bytes();
      const raw = sig.bytes();
      if (!(format.length === ED25519.length && format.every((b, i) => b === ED25519[i])) || raw.length !== 64) throw new Error("ssh-agent returned an unexpected signature");
      return new Uint8Array(raw);
    },
  };
}
