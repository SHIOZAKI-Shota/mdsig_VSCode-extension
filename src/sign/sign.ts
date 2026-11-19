import * as vscode from "vscode";
import * as os from "node:os";
import {
  DEFAULT_KEY_DIRECTORIES,
  DEFAULT_RESOLVERS,
  DEFAULT_TSA_URL,
  directoriesFromRecords,
  dohTxt,
  findSections,
  formatSshPublicKey,
  parseDocument,
  publicHostFetch,
  registerWithDirectory,
  signDocument,
  sshFingerprint,
  timestampDocument,
  toBase64,
  type Method,
  type PgpSigner,
  type Signer,
} from "@mdsig/core";
import { webviewHtml } from "../view/panels.ts";
import type { VerifyController } from "../verify/controller.ts";
import { KeyStore, listKeyChoices, signerFor, type KeyChoice } from "../keys/store.ts";

const t = vscode.l10n.t;
const LAST = "mdsig.lastSigner";

interface SignRequest {
  method: Method;
  signer: string;
  selector?: string;
  key: string;
  role?: string;
  reason?: string;
  timestamp: boolean;
  tsaUrl?: string;
  expires?: string;
  scope: string[];
  require?: string;
  embedKey: boolean;
  force: boolean;
}

const netFetch = () => publicHostFetch(globalThis.fetch.bind(globalThis));
const signerId = (r: SignRequest) => (r.method === "directory" ? r.signer.trim().toLowerCase() : r.signer.trim());
const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

const fileName = (uri: vscode.Uri) => uri.path.split("/").pop() ?? uri.toString();

function targetDoc(uri?: vscode.Uri): vscode.TextDocument | undefined {
  if (uri instanceof vscode.Uri) return vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
  const a = vscode.window.activeTextEditor?.document;
  if (a?.languageId === "markdown") return a;
  return vscode.window.visibleTextEditors.find((e) => e.document.languageId === "markdown")?.document;
}

function formStrings(): Record<string, string> {
  return {
    title: t("Sign this document"),
    who: t("Sign as"),
    "m.git-hosting": t("GitHub or GitLab account"),
    "m.git-hosting.d": t("Readers check your signature with the SSH keys published on your account."),
    "m.dns": t("Company or personal domain"),
    "m.dns.d": t("Readers check your signature with a key published in your domain's DNS."),
    "m.directory": t("Email address"),
    "m.directory.d": t("Readers check your signature with the key that a key directory confirmed for your email address."),
    "m.pgp": t("OpenPGP key"),
    "m.pgp.d": t("Uses your OpenPGP key from gpg. Readers find it by email address."),
    "m.tofu": t("This key only"),
    "m.tofu.d": t("Proves that the document has not changed since you signed, but not who you are."),
    "p.git-hosting": "github.com/your-name",
    "p.dns": "example.com",
    "p.directory": "you@example.com",
    "p.pgp": "you@example.com",
    "p.tofu": t("your name"),
    signer: t("Account, domain, or name"),
    key: t("Key"),
    noKey: t("No key found. Create one first."),
    createKey: t("Create a key"),
    role: t("Role"),
    "r.author": t("Author"),
    "r.reviewer": t("Reviewer"),
    "r.approver": t("Approver"),
    "r.witness": t("Witness"),
    "r.none": t("(not specified)"),
    reason: t("Comment (optional)"),
    more: t("More options"),
    timestamp: t("Add a timestamp from a time-stamping authority (recommended)"),
    tsaUrl: t("Time-stamping authority URL"),
    expires: t("Valid until (optional)"),
    scope: t("Sign only these sections"),
    require: t("Signatures still needed after yours (one per line, e.g. dns:example.com approver)"),
    embedKey: t("Include the public key in the signature, so it can still be checked if the key is removed"),
    selector: t("DNS selector (optional)"),
    covers: t("Your signature will cover the whole document as it is now: {0} lines of text and {1} earlier signature(s)."),
    coversScope: t("Your signature will cover only the selected sections."),
    tail: t("There is text after the last signature that nobody signed. Signing now would approve it on behalf of the earlier signers."),
    force: t("Sign the whole file as a new document (the earlier signatures stay, but no longer cover the end)"),
    submit: t("Sign"),
    signing: t("Signing…"),
    needSigner: t("Enter who you are signing as."),
    needKey: t("Choose a key."),
  };
}

