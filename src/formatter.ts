import * as vscode from "vscode";
import type { Entry, VerifyController } from "./verify/controller.ts";

const t = vscode.l10n.t;

function riskySettings(uri: vscode.Uri): string[] {
  const cfg = vscode.workspace.getConfiguration(undefined, { uri, languageId: "markdown" });
  const out: string[] = [];
  if (cfg.get<boolean>("editor.formatOnSave")) out.push("editor.formatOnSave");
  if (cfg.get<boolean>("files.trimTrailingWhitespace")) out.push("files.trimTrailingWhitespace");
  const actions = cfg.get<Record<string, unknown> | string[]>("editor.codeActionsOnSave");
  const keys = Array.isArray(actions) ? actions : Object.entries(actions ?? {}).filter(([, v]) => v === true || v === "explicit" || v === "always").map(([k]) => k);
  if (keys.some((k) => /fixAll|format/i.test(k))) out.push("editor.codeActionsOnSave");
  return out;
}

const hasSignatures = (e: Entry) => e.result.signatures.some((s) => s.fields.method);
const allHashesOk = (e: Entry) => e.result.signatures.length > 0 && e.result.signatures.every((s) => s.hashOk !== false);
const loose = (s: string) => s.replace(/[\s*_\-\\]+/g, "");

export function registerFormatterWarnings(context: vscode.ExtensionContext, ctl: VerifyController): vscode.Disposable {
  const warned = new Set<string>();
  const lastValid = new Map<string, string>();
  const savedVersion = new Map<string, number>();

  const offerFix = async (uri: vscode.Uri, settings: string[]) => {
    const off = t("Turn off for Markdown in this workspace");
    const never = t("Don't show again");
    const pick = await vscode.window.showWarningMessage(
      t("This document is signed. Saving it with these settings can change it and break the signatures: {0}", settings.join(", ")),
      off,
      never,
    );
    if (pick === off) {
      const cfg = vscode.workspace.getConfiguration(undefined, { uri, languageId: "markdown" });
      const target = vscode.workspace.workspaceFolders ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
      if (settings.includes("editor.formatOnSave")) await cfg.update("editor.formatOnSave", false, target, true);
      if (settings.includes("files.trimTrailingWhitespace")) await cfg.update("files.trimTrailingWhitespace", false, target, true);
      if (settings.includes("editor.codeActionsOnSave")) await cfg.update("editor.codeActionsOnSave", {}, target, true);
    }
    if (pick === never) await vscode.workspace.getConfiguration("mdsig").update("warnFormatters", false, vscode.ConfigurationTarget.Global);
  };

  const onVerify = async (e: Entry) => {
    const uri = vscode.Uri.parse(e.uri);
    if (allHashesOk(e)) lastValid.set(e.uri, e.text);
    const enabled = vscode.workspace.getConfiguration("mdsig").get<boolean>("warnFormatters", true);
    if (enabled && hasSignatures(e) && !warned.has(e.uri)) {
      warned.add(e.uri);
      const risky = riskySettings(uri);
      if (risky.length) void offerFix(uri, risky);
    }
    const saved = savedVersion.get(e.uri);
    const before = lastValid.get(e.uri);
    if (saved === e.version && before !== undefined && before !== e.text && !allHashesOk(e) && loose(before) === loose(e.text)) {
      savedVersion.delete(e.uri);
      const undo = t("Undo");
      const pick = await vscode.window.showWarningMessage(t("Saving reformatted this document and broke its signatures. A formatter or an editor setting probably changed spaces or symbols."), undo);
      if (pick === undo) {
        const ed = vscode.window.visibleTextEditors.find((x) => x.document.uri.toString() === e.uri);
        if (ed) {
          await vscode.window.showTextDocument(ed.document, ed.viewColumn);
          await vscode.commands.executeCommand("undo");
        }
      }
    }
  };

  return vscode.Disposable.from(
    ctl.onDidVerify((e) => void onVerify(e)),
    vscode.workspace.onDidSaveTextDocument((d) => d.languageId === "markdown" && savedVersion.set(d.uri.toString(), d.version)),
    vscode.workspace.onDidCloseTextDocument((d) => {
      lastValid.delete(d.uri.toString());
      savedVersion.delete(d.uri.toString());
    }),
  );
}
