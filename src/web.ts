import * as vscode from "vscode";
import { activateShared } from "./extension.ts";
import { MementoTofuStore } from "./state/memento.ts";

export function activate(context: vscode.ExtensionContext) {
  const { extendMarkdownIt } = activateShared(context, {
    isWeb: true,
    tofuStore: new MementoTofuStore(context.globalState),
    keyDirectories: async () => vscode.workspace.getConfiguration("mdsig").get<string[]>("keyDirectories", []),
  });
  return { extendMarkdownIt };
}

export function deactivate() {}
