import * as vscode from "vscode";
import type { VerifyController } from "../verify/controller.ts";
import { buildModel, type ViewModel } from "./model.ts";

const t = vscode.l10n.t;

function nonce(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export function webviewHtml(webview: vscode.Webview, extUri: vscode.Uri, mode: string, script: string, isWeb: boolean): string {
  const n = nonce();
  const css = webview.asWebviewUri(vscode.Uri.joinPath(extUri, "media", "view.css"));
  const js = webview.asWebviewUri(vscode.Uri.joinPath(extUri, "dist", script));
  return `<!doctype html><html lang="${vscode.env.language}"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${n}'; img-src ${webview.cspSource} data:;">
<meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="${css}"></head>
<body data-mode="${mode}" data-web="${isWeb}"><div id="root"></div><script nonce="${n}" src="${js}"></script></body></html>`;
}

const fileName = (uri: vscode.Uri) => uri.path.split("/").pop() ?? uri.toString();

function modelFor(ctl: VerifyController, doc: vscode.TextDocument | undefined): { model: ViewModel | null; doc: boolean } {
  if (!doc || doc.languageId !== "markdown") return { model: null, doc: false };
  const e = ctl.get(doc);
  if (!e || (e.result.signatures.length === 0 && !e.layout.tail)) return { model: null, doc: true };
  const full = vscode.workspace.getConfiguration("mdsig").get<boolean>("view.fullText", false);
  return { model: buildModel(t, e, fileName(doc.uri), full), doc: true };
}

export function emptyStrings(): Record<string, string> {
  return {
    sign: t("Sign"),
    verify: t("Verify"),
    noDoc: t("Open a Markdown file to see its signatures."),
    unsigned: t("This document has no signatures yet."),
  };
}

function lastMarkdownEditor(): vscode.TextEditor | undefined {
  const a = vscode.window.activeTextEditor;
  if (a?.document.languageId === "markdown") return a;
  return vscode.window.visibleTextEditors.find((e) => e.document.languageId === "markdown");
}

async function jump(uri: vscode.Uri | undefined, line: number) {
  if (!uri) return;
  const doc = await vscode.workspace.openTextDocument(uri);
  const pos = new vscode.Position(Math.max(0, line - 1), 0);
  const ed = await vscode.window.showTextDocument(doc, { viewColumn: vscode.window.visibleTextEditors.find((e) => e.document === doc)?.viewColumn ?? vscode.ViewColumn.One, selection: new vscode.Range(pos, pos) });
  ed.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}

export class SignatureView implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private uri: vscode.Uri | undefined;
  private readonly subs: vscode.Disposable[] = [];

  private readonly ctl: VerifyController;
  private readonly extUri: vscode.Uri;
  private readonly isWeb: boolean;

  constructor(ctl: VerifyController, extUri: vscode.Uri, isWeb: boolean) {
    this.ctl = ctl;
    this.extUri = extUri;
    this.isWeb = isWeb;
    this.subs.push(
      ctl.onDidVerify((e) => e.uri === this.uri?.toString() && this.push()),
      vscode.window.onDidChangeActiveTextEditor((ed) => {
        if (this.panel && ed?.document.languageId === "markdown") {
          this.uri = ed.document.uri;
          this.push();
        }
      }),
      vscode.window.onDidChangeTextEditorVisibleRanges((ev) => {
        if (this.panel && ev.textEditor.document.uri.toString() === this.uri?.toString() && ev.visibleRanges[0]) {
          void this.panel.webview.postMessage({ type: "reveal", line: ev.visibleRanges[0].start.line + 1 });
        }
      }),
    );
  }

  show(uri?: vscode.Uri, focus?: number) {
    this.uri = uri ?? lastMarkdownEditor()?.document.uri ?? this.uri;
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel("mdsig.view", t("Signatures"), { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(this.extUri, "media"), vscode.Uri.joinPath(this.extUri, "dist")],
        retainContextWhenHidden: false,
      });
      this.panel.iconPath = vscode.Uri.joinPath(this.extUri, "media", "icon.png");
      this.panel.webview.html = webviewHtml(this.panel.webview, this.extUri, "view", "view.js", this.isWeb);
      this.panel.webview.onDidReceiveMessage((m) => this.onMessage(m));
      this.panel.onDidDispose(() => (this.panel = undefined));
    } else {
      this.panel.reveal(undefined, true);
      this.push();
    }
    if (focus) {
      const span = this.uri && this.ctl.get(this.uri)?.layout.blocks.find((b) => b.index === focus);
      if (span) setTimeout(() => void this.panel?.webview.postMessage({ type: "reveal", line: span.from, focus: true }), 200);
    }
  }

  private onMessage(m: { type: string; line?: number; id?: string }) {
    if (m.type === "ready") this.push();
    if (m.type === "jump" && m.line) void jump(this.uri, m.line);
    if (m.type === "accept" && this.uri) void vscode.commands.executeCommand("mdsig.acceptNewKey", this.uri);
    if (m.type === "command" && m.id?.startsWith("mdsig.")) void vscode.commands.executeCommand(m.id, this.uri);
  }

  private push() {
    if (!this.panel) return;
    const doc = this.uri && vscode.workspace.textDocuments.find((d) => d.uri.toString() === this.uri!.toString());
    const { model, doc: isDoc } = modelFor(this.ctl, doc);
    if (doc) this.panel.title = `${t("Signatures")}: ${fileName(doc.uri)}`;
    void this.panel.webview.postMessage({ type: "model", model, strings: emptyStrings(), doc: isDoc });
  }

  dispose() {
    this.panel?.dispose();
    this.subs.forEach((s) => s.dispose());
  }
}

export class SidebarProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private view: vscode.WebviewView | undefined;
  private readonly subs: vscode.Disposable[] = [];

  private readonly ctl: VerifyController;
  private readonly extUri: vscode.Uri;
  private readonly isWeb: boolean;

  constructor(ctl: VerifyController, extUri: vscode.Uri, isWeb: boolean) {
    this.ctl = ctl;
    this.extUri = extUri;
    this.isWeb = isWeb;
    this.subs.push(ctl.onDidVerify(() => this.push()), vscode.window.onDidChangeActiveTextEditor(() => this.push()));
  }

  resolveWebviewView(view: vscode.WebviewView) {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.extUri, "media"), vscode.Uri.joinPath(this.extUri, "dist")] };
    view.webview.html = webviewHtml(view.webview, this.extUri, "panel", "view.js", this.isWeb);
    view.webview.onDidReceiveMessage((m: { type: string; line?: number; id?: string }) => {
      const uri = lastMarkdownEditor()?.document.uri;
      if (m.type === "ready") this.push();
      if (m.type === "jump" && m.line) void jump(uri, m.line);
      if (m.type === "accept" && uri) void vscode.commands.executeCommand("mdsig.acceptNewKey", uri);
      if (m.type === "command" && m.id?.startsWith("mdsig.")) void vscode.commands.executeCommand(m.id, uri);
    });
    view.onDidChangeVisibility(() => this.push());
  }

  private push() {
    if (!this.view?.visible) return;
    const { model, doc } = modelFor(this.ctl, lastMarkdownEditor()?.document);
    void this.view.webview.postMessage({ type: "model", model, strings: emptyStrings(), doc });
  }

  dispose() {
    this.subs.forEach((s) => s.dispose());
  }
}
