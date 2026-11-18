import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { TofuStore } from "@mdsig/core";
import { mdsigConfigFile } from "./paths.ts";

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

async function writeAtomic(file: string, data: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, data, { mode: 0o600 });
  await fs.rename(tmp, file);
}

export class FileTofuStore implements TofuStore {
  private data: Record<string, string> | null = null;
  private dirty = false;
  private readonly file: string;
  constructor(file = mdsigConfigFile("known_signers.json")) {
    this.file = file;
  }

  private async load(): Promise<Record<string, string>> {
    if (!this.dirty) this.data = await readJson<Record<string, string>>(this.file, {});
    return this.data!;
  }

  async get(signer: string): Promise<string | undefined> {
    const d = await this.load();
    return Object.hasOwn(d, signer) ? d[signer] : undefined;
  }

  async set(signer: string, pubkey: string): Promise<void> {
    const d = await this.load();
    d[signer] = pubkey;
    this.dirty = true;
  }

  async flush(): Promise<void> {
    if (!this.dirty || !this.data) return;
    const current = await readJson<Record<string, string>>(this.file, {});
    await writeAtomic(this.file, JSON.stringify({ ...current, ...this.data }, null, 2) + "\n");
    this.dirty = false;
  }
}

export async function storedKeyDirectories(): Promise<string[]> {
  const list = await readJson<unknown>(mdsigConfigFile("key_directories.json"), []);
  return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : [];
}
