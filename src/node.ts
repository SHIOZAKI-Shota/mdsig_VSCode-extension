import * as vscode from "vscode";
import { activateShared } from "./extension.ts";
import { FileTofuStore, storedKeyDirectories } from "./state/files.ts";
import { gpgKeyring } from "./keys/gpg.ts";
import { KeyStore } from "./keys/store.ts";
import { registerKeySetup, registerManageKeys, registerSigning } from "./sign/sign.ts";

export function activate(context: vscode.ExtensionContext) {
  const tofu = new FileTofuStore();
  const { ctl, extendMarkdownIt } = activateShared(context, {
    isWeb: false,
    tofuStore: tofu,
    flushTofu: () => tofu.flush().catch(() => undefined),
    keyDirectories: async () => [...(await storedKeyDirectories()), ...vscode.workspace.getConfiguration("mdsig").get<string[]>("keyDirectories", [])],
    pgpKeyring: gpgKeyring,
  });
  const store = new KeyStore(context);
  const setup = registerKeySetup(context, store);
  context.subscriptions.push(setup.disposable, registerSigning(context, ctl, store, setup.open), registerManageKeys(store));
  return { extendMarkdownIt };
}

export function deactivate() {}
