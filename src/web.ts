import * as vscode from "vscode";
import { activateShared } from "./extension.ts";
import { mementoKnownSigners } from "./state/memento.ts";

export function activate(context: vscode.ExtensionContext) {
  const { extendMarkdownIt } = activateShared(context, {
    isWeb: true,
    known: mementoKnownSigners(context.globalState),
    keyDirectories: async () => vscode.workspace.getConfiguration("mdsig").get<string[]>("keyDirectories", []),
  });
  return { extendMarkdownIt };
}

export function deactivate() {}
