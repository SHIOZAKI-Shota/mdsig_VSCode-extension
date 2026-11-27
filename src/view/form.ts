import { REQUIRE_METHODS, emptyDraft, emptyLine, serializeDraft, type Draft, type DraftLine } from "./requireDraft.ts";
import type { InputCheck } from "../sign/input.ts";

declare function acquireVsCodeApi(): { postMessage(m: unknown): void };

const vscode = acquireVsCodeApi();
const post = (m: unknown) => vscode.postMessage(m);
const root = document.getElementById("root")!;
const mode = document.body.dataset.mode as "sign" | "setup";

type S = Record<string, string>;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else e.setAttribute(k, v);
  }
  e.append(...children);
  return e;
}

function field(label: string, control: HTMLElement, hint?: string): HTMLElement {
  const id = `f${Math.random().toString(36).slice(2)}`;
  control.id = id;
  const wrap = el("div", { class: "field" }, el("label", { for: id }, label), control);
  if (hint) wrap.append(el("p", { class: "hint" }, hint));
  return wrap;
}

const METHODS = ["git-hosting", "dns", "directory", "pgp", "tofu"] as const;

interface Init {
  file: string;
  strings: S;
  last: Record<string, string>;
  sections: string[];
  lines: number;
  signatures: number;
  tail: boolean;
  tsaUrl: string;
  openFence: boolean;
}

let init: Init | null = null;
let keys: { id: string; label: string; detail: string; emails: string[] }[] = [];
let method: (typeof METHODS)[number] = "git-hosting";