export function registerSigning(context: vscode.ExtensionContext, ctl: VerifyController, store: KeyStore, openSetup: () => void): vscode.Disposable {
  let panel: vscode.WebviewPanel | undefined;
  let docUri: vscode.Uri | undefined;
  let choices: KeyChoice[] = [];

  const pushInit = async () => {
    if (!panel || !docUri) return;
    const doc = targetDoc(docUri);
    if (!doc) return;
    const text = doc.getText();
    const parsed = parseDocument(text);
    const sections = [...findSections(text).sections.keys()];
    const e = ctl.get(doc);
    const lines = (parsed.body.match(/\n/g)?.length ?? 0) + 1;
    void panel.webview.postMessage({
      type: "init",
      file: fileName(doc.uri),
      strings: formStrings(),
      last: context.globalState.get<Record<string, string>>(LAST, {}),
      sections,
      lines,
      signatures: parsed.chain.length,
      tail: !!e?.layout.tail || (parsed.chain.length === 0 && parsed.strayMarker),
      tsaUrl: vscode.workspace.getConfiguration("mdsig").get<string>("tsaUrl", "http://ts.ssl.com"),
    });
    await pushKeys("git-hosting");
  };

  const pushKeys = async (method: string) => {
    choices = await listKeyChoices(store, { pgp: method === "pgp" });
    void panel?.webview.postMessage({ type: "keys", method, keys: choices.map((c) => ({ id: c.id, label: c.label, detail: c.detail, emails: c.emails ?? [] })) });
  };

  const askPassphrase = async (prompt: string) => vscode.window.showInputBox({ prompt, password: true, ignoreFocusOut: true });

  const sign = async (r: SignRequest) => {
    const doc = docUri && targetDoc(docUri);
    if (!doc) throw new Error(t("The document is no longer open."));
    const choice = choices.find((c) => c.id === r.key);
    if (!choice) throw new Error(t("Choose a key."));
    const signer: Signer | PgpSigner = await signerFor(choice, store, askPassphrase);
    if (r.method === "git-hosting" && signer.alg === "ed25519") await warnIfUnpublished(r, signer);
    if (r.method === "directory" && signer.alg === "ed25519" && !(await warnIfNotInDirectory(r, signer))) return;
    const text = doc.getText();
    const res = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: t("Signing…") }, () =>
      signDocument(text, {
        signer,
        method: r.method,
        signerId: signerId(r),
        ...(r.selector ? { selector: r.selector.trim() } : {}),
        ...(r.role ? { role: r.role } : {}),
        ...(r.reason ? { reason: r.reason.trim() } : {}),
        ...(r.expires ? { expires: r.expires } : {}),
        ...(r.scope.length ? { scope: r.scope } : {}),
        ...(r.require?.trim() ? { require: r.require.split(/\r?\n/).map((l) => l.trim()).filter(Boolean) } : {}),
        ...(r.timestamp ? { tsaUrl: r.tsaUrl || DEFAULT_TSA_URL } : {}),
        ...(r.method === "dns" || r.method === "git-hosting" || r.method === "directory" ? { embedKey: r.embedKey } : {}),
        fetch: globalThis.fetch.bind(globalThis),
        force: r.force,
      }),
    );
    if ("dispose" in signer) signer.dispose();
    if (doc.getText() !== text) throw new Error(t("The document changed while signing. Try again."));
    const edit = new vscode.WorkspaceEdit();
    edit.replace(doc.uri, new vscode.Range(doc.positionAt(0), doc.positionAt(text.length)), res.text);
    if (!(await vscode.workspace.applyEdit(edit))) throw new Error(t("Could not update the document."));
    await context.globalState.update(LAST, { ...context.globalState.get<Record<string, string>>(LAST, {}), [r.method]: signerId(r), key: r.key });
    panel?.dispose();
    await ctl.verify(doc, { online: true });
    const save = t("Save");
    const pick = await vscode.window.showInformationMessage(t("Signed as {0}. Save the file to keep the signature.", signerId(r)), save);
    if (pick === save) await doc.save();
    void vscode.commands.executeCommand("mdsig.openView", doc.uri);
  };

  const warnIfUnpublished = async (r: SignRequest, signer: Signer) => {
    try {
      const fp = await sshFingerprint(signer.publicKey);
      const found = await DEFAULT_RESOLVERS["git-hosting"]!({ signer: r.signer.trim(), method: "git-hosting", alg: "ed25519", key_fp: fp }, { fetch: netFetch() });
      if (found.keys.length) return;
    } catch {
    }
    const go = t("Sign anyway");
    const pick = await vscode.window.showWarningMessage(t("This key is not published on {0} yet, so readers cannot check the signature until you add it to the account.", r.signer.trim()), { modal: true }, go);
    if (pick !== go) throw new Error(t("Cancelled"));
  };

  const warnIfNotInDirectory = async (r: SignRequest, signer: Signer): Promise<boolean> => {
    const email = signerId(r);
    try {
      const found = await DEFAULT_RESOLVERS.directory!({ signer: email, method: "directory", alg: "ed25519" }, { fetch: netFetch(), extraKeyDirectories: await ctl.keyDirectories() });
      if (found.keys.some((k) => sameBytes(k.key, signer.publicKey))) return true;
    } catch {
    }
    const go = t("Sign anyway");
    const register = t("Register the key");
    const pick = await vscode.window.showWarningMessage(t("This key is not published for {0} in a key directory yet. Readers cannot check the signature until the key is registered and you confirm the address from the email the directory sends.", email), { modal: true }, go, register);
    if (pick === go) return true;
    if (pick === register) {
      panel?.dispose();
      void vscode.commands.executeCommand("mdsig.registerKeyDirectory", r.key, email);
      return false;
    }
    throw new Error(t("Cancelled"));
  };

  const open = (uri?: vscode.Uri) => {
    const doc = targetDoc(uri);
    if (!doc) return void vscode.window.showInformationMessage(t("Open a Markdown file to sign it."));
    docUri = doc.uri;
    if (panel) {
      panel.reveal();
      void pushInit();
      return;
    }
    panel = vscode.window.createWebviewPanel("mdsig.sign", t("Sign: {0}", fileName(doc.uri)), vscode.ViewColumn.Beside, {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "media"), vscode.Uri.joinPath(context.extensionUri, "dist")],
    });
    panel.iconPath = vscode.Uri.joinPath(context.extensionUri, "media", "icon.png");
    panel.webview.html = webviewHtml(panel.webview, context.extensionUri, "sign", "form.js", false);
    panel.onDidDispose(() => (panel = undefined));
    panel.webview.onDidReceiveMessage(async (m: { type: string; method?: string; request?: SignRequest }) => {
      if (m.type === "ready") await pushInit();
      if (m.type === "method" && m.method) await pushKeys(m.method);
      if (m.type === "setup") openSetup();
      if (m.type === "sign" && m.request) {
        try {
          await sign(m.request);
        } catch (e) {
          void panel?.webview.postMessage({ type: "error", message: (e as Error).message });
        }
      }
    });
  };

  return vscode.Disposable.from(
    vscode.commands.registerCommand("mdsig.sign", (uri?: vscode.Uri) => open(uri)),
    vscode.commands.registerCommand("mdsig.timestamp", async (uri?: vscode.Uri) => {
      const doc = targetDoc(uri);
      if (!doc) return;
      const tsaUrl = vscode.workspace.getConfiguration("mdsig").get<string>("tsaUrl", "http://ts.ssl.com");
      const go = t("Add timestamp");
      const pick = await vscode.window.showInformationMessage(t("Add a timestamp from {0}? It records that the document and its signatures existed at this time.", tsaUrl), { modal: true }, go);
      if (pick !== go) return;
      try {
        const text = doc.getText();
        const res = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: t("Requesting a timestamp…") }, () => timestampDocument(text, { tsaUrl, fetch: globalThis.fetch.bind(globalThis) }));
        const edit = new vscode.WorkspaceEdit();
        edit.replace(doc.uri, new vscode.Range(doc.positionAt(0), doc.positionAt(text.length)), res.text);
        await vscode.workspace.applyEdit(edit);
        await ctl.verify(doc, { online: true });
      } catch (e) {
        void vscode.window.showErrorMessage((e as Error).message);
      }
    }),
    { dispose: () => panel?.dispose() },
  );
}

