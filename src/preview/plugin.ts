import * as vscode from "vscode";
import type { VerifyController } from "../verify/controller.ts";
import { lensText, mark, statusText, summarize, summaryText, summaryTone, tone } from "../verify/present.ts";

const t = vscode.l10n.t;

const HIDDEN_CHARS = new RegExp("[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F-\\u009F\\u00AD\\u061C\\u180E\\u200B\\u200E\\u200F\\u2028-\\u202E\\u2060-\\u2069\\uFEFF]", "g");

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function showHidden(): boolean {
  return vscode.workspace.getConfiguration("mdsig").get<boolean>("preview.showHiddenContent", true);
}

function markChars(escaped: string): string {
  return escaped.replace(HIDDEN_CHARS, (c) => `<span class="mdsig-char" title="${esc(t("Invisible character"))}">⟨U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}⟩</span>`);
}

const COMMENT = /<!--([\s\S]*?)-->/g;

export function previewPlugin(ctl: VerifyController) {
  let lastShown = new Map<string, string>();
  ctl.onDidVerify((e) => {
    const k = `${summarize(e.result)}|${e.result.signatures.map((s) => s.status + s.code).join(",")}`;
    if (lastShown.get(e.uri) !== k) {
      lastShown.set(e.uri, k);
      void vscode.commands.executeCommand("markdown.preview.refresh");
    }
  });

  return (md: any) => {
    const entryFor = (env: any) => {
      const uri = env?.currentDocument;
      return uri ? ctl.get(vscode.Uri.parse(String(uri))) : undefined;
    };

    const renderComments = (html: string, env: any, line: number | undefined): string | null => {
      const e = entryFor(env);
      if (/^\s*<!-- md-signature\s*\n/.test(html) && e && line !== undefined) {
        const span = e.layout.blocks.find((b) => b.from === line);
        const s = span && e.result.signatures.find((x) => x.index === span.index);
        if (s) return `<div class="mdsig-card mdsig-${tone(s)}" title="${esc(statusText(t, s))}">${esc(lensText(t, s))}</div>\n`;
      }
      if (!showHidden() || !COMMENT.test(html)) return null;
      COMMENT.lastIndex = 0;
      return html.replace(COMMENT, (_m, body: string) => `<span class="mdsig-hidden" title="${esc(t("This comment is not shown when rendered, but it is part of what is signed"))}"><span class="mdsig-hidden-label">${esc(t("Hidden comment"))}</span> ${markChars(esc(body.trim()))}</span>`);
    };

    const origBlock = md.renderer.rules.html_block;
    md.renderer.rules.html_block = (tokens: any[], idx: number, options: any, env: any, self: any) => {
      const tok = tokens[idx];
      const out = renderComments(tok.content, env, tok.map ? tok.map[0] + 1 : undefined);
      return out ?? (origBlock ? origBlock(tokens, idx, options, env, self) : tok.content);
    };
    const origInline = md.renderer.rules.html_inline;
    md.renderer.rules.html_inline = (tokens: any[], idx: number, options: any, env: any, self: any) => {
      const out = renderComments(tokens[idx].content, env, undefined);
      return out ?? (origInline ? origInline(tokens, idx, options, env, self) : tokens[idx].content);
    };
    const origText = md.renderer.rules.text;
    md.renderer.rules.text = (tokens: any[], idx: number, options: any, env: any, self: any) => {
      const html = origText ? origText(tokens, idx, options, env, self) : esc(tokens[idx].content);
      return showHidden() ? markChars(html) : html;
    };

    const origRender = md.renderer.render.bind(md.renderer);
    md.renderer.render = (tokens: any[], options: any, env: any) => {
      const body = origRender(tokens, options, env);
      const e = entryFor(env);
      if (!e || (e.result.signatures.length === 0 && !e.layout.tail)) return body;
      const k = summarize(e.result);
      const s = summaryText(t, e.result);
      const symbol = k === "verified" ? "✓" : k === "pending" ? "…" : k === "offline" ? "−" : k === "incomplete" ? "?" : "✗";
      const chips = e.result.signatures.map((x) => `<span class="mdsig-chip mdsig-${tone(x)}">${mark(x)} #${x.index} ${esc(x.fields.signer ?? "")}</span>`).join("");
      const banner = `<div class="mdsig-banner mdsig-${summaryTone(k)}"><span class="mdsig-seal">${symbol}</span><b>${esc(s.title)}</b> <span>${esc(s.detail)}</span><div class="mdsig-chips">${chips}</div></div>\n`;
      return banner + body;
    };
    return md;
  };
}