function signForm(i: Init) {
  const s = i.strings;
  root.replaceChildren();
  const form = el("form", { class: "form" });
  form.append(el("h1", {}, s.title!), el("p", { class: "file" }, i.file));

  const methods = el("fieldset", { class: "methods" }, el("legend", {}, s.who!));
  const methodList = el("div", { class: "method-list" });
  methods.append(methodList);
  for (const m of METHODS) {
    const input = el("input", { type: "radio", name: "method", value: m });
    if (m === method) input.checked = true;
    input.addEventListener("change", () => {
      method = m;
      post({ type: "method", method: m });
      update();
    });
    methodList.append(el("label", { class: "method" }, input, el("span", { class: "m-title" }, s[`m.${m}`]!), el("span", { class: "m-desc" }, s[`m.${m}.d`]!)));
  }
  form.append(methods);

  const signer = el("input", { type: "text", autocomplete: "off", spellcheck: "false" });
  const signerField = field(s.signer!, signer);
  const emailSelect = el("select");
  const keySelect = el("select");
  const keyField = field(s.key!, keySelect);
  const noKey = el("div", { class: "nokey" }, el("p", {}, s.noKey!), el("button", { type: "button", class: "secondary" }, s.createKey!));
  noKey.querySelector("button")!.addEventListener("click", () => post({ type: "setup" }));
  const selector = el("input", { type: "text", autocomplete: "off" });
  const selectorField = field(s.selector!, selector);

  const role = el("select");
  for (const r of ["", "author", "reviewer", "approver", "witness"]) role.append(el("option", { value: r }, s[`r.${r || "none"}`]!));
  const reason = el("textarea", { rows: "2" });
  const displayName = el("input", { type: "text", autocomplete: "off", spellcheck: "false", maxlength: "64" });
  const signerError = el("p", { class: "field-error", role: "alert" });
  const nameError = el("p", { class: "field-error", role: "alert" });

  const more = el("details", { class: "more" }, el("summary", {}, s.more!));
  const ts = el("input", { type: "checkbox" });
  ts.checked = true;
  const tsa = el("input", { type: "url", value: i.tsaUrl });
  const expires = el("input", { type: "date" });
  const scopeBox = el("div", { class: "scope" });
  for (const id of i.sections) scopeBox.append(el("label", { class: "check" }, el("input", { type: "checkbox", value: id }), ` ${id}`));
  const require = el("textarea", { rows: "4", spellcheck: "false", placeholder: "dns:example.com role=approver" });
  const builder = requireBuilder(s, (text) => {
    require.value = text;
    scheduleCheck();
  });
  const requireOut = el("div", { class: "require-out" });
  const embed = el("input", { type: "checkbox" });
  const embedField = el("label", { class: "check" }, embed, ` ${s.embedKey}`);
  more.append(el("label", { class: "check" }, ts, ` ${s.timestamp}`), field(s.tsaUrl!, tsa), field(s.expires!, expires));
  if (i.sections.length) more.append(el("div", { class: "field" }, el("span", { class: "label" }, s.scope!), scopeBox));
  const requireBox = el("div", { class: "field" }, el("span", { class: "label" }, s.require!), el("p", { class: "hint" }, s.requireHint!), builder.root, field(s.requireText!, require), requireOut);
  more.append(requireBox, embedField, selectorField);

  const covers = el("p", { class: "covers" });
  const tail = el("div", { class: "warn" });
  const force = el("input", { type: "checkbox" });
  if (i.tail) tail.append(el("p", {}, s.tail!), el("label", { class: "check" }, force, ` ${s.force}`));
  if (i.openFence) tail.append(el("p", {}, s.openFence!));
  const error = el("p", { class: "error", role: "alert" });
  const submit = el("button", { type: "submit", class: "primary big" }, s.submit!);

  signerField.append(signerError);
  const nameField = field(s.displayName!, displayName, s.displayNameHint);
  nameField.append(nameError);
  form.append(signerField, keyField, noKey, field(s.role!, role), nameField, field(s.reason!, reason), more, covers, tail, error, submit);
  root.append(form);

  function fillKeys() {
    keySelect.replaceChildren();
    for (const k of keys) keySelect.append(el("option", { value: k.id }, `${k.label} (${k.detail})`));
    if (i.last.key && keys.some((k) => k.id === i.last.key)) keySelect.value = i.last.key;
    keyField.hidden = keys.length === 0;
    noKey.hidden = keys.length > 0 || method === "pgp";
    if (method === "pgp") {
      const emails = [...new Set(keys.flatMap((k) => k.emails))];
      emailSelect.replaceChildren(...emails.map((e) => el("option", { value: e }, e)));
      if (emails.length && !signer.value) signer.value = emails[0]!;
    }
  }

  function update() {
    signer.placeholder = s[`p.${method}`]!;
    signer.value = i.last[method] ?? "";
    scheduleCheck();
    selectorField.hidden = method !== "dns";
    embedField.hidden = !(method === "dns" || method === "git-hosting" || method === "directory");
    embed.checked = method === "directory";
    const scoped = [...scopeBox.querySelectorAll<HTMLInputElement>("input:checked")].length > 0;
    covers.textContent = scoped ? s.coversScope! : s.covers!.replace("{0}", String(i.lines)).replace("{1}", String(i.signatures));
    fillKeys();
  }
  scopeBox.addEventListener("change", () => {
    const scoped = [...scopeBox.querySelectorAll<HTMLInputElement>("input:checked")].length > 0;
    covers.textContent = scoped ? s.coversScope! : s.covers!.replace("{0}", String(i.lines)).replace("{1}", String(i.signatures));
  });
  let seq = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let blocked = false;
  function scheduleCheck() {
    clearTimeout(timer);
    timer = setTimeout(() => post({ type: "check", input: { seq: ++seq, method, signer: signer.value, displayName: displayName.value, require: require.value } }), 250);
  }
  signer.addEventListener("input", scheduleCheck);
  displayName.addEventListener("input", scheduleCheck);
  require.addEventListener("input", () => {
    scheduleCheck();
    builder.pendingFromText = true;
  });
  (window as unknown as { applyCheck: (n: number, c: InputCheck) => void }).applyCheck = (n, c) => {
    if (n !== seq) return;
    signerError.textContent = c.signer ?? "";
    nameError.textContent = c.displayName ?? "";
    requireOut.replaceChildren();
    if (c.require?.explanation) requireOut.append(el("pre", { class: "explain" }, c.require.explanation));
    for (const p of c.require?.errors ?? []) requireOut.append(el("p", { class: "field-error" }, p));
    for (const p of c.require?.warnings ?? []) requireOut.append(el("p", { class: "field-warn" }, p));
    if (builder.pendingFromText) {
      builder.pendingFromText = false;
      if (!require.value.trim()) builder.set(emptyDraft());
      else if (c.require?.draft) builder.set(c.require.draft);
      else builder.unusable();
    }
    blocked = !!(c.signer || c.displayName || c.require?.blocking);
  };
  (window as unknown as { fillKeys: () => void }).fillKeys = fillKeys;
  update();

  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    error.textContent = "";
    if (!signer.value.trim()) return void (error.textContent = s.needSigner!);
    if (!keySelect.value) return void (error.textContent = s.needKey!);
    if (blocked || i.openFence) return void (error.textContent = signerError.textContent || nameError.textContent || requireOut.querySelector(".field-error")?.textContent || s.openFence!);
    submit.disabled = true;
    submit.textContent = s.signing!;
    post({
      type: "sign",
      request: {
        method,
        signer: signer.value,
        selector: selector.value || undefined,
        key: keySelect.value,
        role: role.value || undefined,
        displayName: displayName.value || undefined,
        reason: reason.value || undefined,
        timestamp: ts.checked,
        tsaUrl: tsa.value,
        expires: expires.value ? `${expires.value}T23:59:59Z` : undefined,
        scope: [...scopeBox.querySelectorAll<HTMLInputElement>("input:checked")].map((x) => x.value),
        require: require.value,
        embedKey: embed.checked,
        force: force.checked,
      },
    });
  });
  (window as unknown as { resetSubmit: () => void }).resetSubmit = () => {
    submit.disabled = false;
    submit.textContent = s.submit!;
  };
  (window as unknown as { showError: (m: string) => void }).showError = (m: string) => (error.textContent = m);
}