function setupStrings(): Record<string, string> {
  return {
    title: t("Set up a signing key"),
    intro: t("A signing key is made on this computer and kept in the system keychain. Only its public part is shared."),
    name: t("Key name"),
    create: t("Create the key"),
    created: t("Key created"),
    publish: t("Publish the public key"),
    publishIntro: t("Readers find your public key where you publish it. Choose one:"),
    github: t("GitHub"),
    githubSteps: t("1. Copy the public key. 2. Open GitHub's key page. 3. Paste it, choose \"Authentication Key\" as the key type, and save. 4. Enter your user name below and check."),
    copy: t("Copy the public key"),
    copyTxt: t("Copy the record value"),
    copied: t("Copied"),
    openGithub: t("Open GitHub's key page"),
    user: t("GitHub user name"),
    check: t("Check"),
    dns: t("Your domain"),
    dnsSteps: t("Add this TXT record in your DNS settings, then enter the domain and check."),
    domain: t("Domain"),
    ok: t("Published. You can sign now."),
    notYet: t("Not found yet. Publishing can take a minute; try again."),
    export: t("Also save it to ~/.ssh for the mdsig command line"),
    exported: t("Saved to {0}"),
    directory: t("Email address"),
    directorySteps: t("Register the public key with a key directory. The directory sends a confirmation email, and the key is published after you open the link in it."),
    registerDirectory: t("Register with a key directory"),
    done: t("Sign a document"),
  };
}

