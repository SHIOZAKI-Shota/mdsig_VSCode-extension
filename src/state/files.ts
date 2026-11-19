import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { KnownSigners } from "../verify/tofu.ts";
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

export const fileKnownSigners = (file = mdsigConfigFile("known_signers.json")): KnownSigners => ({
  read: () => readJson<Record<string, string>>(file, {}),
  async update(change) {
    const current = await readJson<Record<string, string>>(file, {});
    change(current);
    await writeAtomic(file, JSON.stringify(current, null, 2) + "\n");
  },
});

export async function storedKeyDirectories(): Promise<string[]> {
  const list = await readJson<unknown>(mdsigConfigFile("key_directories.json"), []);
  return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : [];
}
