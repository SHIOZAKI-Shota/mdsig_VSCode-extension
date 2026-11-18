import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ed25519Verify, fromBase64, sshFingerprint } from "@mdsig/core";
import { PassphraseRequired, isEncrypted, readOpenSshKey } from "../../src/keys/openssh.ts";
import { agentSigner, listAgentKeys } from "../../src/keys/sshAgent.ts";

const dir = mkdtempSync(join(tmpdir(), "mdsig-keys-"));
const keygen = (name: string, pass: string, extra: string[] = []) => {
  const f = join(dir, name);
  execFileSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", pass, "-C", name, "-f", f, ...extra]);
  return { pem: readFileSync(f, "utf8"), pub: fromBase64(readFileSync(`${f}.pub`, "utf8").split(" ")[1]!).subarray(19), file: f };
};

test("an unencrypted OpenSSH key is read", () => {
  const k = keygen("plain", "");
  assert.equal(isEncrypted(k.pem), false);
  assert.deepEqual(readOpenSshKey(k.pem).publicKey, new Uint8Array(k.pub));
});

test("an encrypted OpenSSH key needs its passphrase", () => {
  const k = keygen("enc", "correct horse");
  assert.equal(isEncrypted(k.pem), true);
  assert.throws(() => readOpenSshKey(k.pem), PassphraseRequired);
  assert.throws(() => readOpenSshKey(k.pem, "wrong"), PassphraseRequired);
  const r = readOpenSshKey(k.pem, "correct horse");
  assert.deepEqual(r.publicKey, new Uint8Array(k.pub));
  assert.equal(r.comment, "enc");
});

test("the ssh-agent lists Ed25519 keys and signs raw payloads", async () => {
  const sock = join(dir, "agent.sock");
  const agent = spawn("ssh-agent", ["-D", "-a", sock], { stdio: "ignore" });
  try {
    for (let i = 0; i < 50; i++) {
      try {
        readFileSync(sock);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    const k = keygen("agent", "");
    execFileSync("ssh-add", ["-q", k.file], { env: { ...process.env, SSH_AUTH_SOCK: sock } });
    const keys = await listAgentKeys(sock);
    assert.equal(keys.length, 1);
    assert.equal(keys[0]!.fingerprint, await sshFingerprint(new Uint8Array(k.pub)));
    const data = new TextEncoder().encode("md-signature/v1\nalg=ed25519");
    const sig = await agentSigner(keys[0]!, sock).sign(data);
    assert.equal(sig.length, 64);
    assert.ok(await ed25519Verify(keys[0]!.publicKey, sig, data));
  } finally {
    agent.kill();
  }
});