export function registerKeySetup(context: vscode.ExtensionContext, store: KeyStore): { open: () => void; disposable: vscode.Disposable } {
  let panel: vscode.WebviewPanel | undefined;
  let current: { id: string; publicKey: Uint8Array } | undefined;

  const open = () => {
    if (panel) return panel.reveal();
    panel = vscode.window.createWebviewPanel("mdsig.setup", t("Set up a signing key"), vscode.ViewColumn.Active, {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "media"), vscode.Uri.joinPath(context.extensionUri, "dist")],
    });
    panel.iconPath = vscode.Uri.joinPath(context.extensionUri, "media", "icon.png");
    panel.webview.html = webviewHtml(panel.webview, context.extensionUri, "setup", "form.js", false);
    panel.onDidDispose(() => (panel = undefined));
    panel.webview.onDidReceiveMessage(async (m: { type: string; name?: string; user?: string; domain?: string }) => {
      const post = (x: unknown) => void panel?.webview.postMessage(x);
      try {
        if (m.type === "ready") post({ type: "init", strings: setupStrings(), name: os.hostname().replace(/\.local$/, "") });
        if (m.type === "create") {
          const meta = await store.create(m.name?.trim() || os.hostname());
          const pub = Uint8Array.from(atob(meta.publicKey), (c) => c.charCodeAt(0));
          current = { id: meta.id, publicKey: pub };
          post({ type: "created", ssh: formatSshPublicKey(pub, meta.label), fingerprint: await sshFingerprint(pub), txt: `v=mdsig1; k=ed25519; p=${toBase64(pub)}` });
        }
        if (m.type === "copy" && current) {
          await vscode.env.clipboard.writeText(formatSshPublicKey(current.publicKey, ""));
          post({ type: "copied" });
        }
        if (m.type === "copyTxt" && current) {
          await vscode.env.clipboard.writeText(`v=mdsig1; k=ed25519; p=${toBase64(current.publicKey)}`);
          post({ type: "copied" });
        }
        if (m.type === "openGithub") await vscode.env.openExternal(vscode.Uri.parse("https://github.com/settings/ssh/new"));
        if (m.type === "checkGithub" && current && m.user) {
          const signer = `github.com/${m.user.trim().replace(/^@/, "")}`;
          const fp = await sshFingerprint(current.publicKey);
          let ok = false;
          try {
            ok = (await DEFAULT_RESOLVERS["git-hosting"]!({ signer, method: "git-hosting", alg: "ed25519", key_fp: fp }, { fetch: globalThis.fetch.bind(globalThis) })).keys.length > 0;
          } catch {
          }
          if (ok) await context.globalState.update(LAST, { ...context.globalState.get<Record<string, string>>(LAST, {}), "git-hosting": signer, key: `stored:${current.id}` });
          post({ type: "checked", ok });
        }
        if (m.type === "checkDns" && current && m.domain) {
          const domain = m.domain.trim().toLowerCase().replace(/\.$/, "");
          const p = toBase64(current.publicKey);
          const ok = (await dohTxt(`_mdsig.${domain}`).catch(() => [] as string[])).some((r) => r.replace(/\s+/g, "").includes(`p=${p}`));
          if (ok) await context.globalState.update(LAST, { ...context.globalState.get<Record<string, string>>(LAST, {}), dns: domain, key: `stored:${current.id}` });
          post({ type: "checked", ok });
        }
        if (m.type === "registerDirectory" && current) void vscode.commands.executeCommand("mdsig.registerKeyDirectory", `stored:${current.id}`);
        if (m.type === "export" && current) post({ type: "exported", path: await store.exportOpenSsh(current.id) });
        if (m.type === "sign") {
          panel?.dispose();
          void vscode.commands.executeCommand("mdsig.sign");
        }
      } catch (e) {
        post({ type: "error", message: (e as Error).message });
      }
    });
  };
  return { open, disposable: vscode.Disposable.from(vscode.commands.registerCommand("mdsig.setupKey", open), { dispose: () => panel?.dispose() }) };
}

