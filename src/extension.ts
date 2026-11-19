import * as vscode from "vscode";
import { VerifyController, type Host } from "./verify/controller.ts";
import { registerCodeLens, registerDecorations, registerDiagnostics, registerHover, registerStatusBar } from "./ui/editor.ts";
import { SidebarProvider, SignatureView } from "./view/panels.ts";
import { registerFormatterWarnings } from "./formatter.ts";
import { previewPlugin } from "./preview/plugin.ts";
import { keyFingerprint } from "@mdsig/core";

const t = vscode.l10n.t;

export interface Activated {
  ctl: VerifyController;
  view: SignatureView;
  extendMarkdownIt: (md: any) => any;
}

function targetDoc(uri?: vscode.Uri): vscode.TextDocument | undefined {
  if (uri instanceof vscode.Uri) return vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
  const a = vscode.window.activeTextEditor?.document;
  if (a?.languageId === "markdown") return a;
  return vscode.window.visibleTextEditors.find((e) => e.document.languageId === "markdown")?.document;
}

export function activateShared(context: vscode.ExtensionContext, host: Host): Activated {
  const ctl = new VerifyController(host);
  const view = new SignatureView(ctl, context.extensionUri, host.isWeb);
  const sidebar = new SidebarProvider(ctl, context.extensionUri, host.isWeb);
  context.subscriptions.push(
    ctl,
    view,
    sidebar,
    vscode.window.registerWebviewViewProvider("mdsig.panel", sidebar),
    registerDiagnostics(ctl),
    registerCodeLens(ctl),
    registerHover(ctl),
    registerStatusBar(ctl),
    registerDecorations(ctl),
    registerFormatterWarnings(context, ctl),
    vscode.commands.registerCommand("mdsig.verify", async (uri?: vscode.Uri) => {
      const doc = targetDoc(uri);
      if (!doc) return void vscode.window.showInformationMessage(t("Open a Markdown file to verify it."));
      if (!ctl.networkAllowed()) void vscode.window.showWarningMessage(t("This workspace is not trusted, so the signers' keys are not fetched. Trust the workspace to check them."));
      await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: t("Verifying signatures…") }, () => ctl.verify(doc, { online: true }));
      view.show(doc.uri);
    }),
    vscode.commands.registerCommand("mdsig.openView", (uri?: vscode.Uri, index?: number) => view.show(targetDoc(uri)?.uri, typeof index === "number" ? index : undefined)),
    vscode.commands.registerCommand("mdsig.showDetails", (uri?: vscode.Uri) => view.show(targetDoc(uri)?.uri)),
    vscode.commands.registerCommand("mdsig.acceptNewKey", async (uri?: vscode.Uri) => {
      const doc = targetDoc(uri);
      if (!doc) return;
      const ok = t("Accept");
      const pick = await vscode.window.showWarningMessage(
        t("The signer's key is different from the one recorded before. Accept it only if you know the signer changed their key."),
        { modal: true },
        ok,
      );
      if (pick !== ok) return;
      ctl.acceptNewKey(doc.uri);
      await ctl.verify(doc, { online: true });
    }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("mdsig.trustKey", async (uri: vscode.Uri | undefined, signer: string, key: string, fingerprint: string) => {
      if (!signer || !key) return;
      const ok = t("Trust");
      const pick = await vscode.window.showInformationMessage(
        t("Trust this key for {0}?", signer),
        { modal: true, detail: t("{0}\n\nCheck the fingerprint with the signer through another channel if you can. Later documents from {1} with a different key will be reported.", fingerprint, signer) },
        ok,
      );
      if (pick !== ok) return;
      await ctl.trustKey(signer, key);
      const doc = targetDoc(uri);
      if (doc) await ctl.verify(doc, { online: true });
    }),
    vscode.commands.registerCommand("mdsig.manageTrustedSigners", async () => {
      const known = await ctl.knownSigners().read();
      const items = await Promise.all(Object.entries(known).map(async ([signer, key]) => ({ label: signer, description: await keyFingerprint(key).catch(() => "?"), signer })));
      if (!items.length) return void vscode.window.showInformationMessage(t("No trusted signers yet."));
      const pick = await vscode.window.showQuickPick(items, { title: t("Trusted signers (keys only)"), placeHolder: t("Choose a signer to stop trusting") });
      if (!pick) return;
      const yes = t("Remove");
      if ((await vscode.window.showWarningMessage(t("Stop trusting the key of {0}? The next document from this signer will show the key as new.", pick.signer), { modal: true }, yes)) !== yes) return;
      await ctl.knownSigners().update((d) => {
        delete d[pick.signer];
      });
      for (const d of vscode.workspace.textDocuments) if (d.languageId === "markdown") void ctl.verify(d, { online: false });
    }),
  );
  return { ctl, view, extendMarkdownIt: previewPlugin(ctl) };
}
