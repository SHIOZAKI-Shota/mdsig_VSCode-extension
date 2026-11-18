import * as vscode from "vscode";
import { publicHostFetch, verifyDocument, type TofuStore, type VerifyOptions, type VerifyResult } from "@mdsig/core";
import { layout, type Layout } from "./ranges.ts";

export interface Host {
  isWeb: boolean;
  tofuStore: TofuStore;
  keyDirectories(): Promise<string[]>;
  pgpKeyring?: (fpr: string) => Promise<Uint8Array | null>;
  flushTofu?(): Promise<void>;
}

export interface Entry {
  uri: string;
  version: number;
  text: string;
  online: boolean;
  result: VerifyResult;
  layout: Layout;
}

const MD = (d: vscode.TextDocument) => d.languageId === "markdown";

export class VerifyController implements vscode.Disposable {
  private readonly cache = new Map<string, Entry>();
  private readonly running = new Map<string, Promise<Entry | undefined>>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly emitter = new vscode.EventEmitter<Entry>();
  private readonly subs: vscode.Disposable[] = [];
  readonly onDidVerify = this.emitter.event;
  private acceptOnce = new Set<string>();

  private readonly host: Host;

  constructor(host: Host) {
    this.host = host;
    this.subs.push(
      vscode.workspace.onDidOpenTextDocument((d) => MD(d) && void this.verify(d, { online: true })),
      vscode.workspace.onDidSaveTextDocument((d) => MD(d) && void this.verify(d, { online: true })),
      vscode.workspace.onDidChangeTextDocument((e) => MD(e.document) && this.schedule(e.document)),
      vscode.workspace.onDidCloseTextDocument((d) => this.cache.delete(d.uri.toString())),
    );
    for (const d of vscode.workspace.textDocuments) if (MD(d)) void this.verify(d, { online: true });
  }

  get(doc: vscode.TextDocument | vscode.Uri): Entry | undefined {
    const uri = "uri" in doc ? doc.uri : doc;
    return this.cache.get(uri.toString());
  }

  private schedule(doc: vscode.TextDocument) {
    const key = doc.uri.toString();
    clearTimeout(this.timers.get(key));
    this.timers.set(key, setTimeout(() => void this.verify(doc, { online: false }), 800));
  }

  networkAllowed(): boolean {
    const mode = vscode.workspace.getConfiguration("mdsig").get<string>("verify.network", "trusted");
    if (mode === "never") return false;
    if (mode === "always") return true;
    // security: in Restricted Mode, opening a document must not make requests it chose
    return vscode.workspace.isTrusted;
  }

  acceptNewKey(uri: vscode.Uri) {
    this.acceptOnce.add(uri.toString());
  }

  async verify(doc: vscode.TextDocument, o: { online: boolean }): Promise<Entry | undefined> {
    const key = doc.uri.toString();
    const prev = this.running.get(key);
    if (prev) await prev.catch(() => undefined);
    const p = this.run(doc, o.online && this.networkAllowed());
    this.running.set(key, p);
    try {
      return await p;
    } finally {
      if (this.running.get(key) === p) this.running.delete(key);
    }
  }

  private async options(doc: vscode.TextDocument, online: boolean): Promise<VerifyOptions> {
    const cfg = vscode.workspace.getConfiguration("mdsig");
    const accept = this.acceptOnce.delete(doc.uri.toString());
    const extraTsaRoots: Uint8Array[] = [];
    for (const p of cfg.get<string[]>("tsaRoots", [])) {
      try {
        extraTsaRoots.push(await vscode.workspace.fs.readFile(resolvePath(doc.uri, p)));
      } catch {
      }
    }
    const keyserver = cfg.get<string>("keyserver", "");
    return {
      offline: !online,
      fetch: publicHostFetch(globalThis.fetch.bind(globalThis)),
      tofuStore: this.host.tofuStore,
      acceptNewTofuKey: accept,
      pgpKeyring: this.host.pgpKeyring,
      ...({ extraKeyDirectories: await this.host.keyDirectories() } as object),
      ...(keyserver ? { keyserver } : {}),
      checkRevocation: online && cfg.get<boolean>("verify.checkRevocation", true),
      fetchResources: online && cfg.get<boolean>("verify.fetchResources", false),
      loadResource: doc.uri.scheme === "untitled" ? undefined : (ref) => loadLocal(doc.uri, ref),
      ...(extraTsaRoots.length ? { extraTsaRoots } : {}),
    };
  }

  private async run(doc: vscode.TextDocument, online: boolean): Promise<Entry | undefined> {
    const text = doc.getText();
    const version = doc.version;
    let result: VerifyResult;
    try {
      result = await verifyDocument(text, await this.options(doc, online));
    } catch (e) {
      result = { ok: false, signatures: [], agreement: { status: "none", required: [], missing: [], violations: [] }, warnings: [], error: String((e as Error).message ?? e) };
    }
    await this.host.flushTofu?.();
    if (doc.isClosed) return undefined;
    const prev = this.cache.get(doc.uri.toString());
    if (!online && prev?.online && prev.text === text) return prev;
    const entry: Entry = { uri: doc.uri.toString(), version, text, online, result, layout: layout(text) };
    this.cache.set(entry.uri, entry);
    this.emitter.fire(entry);
    return entry;
  }

  dispose() {
    for (const t of this.timers.values()) clearTimeout(t);
    this.subs.forEach((s) => s.dispose());
    this.emitter.dispose();
  }
}

function resolvePath(doc: vscode.Uri, p: string): vscode.Uri {
  if (/^([a-zA-Z]:[\\/]|\/)/.test(p)) return vscode.Uri.file(p);
  return vscode.Uri.joinPath(doc, "..", p);
}

const MAX_RESOURCE = 50 * 1024 * 1024;

// security: the core rejects ".." and absolute refs, so this stays inside the document's folder
async function loadLocal(doc: vscode.Uri, ref: string): Promise<Uint8Array | null> {
  const uri = vscode.Uri.joinPath(doc, "..", ...ref.split("/"));
  try {
    const st = await vscode.workspace.fs.stat(uri);
    if (st.type !== vscode.FileType.File || st.size > MAX_RESOURCE) return null;
    return await vscode.workspace.fs.readFile(uri);
  } catch {
    return null;
  }
}