export function registerManageKeys(store: KeyStore): vscode.Disposable {
  return vscode.commands.registerCommand("mdsig.manageKeys", async () => {
    const items = await Promise.all(store.list().map(async (m) => ({ label: m.label, description: await sshFingerprint(Uint8Array.from(atob(m.publicKey), (c) => c.charCodeAt(0))), detail: t("Created {0}", m.created.slice(0, 10)), meta: m })));
    if (!items.length) {
      const create = t("Create a key");
      if ((await vscode.window.showInformationMessage(t("No keys are saved in the extension yet."), create)) === create) void vscode.commands.executeCommand("mdsig.setupKey");
      return;
    }
    const pick = await vscode.window.showQuickPick(items, { title: t("Keys saved in the system keychain") });
    if (!pick) return;
    const copy = t("Copy the public key");
    const exp = t("Save to ~/.ssh");
    const del = t("Delete");
    const action = await vscode.window.showQuickPick([copy, exp, del], { title: pick.label });
    const pub = Uint8Array.from(atob(pick.meta.publicKey), (c) => c.charCodeAt(0));
    if (action === copy) await vscode.env.clipboard.writeText(formatSshPublicKey(pub, pick.meta.label));
    if (action === exp) void vscode.window.showInformationMessage(t("Saved to {0}", await store.exportOpenSsh(pick.meta.id)));
    if (action === del) {
      const yes = t("Delete");
      const sure = await vscode.window.showWarningMessage(t("Delete the key \"{0}\"? Documents you signed stay valid only while the public key stays published.", pick.meta.label), { modal: true }, yes);
      if (sure === yes) await store.remove(pick.meta.id);
    }
  });
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

async function pickDirectory(email: string, trusted: string[]): Promise<string> {
  const domain = email.slice(email.lastIndexOf("@") + 1);
  let records: string[];
  try {
    records = await dohTxt(`_mdsig.${domain}`, { fetch: netFetch() });
  } catch (e) {
    throw new Error(t("Could not look up the DNS records of {0}: {1}", domain, (e as Error).message));
  }
  const named = directoriesFromRecords(records);
  if (named.length > 1) throw new Error(t("_mdsig.{0} names {1} different key directories, so readers cannot find the key. Keep one dir= value.", domain, named.length));
  return named[0] ?? [...new Set([...DEFAULT_KEY_DIRECTORIES, ...trusted].map((d) => d.replace(/\/+$/, "")))][0]!;
}

export function registerKeyDirectory(ctl: VerifyController, store: KeyStore): vscode.Disposable {
  return vscode.commands.registerCommand("mdsig.registerKeyDirectory", async (keyId?: string, presetEmail?: string) => {
    const choices = await listKeyChoices(store, { pgp: false });
    if (!choices.length) {
      const create = t("Create a key");
      if ((await vscode.window.showInformationMessage(t("No key found. Create one first."), create)) === create) void vscode.commands.executeCommand("mdsig.setupKey");
      return;
    }
    let choice = typeof keyId === "string" ? choices.find((c) => c.id === keyId) : undefined;
    if (!choice) {
      const pick = await vscode.window.showQuickPick(choices.map((c) => ({ label: c.label, description: c.detail, choice: c })), { title: t("Key to register") });
      if (!pick) return;
      choice = pick.choice;
    }
    const input = await vscode.window.showInputBox({
      title: t("Register with a key directory"),
      prompt: t("Email address to sign as"),
      placeHolder: "you@example.com",
      value: typeof presetEmail === "string" ? presetEmail : "",
      ignoreFocusOut: true,
      validateInput: (v) => (EMAIL_RE.test(v.trim()) ? undefined : t("Enter an email address.")),
    });
    if (input === undefined) return;
    const email = input.trim().toLowerCase();
    let dir: string | undefined;
    try {
      dir = await pickDirectory(email, await ctl.keyDirectories());
      const fp = choice.fingerprint ?? choice.label;
      const go = t("Register");
      const ok = await vscode.window.showInformationMessage(t("Register the key {0} for {1} with {2}? The directory sends a confirmation email to this address.", fp, email, dir), { modal: true }, go);
      if (ok !== go) return;
      const signer = await signerFor(choice, store, async (prompt) => vscode.window.showInputBox({ prompt, password: true, ignoreFocusOut: true }));
      if (signer.alg !== "ed25519") throw new Error(t("Only Ed25519 keys can be registered."));
      try {
        const target = dir;
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: t("Sending the registration…") }, () => registerWithDirectory(target, email, signer, { label: os.hostname().replace(/\.local$/, ""), fetch: netFetch() }));
      } finally {
        if ("dispose" in signer) (signer as { dispose(): void }).dispose();
      }
      await vscode.window.showInformationMessage(t("Registration sent. Open the link in the email sent to {0}; the key is published on {1} after that.", email, dir));
    } catch (e) {
      const msg = e instanceof TypeError ? t("The server could not be reached. Check the network connection, or try again later.") : (e as Error).message || String(e);
      void vscode.window.showErrorMessage(dir ? t("Could not register the key with {0}: {1}", dir, msg) : msg);
    }
  });
}
