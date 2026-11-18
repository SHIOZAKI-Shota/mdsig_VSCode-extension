import * as vscode from "vscode";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { formatOpenSshPrivateKey, formatSshPublicKey, fromBase64, generateEd25519, signerFromSeed, sshFingerprint, toBase64, type PgpSigner, type Signer } from "@mdsig/core";
import { agentSigner, listAgentKeys, type AgentKey } from "./sshAgent.ts";
import { PassphraseRequired, readOpenSshKey } from "./openssh.ts";
import { gpgSigner, listGpgKeys, type GpgKey } from "./gpg.ts";

const t = vscode.l10n.t;

interface StoredMeta {
  id: string;
  label: string;
  publicKey: string;
  created: string;
}

export interface KeyChoice {
  id: string;
  kind: "stored" | "agent" | "file" | "gpg";
  label: string;
  detail: string;
  fingerprint?: string;
  publicKey?: Uint8Array;
  emails?: string[];
  agent?: AgentKey;
  file?: string;
  gpg?: GpgKey;
}

const META = "mdsig.keys";
const secretName = (id: string) => `mdsig.key.${id}`;

export class KeyStore {
  private readonly ctx: vscode.ExtensionContext;
  constructor(ctx: vscode.ExtensionContext) {
    this.ctx = ctx;
  }

  list(): StoredMeta[] {
    return this.ctx.globalState.get<StoredMeta[]>(META, []);
  }

  async create(label: string): Promise<StoredMeta> {
    const k = await generateEd25519();
    const meta: StoredMeta = { id: crypto.randomUUID(), label, publicKey: toBase64(k.publicKey), created: new Date().toISOString() };
    await this.ctx.secrets.store(secretName(meta.id), toBase64(k.seed));
    await this.ctx.globalState.update(META, [...this.list(), meta]);
    k.seed.fill(0);
    return meta;
  }

  async remove(id: string): Promise<void> {
    await this.ctx.secrets.delete(secretName(id));
    await this.ctx.globalState.update(META, this.list().filter((m) => m.id !== id));
  }

  async signer(id: string): Promise<Signer> {
    const s = await this.ctx.secrets.get(secretName(id));
    if (!s) throw new Error(t("The key was not found in the system keychain"));
    const seed = fromBase64(s);
    try {
      return await signerFromSeed(seed);
    } finally {
      seed.fill(0);
    }
  }

  async exportOpenSsh(id: string, dir = path.join(os.homedir(), ".ssh")): Promise<string> {
    const meta = this.list().find((m) => m.id === id);
    const s = await this.ctx.secrets.get(secretName(id));
    if (!meta || !s) throw new Error(t("The key was not found in the system keychain"));
    const base = `mdsig_${meta.label.replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 32) || "key"}`;
    let file = path.join(dir, base);
    for (let i = 2; await exists(file); i++) file = path.join(dir, `${base}_${i}`);
    const seed = fromBase64(s);
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    await fs.writeFile(file, formatOpenSshPrivateKey(seed, fromBase64(meta.publicKey), meta.label), { mode: 0o600, flag: "wx" });
    await fs.writeFile(`${file}.pub`, formatSshPublicKey(fromBase64(meta.publicKey), meta.label) + "\n", { mode: 0o644, flag: "wx" });
    seed.fill(0);
    return file;
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function expandHome(p: string): string {
  return p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : p;
}

async function filePublicKey(file: string): Promise<Uint8Array | undefined> {
  try {
    const pub = await fs.readFile(`${file}.pub`, "utf8");
    const b64 = pub.trim().split(/\s+/)[1];
    if (!b64) return undefined;
    const blob = fromBase64(b64);
    return blob.length === 51 ? blob.subarray(19) : undefined;
  } catch {
    try {
      return readOpenSshKey(await fs.readFile(file, "utf8")).publicKey;
    } catch {
      return undefined;
    }
  }
}

export async function listKeyChoices(store: KeyStore, o: { pgp: boolean }): Promise<KeyChoice[]> {
  const out: KeyChoice[] = [];
  if (o.pgp) {
    for (const g of await listGpgKeys()) out.push({ id: `gpg:${g.fpr}`, kind: "gpg", label: g.uids[0] ?? g.fpr, detail: `OpenPGP ${g.fpr}`, emails: g.emails, gpg: g });
    return out;
  }
  const seen = new Set<string>();
  const add = (c: KeyChoice) => {
    if (c.fingerprint && seen.has(c.fingerprint)) return;
    if (c.fingerprint) seen.add(c.fingerprint);
    out.push(c);
  };
  const configured = vscode.workspace.getConfiguration("mdsig").get<string>("keyFile", "");
  for (const f of [configured, "~/.ssh/id_ed25519"].filter(Boolean).map(expandHome)) {
    if (!(await exists(f))) continue;
    const pub = await filePublicKey(f);
    const fp = pub ? await sshFingerprint(pub) : undefined;
    add({ id: `file:${f}`, kind: "file", label: path.basename(f), detail: fp ? `${t("Key file")} ${fp}` : t("Key file"), fingerprint: fp, publicKey: pub, file: f });
  }
  try {
    for (const a of await listAgentKeys()) add({ id: `agent:${a.fingerprint}`, kind: "agent", label: a.comment || a.fingerprint, detail: `ssh-agent ${a.fingerprint}`, fingerprint: a.fingerprint, publicKey: a.publicKey, agent: a });
  } catch {
  }
  for (const m of store.list()) {
    const pub = fromBase64(m.publicKey);
    const fp = await sshFingerprint(pub);
    add({ id: `stored:${m.id}`, kind: "stored", label: m.label, detail: `${t("Saved in the system keychain")} ${fp}`, fingerprint: fp, publicKey: pub });
  }
  return out;
}

export async function signerFor(c: KeyChoice, store: KeyStore, askPassphrase: (prompt: string) => Promise<string | undefined>): Promise<Signer | PgpSigner> {
  if (c.kind === "gpg") return gpgSigner(c.gpg!);
  if (c.kind === "agent") return agentSigner(c.agent!);
  if (c.kind === "stored") return store.signer(c.id.slice("stored:".length));
  const pem = await fs.readFile(c.file!, "utf8");
  let pass: string | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const k = readOpenSshKey(pem, pass);
      try {
        return await signerFromSeed(k.seed);
      } finally {
        k.seed.fill(0);
      }
    } catch (e) {
      if (!(e instanceof PassphraseRequired)) throw e;
      pass = await askPassphrase(attempt === 0 ? t("Passphrase for {0}", path.basename(c.file!)) : t("Wrong passphrase. Try again for {0}", path.basename(c.file!)));
      if (pass === undefined) throw new Error(t("Cancelled"));
    }
  }
  throw new Error(t("Wrong passphrase"));
}
