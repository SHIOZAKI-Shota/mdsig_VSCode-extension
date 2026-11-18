const vscode = require("vscode");
const assert = require("node:assert/strict");
const path = require("node:path");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, what, ms = 15000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(200);
  }
}

const file = (n) => vscode.Uri.file(path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, n));
async function open(n) {
  const doc = await vscode.workspace.openTextDocument(file(n));
  await vscode.window.showTextDocument(doc);
  return doc;
}
const lenses = async (doc) => (await vscode.commands.executeCommand("vscode.executeCodeLensProvider", doc.uri)) ?? [];
const diags = (doc) => vscode.languages.getDiagnostics(doc.uri).filter((d) => d.source === "md-signature");

const tests = {
  async "a tofu signature verifies and gets a lens"() {
    const doc = await open("valid-single.md");
    const l = await until(async () => (await lenses(doc)).find((x) => x.command?.title.includes("#1")), "lens");
    assert.match(l.command.title, /^✓ #1/);
    assert.equal(diags(doc).length, 0);
  },
  async "a tampered document reports the block"() {
    const doc = await open("tampered.md");
    const d = await until(() => diags(doc)[0], "diagnostic");
    assert.equal(d.severity, vscode.DiagnosticSeverity.Error);
    assert.equal(d.code, "hash-mismatch");
    assert.equal(d.range.start.line, 14);
  },
  async "text after the last signature is flagged"() {
    const doc = await open("unsigned-trailer.md");
    const d = await until(() => diags(doc).find((x) => x.range.start.line === 29), "tail diagnostic");
    assert.equal(d.severity, vscode.DiagnosticSeverity.Error);
  },
  async "offline checks are not errors"() {
    const doc = await open("valid-cosigned.md");
    const ls = await until(async () => {
      const x = await lenses(doc);
      return x.length >= 2 ? x : null;
    }, "two lenses");
    assert.ok(ls.every((x) => x.command.title.startsWith("−")), ls.map((x) => x.command.title).join(" | "));
    assert.equal(diags(doc).filter((d) => d.severity === vscode.DiagnosticSeverity.Error).length, 0);
  },
  async "editing a signed document breaks the signature live"() {
    const doc = await open("valid-single.md");
    await until(async () => (await lenses(doc)).length, "lens");
    const ed = vscode.window.activeTextEditor;
    await ed.edit((b) => b.insert(new vscode.Position(2, 0), "Changed. "));
    const d = await until(() => diags(doc).find((x) => x.code === "hash-mismatch"), "hash mismatch after edit");
    assert.ok(d);
    await ed.edit((b) => b.delete(new vscode.Range(2, 0, 2, "Changed. ".length)));
    await until(() => diags(doc).length === 0, "valid again after undo");
  },
  async "the sign form and the key setup open as tabs"() {
    const doc = await open("valid-single.md");
    await vscode.commands.executeCommand("mdsig.sign", doc.uri);
    await vscode.commands.executeCommand("mdsig.setupKey");
    const tabs = () => vscode.window.tabGroups.all.flatMap((g) => g.tabs).filter((t) => t.input instanceof vscode.TabInputWebview).map((t) => t.input.viewType);
    await until(() => tabs().some((v) => v.endsWith("mdsig.sign")) && tabs().some((v) => v.endsWith("mdsig.setup")), `webview tabs (${tabs().join(", ")})`);
  },
  async "the preview shows the result, hidden comments, and invisible characters"() {
    const doc = await open("valid-single.md");
    await until(async () => (await lenses(doc)).length, "lens");
    const html = await vscode.commands.executeCommand("markdown.api.render", doc);
    assert.match(html, /mdsig-banner mdsig-ok/);
    assert.match(html, /mdsig-card/);
    const hidden = await vscode.workspace.openTextDocument({ language: "markdown", content: "Pay <!-- secret clause --> now \u202E here\n" });
    const h2 = await vscode.commands.executeCommand("markdown.api.render", hidden);
    assert.match(h2, /mdsig-hidden/);
    assert.match(h2, /secret clause/);
    assert.match(h2, /U\+202E/);
  },
  async "commands run"() {
    await open("valid-scoped-edited.md");
    await vscode.commands.executeCommand("mdsig.openView");
    await vscode.commands.executeCommand("mdsig.verify");
    const all = await vscode.commands.getCommands(true);
    for (const c of ["mdsig.sign", "mdsig.timestamp", "mdsig.setupKey", "mdsig.manageKeys"]) assert.ok(all.includes(c), c);
  },
};

exports.run = async function () {
  const failures = [];
  for (const [name, fn] of Object.entries(tests)) {
    try {
      await fn();
      console.log(`ok   ${name}`);
    } catch (e) {
      failures.push(name);
      console.log(`FAIL ${name}\n     ${e && e.stack ? e.stack.split("\n").slice(0, 3).join("\n     ") : e}`);
    }
  }
  if (failures.length) throw new Error(`${failures.length} integration test(s) failed`);
};
