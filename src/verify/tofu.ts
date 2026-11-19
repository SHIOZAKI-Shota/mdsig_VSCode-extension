import type { TofuStore, VerifyResult } from "@mdsig/core";

export interface KnownSigners {
  read(): Promise<Record<string, string>>;
  update(change: (d: Record<string, string>) => void): Promise<void>;
}

export interface NewKey {
  signer: string;
  key: string;
  fingerprint: string;
}

export async function knownSignersStore(known: KnownSigners): Promise<TofuStore> {
  const data = await known.read();
  return {
    get: (signer) => (Object.hasOwn(data, signer) ? data[signer] : undefined),
    async set(signer, pubkey) {
      data[signer] = pubkey;
      await known.update((d) => {
        d[signer] = pubkey;
      }).catch(() => undefined);
    },
  };
}

export function newKeys(result: VerifyResult): NewKey[] {
  const out: NewKey[] = [];
  for (const s of result.signatures) {
    if (s.tofu?.status !== "new" || !s.fields.signer || !s.fields.pubkey) continue;
    const k = { signer: s.fields.signer, key: s.fields.pubkey, fingerprint: s.tofu.fingerprint };
    if (!out.some((o) => o.signer === k.signer && o.key === k.key)) out.push(k);
  }
  return out;
}
