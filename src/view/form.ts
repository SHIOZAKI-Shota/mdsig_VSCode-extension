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

  const more = el("details", { class: "more" }, el("summary", {}, s.more!));
  const ts = el("input", { type: "checkbox" });
  ts.checked = true;
  const tsa = el("input", { type: "url", value: i.tsaUrl });
  const expires = el("input", { type: "date" });
  const scopeBox = el("div", { class: "scope" });
  for (const id of i.sections) scopeBox.append(el("label", { class: "check" }, el("input", { type: "checkbox", value: id }), ` ${id}`));
  const require = el("textarea", { rows: "3", spellcheck: "false", placeholder: "dns:example.com approver" });
  const embed = el("input", { type: "checkbox" });
  const embedField = el("label", { class: "check" }, embed, ` ${s.embedKey}`);
  more.append(el("label", { class: "check" }, ts, ` ${s.timestamp}`), field(s.tsaUrl!, tsa), field(s.expires!, expires));
  if (i.sections.length) more.append(el("div", { class: "field" }, el("span", { class: "label" }, s.scope!), scopeBox));
  more.append(field(s.require!, require), embedField, selectorField);

  const covers = el("p", { class: "covers" });
  const tail = el("div", { class: "warn" });
  const force = el("input", { type: "checkbox" });
  if (i.tail) tail.append(el("p", {}, s.tail!), el("label", { class: "check" }, force, ` ${s.force}`));
  const error = el("p", { class: "error", role: "alert" });
  const submit = el("button", { type: "submit", class: "primary big" }, s.submit!);

  form.append(signerField, keyField, noKey, field(s.role!, role), field(s.reason!, reason), more, covers, tail, error, submit);
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
  (window as unknown as { fillKeys: () => void }).fillKeys = fillKeys;
  update();

  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    error.textContent = "";
    if (!signer.value.trim()) return void (error.textContent = s.needSigner!);
    if (!keySelect.value) return void (error.textContent = s.needKey!);
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