function requireBuilder(s: S, onChange: (text: string) => void) {
  let draft: Draft = emptyDraft();
  const root = el("div", { class: "builder" });
  const api = {
    root,
    pendingFromText: false,
    set(d: Draft) {
      draft = d.steps.length ? d : emptyDraft();
      render();
    },
    unusable() {
      root.replaceChildren(el("p", { class: "hint" }, s.cannotBuild!));
    },
  };
  const emit = () => onChange(serializeDraft(draft));
  const select = (values: readonly string[], value: string, label: (v: string) => string, set: (v: string) => void) => {
    const sel = el("select");
    for (const v of values) sel.append(el("option", { value: v }, label(v)));
    sel.value = value;
    sel.addEventListener("change", () => {
      set(sel.value);
      emit();
      render();
    });
    return sel;
  };
  const input = (value: string, placeholder: string, set: (v: string) => void) => {
    const x = el("input", { type: "text", autocomplete: "off", spellcheck: "false", placeholder, "aria-label": placeholder });
    x.value = value;
    x.addEventListener("input", () => {
      set(x.value);
      emit();
    });
    return x;
  };
  const lineRow = (l: DraftLine, lines: DraftLine[]) => {
    const uv = el("input", { type: "checkbox" });
    uv.checked = l.userVerified;
    uv.addEventListener("change", () => {
      l.userVerified = uv.checked;
      emit();
    });
    const del = el("button", { type: "button", class: "link" }, s.remove!);
    del.addEventListener("click", () => {
      lines.splice(lines.indexOf(l), 1);
      if (!lines.length) lines.push(emptyLine());
      emit();
      render();
    });
    const row = el("div", { class: "b-line" },
      select(REQUIRE_METHODS, l.method, (v) => s[`m.${v}`] ?? v, (v) => (l.method = v)),
      input(l.signer, s.lineSigner!, (v) => (l.signer = v)),
      input(l.role, s.lineRole!, (v) => (l.role = v)),
      input(l.memberOf, s.lineMember!, (v) => (l.memberOf = v)),
    );
    if (l.method === "tofu") row.append(input(l.pubkey, s.linePubkey!, (v) => (l.pubkey = v)));
    row.append(el("label", { class: "check" }, uv, ` ${s.lineUv}`), del);
    return row;
  };
  function render() {
    root.replaceChildren();
    root.append(field(s.order!, select(["pending", "guide", "strict"], draft.order, (v) => s[`o.${v}`]!, (v) => (draft.order = v as Draft["order"]))));
    draft.steps.forEach((st, k) => {
      const box = el("fieldset", { class: "b-step" }, el("legend", {}, s.step!.replace("{0}", String(k + 1))));
      box.append(field(s.any!, input(st.any, "", (v) => (st.any = v.replace(/[^0-9]/g, "")))));
      for (const l of st.lines) box.append(lineRow(l, st.lines));
      const add = el("button", { type: "button", class: "secondary" }, s.addLine!);
      add.addEventListener("click", () => {
        st.lines.push(emptyLine());
        render();
      });
      const del = el("button", { type: "button", class: "link" }, s.remove!);
      del.addEventListener("click", () => {
        draft.steps.splice(k, 1);
        if (!draft.steps.length) draft = emptyDraft();
        emit();
        render();
      });
      box.append(el("div", { class: "row" }, add, del));
      root.append(box);
    });
    const addStep = el("button", { type: "button", class: "secondary" }, s.addStep!);
    addStep.addEventListener("click", () => {
      draft.steps.push({ any: "", lines: [emptyLine()] });
      render();
    });
    root.append(addStep);
  }
  render();
  return api;
}

