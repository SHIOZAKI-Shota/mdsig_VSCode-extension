import * as vscode from "vscode";
import type { BlockResult } from "@mdsig/core";
import type { Entry, VerifyController } from "../verify/controller.ts";
import { lensText, mark, methodLabel, signerLabel, statusText, summarize, summaryText, tone, type Tone } from "../verify/present.ts";

const t = vscode.l10n.t;

const range = (from: number, to: number) => new vscode.Range(from - 1, 0, to - 1, Number.MAX_SAFE_INTEGER);

export function registerDiagnostics(ctl: VerifyController): vscode.Disposable {
  const coll = vscode.languages.createDiagnosticCollection("mdsig");
  const update = (e: Entry) => {
    const out: vscode.Diagnostic[] = [];
    const { result, layout } = e;
    for (const s of result.signatures) {
      if (s.status === "valid" || (s.status === "unresolved" && s.code === "offline")) continue;
      const span = layout.blocks.find((b) => b.index === s.index);
      if (!span) continue;
      const d = new vscode.Diagnostic(range(span.from, span.from), `#${s.index} ${statusText(t, s)}${s.message ? ` (${s.message})` : ""}`, s.status === "unresolved" ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Error);
      d.source = "md-signature";
      d.code = s.code;
      out.push(d);
    }
    if (layout.tail) {
      const d = new vscode.Diagnostic(range(layout.tail.from, layout.tail.to), t("This text comes after the last signature, so no signature covers it"), vscode.DiagnosticSeverity.Error);
      d.source = "md-signature";
      out.push(d);
    }
    if (layout.strayLine) {
      const d = new vscode.Diagnostic(range(layout.strayLine, layout.strayLine), t("A signature marker inside the body is treated as text and is not verified"), vscode.DiagnosticSeverity.Information);
      d.source = "md-signature";
      out.push(d);
    }
    const last = layout.blocks.at(-1);
    if (last && result.agreement.status === "pending") {
      const d = new vscode.Diagnostic(range(last.from, last.from), summaryText(t, result).detail, vscode.DiagnosticSeverity.Information);
      d.source = "md-signature";
      out.push(d);
    }
    if (last && result.agreement.status === "violated") {
      const d = new vscode.Diagnostic(range(last.from, last.from), t("Signatures were made out of the required order"), vscode.DiagnosticSeverity.Error);
      d.source = "md-signature";
      out.push(d);
    }
    coll.set(vscode.Uri.parse(e.uri), out);
  };
  const sub = ctl.onDidVerify(update);
  const close = vscode.workspace.onDidCloseTextDocument((d) => coll.delete(d.uri));
  return vscode.Disposable.from(coll, sub, close);
}

export function registerCodeLens(ctl: VerifyController): vscode.Disposable {
  const changed = new vscode.EventEmitter<void>();
  const provider: vscode.CodeLensProvider = {
    onDidChangeCodeLenses: changed.event,
    provideCodeLenses(doc) {
      const e = ctl.get(doc);
      if (!e) return [];
      const lenses: vscode.CodeLens[] = [];
      for (const s of e.result.signatures) {
        const span = e.layout.blocks.find((b) => b.index === s.index);
        if (!span) continue;
        const r = range(span.from, span.from);
        lenses.push(new vscode.CodeLens(r, { title: lensText(t, s), command: "mdsig.openView", arguments: [doc.uri, s.index], tooltip: t("Open the signature view") }));
        if (s.code === "key-changed") lenses.push(new vscode.CodeLens(r, { title: t("Accept the new key"), command: "mdsig.acceptNewKey", arguments: [doc.uri] }));
      }
      if (e.layout.tail) lenses.push(new vscode.CodeLens(range(e.layout.tail.from, e.layout.tail.from), { title: `✗ ${t("Not covered by any signature")}`, command: "mdsig.openView", arguments: [doc.uri] }));
      return lenses;
    },
  };
  const sub = ctl.onDidVerify(() => changed.fire());
  return vscode.Disposable.from(vscode.languages.registerCodeLensProvider({ language: "markdown" }, provider), sub, changed);
}

export function registerHover(ctl: VerifyController): vscode.Disposable {
  return vscode.languages.registerHoverProvider({ language: "markdown" }, {
    provideHover(doc, pos) {
      const e = ctl.get(doc);
      const span = e?.layout.blocks.find((b) => pos.line + 1 >= b.from && pos.line + 1 <= b.to);
      const s = span && e!.result.signatures.find((x) => x.index === span.index);
      if (!s) return;
      return new vscode.Hover(hoverMarkdown(s), range(span!.from, span!.to));
    },
  });
}