function setupForm(s: S, name: string) {
  root.replaceChildren();
  const box = el("div", { class: "form" });
  const nameInput = el("input", { type: "text", value: name });
  const create = el("button", { type: "button", class: "primary big" }, s.create!);
  const error = el("p", { class: "error", role: "alert" });
  box.append(el("h1", {}, s.title!), el("p", {}, s.intro!), field(s.name!, nameInput), create, error);
  root.append(box);
  create.addEventListener("click", () => {
    create.disabled = true;
    post({ type: "create", name: nameInput.value });
  });
  (window as unknown as { showError: (m: string) => void }).showError = (m: string) => {
    error.textContent = m;
    create.disabled = false;
  };
}

function published(s: S, info: { ssh: string; fingerprint: string; txt: string }) {
  root.replaceChildren();
  const box = el("div", { class: "form" });
  const status = el("p", { class: "status", role: "status" });
  const tabGh = el("section");
  const user = el("input", { type: "text", autocomplete: "off", spellcheck: "false" });
  const copy = el("button", { type: "button", class: "secondary" }, s.copy!);
  const openGh = el("button", { type: "button", class: "secondary" }, s.openGithub!);
  const checkGh = el("button", { type: "button", class: "primary" }, s.check!);
  copy.addEventListener("click", () => post({ type: "copy" }));
  openGh.addEventListener("click", () => post({ type: "openGithub" }));
  checkGh.addEventListener("click", () => post({ type: "checkGithub", user: user.value }));
  tabGh.append(el("h2", {}, s.github!), el("p", {}, s.githubSteps!), el("pre", { class: "key" }, info.ssh), el("div", { class: "row" }, copy, openGh), field(s.user!, user), checkGh);

  const tabDns = el("section");
  const domain = el("input", { type: "text", autocomplete: "off", spellcheck: "false", placeholder: "example.com" });
  const copyTxt = el("button", { type: "button", class: "secondary" }, s.copyTxt!);
  const checkDns = el("button", { type: "button", class: "primary" }, s.check!);
  copyTxt.addEventListener("click", () => post({ type: "copyTxt" }));
  checkDns.addEventListener("click", () => post({ type: "checkDns", domain: domain.value }));
  tabDns.append(el("h2", {}, s.dns!), el("p", {}, s.dnsSteps!), el("pre", { class: "key" }, `_mdsig.<domain>  TXT  "${info.txt}"`), el("div", { class: "row" }, copyTxt), field(s.domain!, domain), checkDns);

  const tabDir = el("section");
  const registerDir = el("button", { type: "button", class: "primary" }, s.registerDirectory!);
  registerDir.addEventListener("click", () => post({ type: "registerDirectory" }));
  tabDir.append(el("h2", {}, s.directory!), el("p", {}, s.directorySteps!), registerDir);

  const exp = el("button", { type: "button", class: "link" }, s.export!);
  exp.addEventListener("click", () => post({ type: "export" }));
  const done = el("button", { type: "button", class: "primary big" }, s.done!);
  done.addEventListener("click", () => post({ type: "sign" }));
  box.append(el("h1", {}, `✓ ${s.created}`), el("p", { class: "file" }, info.fingerprint), el("h2", {}, s.publish!), el("p", {}, s.publishIntro!), el("div", { class: "publish" }, tabGh, tabDns, tabDir), status, el("p", {}, exp), done);
  root.append(box);
  (window as unknown as { setStatus: (m: string, ok: boolean) => void }).setStatus = (m, ok) => {
    status.textContent = m;
    status.className = `status ${ok ? "ok" : "warn"}`;
  };
}

let strings: S = {};
window.addEventListener("message", (ev) => {
  const m = ev.data as Record<string, any>;
  const w = window as unknown as Record<string, (...a: any[]) => void>;
  if (m.type === "init" && mode === "sign") {
    init = m as Init;
    signForm(init);
  }
  if (m.type === "init" && mode === "setup") {
    strings = m.strings;
    setupForm(strings, m.name);
  }
  if (m.type === "keys") {
    keys = m.keys;
    w.fillKeys?.();
  }
  if (m.type === "checked-input") w.applyCheck?.(m.seq, m.result);
  if (m.type === "error") {
    w.showError?.(m.message);
    w.resetSubmit?.();
  }
  if (m.type === "created") published(strings, m as any);
  if (m.type === "copied") w.setStatus?.(strings.copied!, true);
  if (m.type === "checked") w.setStatus?.(m.ok ? strings.ok! : strings.notYet!, m.ok);
  if (m.type === "exported") w.setStatus?.(strings.exported!.replace("{0}", m.path), true);
});

post({ type: "ready" });