function hoverMarkdown(s: BlockResult): vscode.MarkdownString {
  const md = new vscode.MarkdownString(undefined, true);
  md.isTrusted = false;
  md.supportHtml = false;
  const esc = (x: string) => x.replace(/[\\`*_{}[\]()#+\-.!|<>]/g, "\\$&");
  md.appendMarkdown(`**${mark(s)} #${s.index} ${esc(statusText(t, s))}**\n\n`);
  const f = s.fields;
  const rows: [string, string | undefined][] = [
    [t("Signer"), signerLabel(s)],
    [t("Method"), methodLabel(t, f.method)],
    [t("Role"), f.role],
    [t("Reason"), f.reason],
    [t("Signed at (claimed)"), f.ts],
    [t("Timestamp"), s.tsa?.verified ? `${s.tsa.genTime} (${s.tsa.signer})` : s.tsa ? t("present, not verified") : undefined],
    [t("Key from"), s.key?.source ?? (s.pgp?.keySource ? `OpenPGP ${s.pgp.fpr ?? ""} (${s.pgp.keySource})` : undefined)],
    [t("Expires"), f.expires],
    [t("Covers"), s.partial ? s.partial.sections.join(", ") : undefined],
    [t("Withdrawal check"), s.revocation ? s.revocation.status : undefined],
  ];
  for (const [k, v] of rows) if (v) md.appendMarkdown(`${esc(k)}: ${esc(v)}  \n`);
  for (const r of s.resources ?? []) md.appendMarkdown(`${r.status === "ok" ? "✓" : r.status === "not-checked" ? "−" : "✗"} ${esc(r.ref)}  \n`);
  if (s.message) md.appendMarkdown(`\n${esc(s.message)}\n`);
  return md;
}

export function registerStatusBar(ctl: VerifyController): vscode.Disposable {
  const item = vscode.window.createStatusBarItem("mdsig.status", vscode.StatusBarAlignment.Right, 100);
  item.name = "md-signature";
  item.command = "mdsig.openView";
  const update = () => {
    const doc = vscode.window.activeTextEditor?.document;
    const e = doc && doc.languageId === "markdown" ? ctl.get(doc) : undefined;
    if (!e || (e.result.signatures.length === 0 && !e.layout.tail)) {
      item.hide();
      return;
    }
    const k = summarize(e.result);
    const s = summaryText(t, e.result);
    const icon = k === "verified" ? "$(pass-filled)" : k === "pending" ? "$(clock)" : k === "offline" ? "$(circle-slash)" : k === "incomplete" ? "$(question)" : "$(error)";
    item.text = `${icon} ${s.title}`;
    item.tooltip = s.detail;
    item.backgroundColor = k === "failed" || k === "violated" || k === "broken" ? new vscode.ThemeColor("statusBarItem.errorBackground") : undefined;
    item.show();
  };
  return vscode.Disposable.from(item, ctl.onDidVerify(update), vscode.window.onDidChangeActiveTextEditor(update));
}

const TONE_COLOR: Record<Tone, string> = { ok: "charts.green", bad: "charts.red", warn: "charts.yellow", muted: "disabledForeground" };
const TONE_BG: Record<Tone, string> = { ok: "rgba(46, 160, 67, 0.08)", bad: "rgba(218, 54, 51, 0.10)", warn: "rgba(210, 153, 34, 0.10)", muted: "rgba(128, 128, 128, 0.07)" };

export function registerDecorations(ctl: VerifyController): vscode.Disposable {
  const band = {} as Record<Tone, vscode.TextEditorDecorationType>;
  for (const k of Object.keys(TONE_COLOR) as Tone[]) {
    const c = new vscode.ThemeColor(TONE_COLOR[k]);
    band[k] = vscode.window.createTextEditorDecorationType({ isWholeLine: true, backgroundColor: TONE_BG[k], overviewRulerColor: c, overviewRulerLane: vscode.OverviewRulerLane.Left });
  }
  const covered = vscode.window.createTextEditorDecorationType({ isWholeLine: true, backgroundColor: new vscode.ThemeColor("editor.rangeHighlightBackground") });
  const label = vscode.window.createTextEditorDecorationType({ after: { color: new vscode.ThemeColor("descriptionForeground"), margin: "0 0 0 2em", fontStyle: "italic" } });
  const tailType = vscode.window.createTextEditorDecorationType({ isWholeLine: true, backgroundColor: TONE_BG.bad, overviewRulerColor: new vscode.ThemeColor("charts.red"), overviewRulerLane: vscode.OverviewRulerLane.Left });

  const paint = (ed: vscode.TextEditor | undefined) => {
    if (!ed || ed.document.languageId !== "markdown") return;
    const e = ctl.get(ed.document);
    const byTone: Record<Tone, vscode.Range[]> = { ok: [], bad: [], warn: [], muted: [] };
    const cover: vscode.Range[] = [];
    const labels: vscode.DecorationOptions[] = [];
    if (e) {
      for (const s of e.result.signatures) {
        const span = e.layout.blocks.find((b) => b.index === s.index);
        if (span) byTone[tone(s)].push(range(span.from, span.to));
      }
      const line = ed.selection.active.line + 1;
      const cur = e.layout.blocks.find((b) => line >= b.from && line <= b.to);
      const cov = cur && e.layout.coverage.find((c) => c.index === cur.index);
      if (cov) {
        for (const r of cov.ranges) {
          cover.push(range(r.from, r.to));
          const text = cov.sections ? t("#{0} covers section {1}", cur!.index, cov.sections.join(", ")) : cur!.index > 2 ? t("#{0} covers up to here (including #1 to #{1})", cur!.index, cur!.index - 1) : cur!.index === 2 ? t("#{0} covers up to here (including #1)", cur!.index) : t("#{0} covers up to here", cur!.index);
          labels.push({ range: range(r.to, r.to), renderOptions: { after: { contentText: `▲ ${text}` } } });
        }
      }
    }
    for (const k of Object.keys(band) as Tone[]) ed.setDecorations(band[k], byTone[k]);
    ed.setDecorations(covered, cover);
    ed.setDecorations(label, labels);
    ed.setDecorations(tailType, e?.layout.tail ? [range(e.layout.tail.from, e.layout.tail.to)] : []);
  };
  const all = () => vscode.window.visibleTextEditors.forEach(paint);
  return vscode.Disposable.from(
    ...Object.values(band),
    covered,
    label,
    tailType,
    ctl.onDidVerify(all),
    vscode.window.onDidChangeVisibleTextEditors(all),
    vscode.window.onDidChangeTextEditorSelection((ev) => paint(ev.textEditor)),
  );
}
