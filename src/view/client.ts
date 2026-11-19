import type { Bracket, Row, ViewModel } from "./model.ts";

declare function acquireVsCodeApi(): { postMessage(m: unknown): void; getState(): unknown; setState(s: unknown): void };

const vscode = acquireVsCodeApi();
const root = document.getElementById("root")!;
const mode = document.body.dataset.mode as "view" | "panel";
const LH = mode === "panel" ? 6 : 20;
const hue = (index: number, tone: string) => (tone === "ok" && index > 0 ? `t-ok c-${((index - 1) % 4) + 1}` : `t-${tone}`);

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function button(label: string, cls: string, onClick: () => void): HTMLButtonElement {
  const b = el("button", cls, label);
  b.type = "button";
  b.addEventListener("click", onClick);
  return b;
}

const post = (m: unknown) => vscode.postMessage(m);

function spans(rows: Row[]): [number, number][] {
  const out: [number, number][] = [];
  let prev = 0;
  for (const r of rows) {
    if (r.line !== null) {
      out.push([r.line, r.line]);
      prev = r.line;
    } else {
      out.push([prev + 1, prev + (r.hidden ?? 0)]);
      prev += r.hidden ?? 0;
    }
  }
  return out;
}

function rowRange(sp: [number, number][], b: Bracket): [number, number] | null {
  let from = -1;
  let to = -1;
  sp.forEach(([lo, hi], i) => {
    if (from < 0 && hi >= b.from) from = i;
    if (lo <= b.to) to = i;
  });
  return from >= 0 && to >= from ? [from, to] : null;
}

function figure(m: ViewModel): HTMLElement {
  const fig = el("div", "fig");
  const body = el("div", "body");
  const list = el("ol", "lines");
  for (const r of m.rows) {
    const li = el("li", `k-${r.kind}`);
    if (r.kind === "gap") {
      li.textContent = `⋯ ${m.strings.lines!.replace("{0}", String(r.hidden))}`;
    } else {
      li.dataset.ln = String(r.line);
      if (mode === "view") li.textContent = r.text || " ";
      if (r.block) li.className += ` blk ${r.block < 0 ? "t-bad" : hue(r.block, m.cards.find((c) => c.index === r.block)?.tone ?? "muted")}`;
      li.addEventListener("click", () => post({ type: "jump", line: r.line }));
    }
    list.append(li);
  }
  const marks = el("div", "marks");
  const sp = spans(m.rows);
  const order = [...m.brackets].sort((a, b) => (a.index || 1e9) - (b.index || 1e9));
  const step = mode === "panel" ? 8 : 22;
  const labelX = 12 + (order.length - 1) * step + 14;
  let lastLabelRow = -10;
  const labelled = new Set<number>();
  order.forEach((b, k) => {
    const rr = rowRange(sp, b);
    if (!rr) return;
    const br = el("span", `br ${hue(b.index, b.tone)}${b.dashed ? " dashed" : ""}`);
    br.style.top = `${rr[0] * LH}px`;
    br.style.height = `${(rr[1] - rr[0] + 1) * LH}px`;
    br.style.width = `${12 + k * step}px`;
    br.title = b.label;
    marks.append(br);
    if (mode === "view" && !(b.index && labelled.has(b.index))) {
      labelled.add(b.index);
      let row = Math.round((rr[0] + rr[1]) / 2);
      if (row - lastLabelRow < 2) row = lastLabelRow + 2;
      lastLabelRow = row;
      const lab = el("span", `lab ${hue(b.index, b.tone)}`);
      lab.style.top = `${row * LH}px`;
      lab.style.left = `${labelX}px`;
      if (b.index) lab.append(el("b", "", `#${b.index}`), document.createTextNode(" "));
      lab.append(document.createTextNode(b.index ? b.label.replace(`#${b.index} `, "") : b.label));
      marks.append(lab);
    }
  });
  marks.style.width = mode === "view" ? `${labelX + 210}px` : `${12 + order.length * step + 4}px`;
  body.append(list, marks);
  fig.append(body);
  return fig;
}

function summary(m: ViewModel): HTMLElement {
  const box = el("div", `summary t-${m.seal.tone}`);
  const text = el("div", "", m.seal.title);
  text.append(el("span", "sub", m.seal.detail));
  box.append(el("span", "icon", m.seal.mark), text);
  return box;
}

function sigList(m: ViewModel): HTMLElement {
  const ul = el("ul", "sigs");
  for (const c of m.cards) {
    const li = el("li", hue(c.index, c.tone));
    const top = el("div", "sig-top");
    top.append(el("span", "idx", `#${c.index}`), el("span", "signer", c.signer));
    if (c.role) top.append(el("span", "badge", c.role));
    top.append(el("span", `status t-${c.tone}`, `${c.mark} ${c.status}`));
    li.append(top, el("div", "meta", c.method));
    if (mode === "view" && c.rows.length) {
      const dl = el("dl");
      for (const [k, v] of c.rows) dl.append(el("dt", "", k), el("dd", "", v));
      li.append(dl);
    }
    if (c.newKey) {
      const nk = el("div", "newkey");
      const info = el("div", "nk-info");
      info.append(el("b", "", m.strings.newKey!), el("code", "", c.newKey.fingerprint));
      if (mode === "view") info.append(el("span", "nk-note", m.strings.newKeyNote!));
      const k = c.newKey;
      nk.append(info, button(m.strings.trust!, "secondary", () => post({ type: "trust", signer: k.signer, key: k.key, fingerprint: k.fingerprint })));
      li.append(nk);
    }
    const act = el("div", "sig-actions");
    act.append(button(m.strings.jump!, "link", () => post({ type: "jump", line: c.line })));
    if (c.keyChanged) act.append(button(m.strings.accept!, "link", () => post({ type: "accept" })));
    li.append(act);
    ul.append(li);
  }
  return ul;
}

function stepList(m: ViewModel): HTMLElement {
  const ul = el("ul", "sigs");
  const li = el("li");
  const steps = el("ul", "steps");
  for (const st of m.steps) {
    if (st.label) steps.append(el("li", `step${st.done ? " done" : ""}`, `${st.done ? "✓" : "…"} ${st.label}`));
    for (const mem of st.members) steps.append(el("li", mem.done ? "done" : "", `${mem.done ? "✓" : "○"} ${mem.text}`));
  }
  li.append(steps);
  ul.append(li);
  return ul;
}

type TabId = "signatures" | "ranges" | "agreement";

function tabs(m: ViewModel): HTMLElement {
  const items: [TabId, string, () => HTMLElement][] = [];
  if (m.cards.length) items.push(["signatures", m.strings.signatures!, () => sigList(m)]);
  items.push(["ranges", m.strings.ranges!, () => figure(m)]);
  if (m.steps.length) items.push(["agreement", m.strings.agreementTab!, () => stepList(m)]);
  const wrap = el("div", "tabbed");
  if (items.length === 1) {
    wrap.append(items[0]![2]());
    return wrap;
  }
  const state = (vscode.getState() as { tab?: TabId } | undefined) ?? {};
  let current = items.find(([id]) => id === state.tab)?.[0] ?? items[0]![0];
  const bar = el("div", "tabs");
  bar.setAttribute("role", "tablist");
  const panel = el("div", "tab-panel");
  panel.setAttribute("role", "tabpanel");
  const buttons: HTMLButtonElement[] = [];
  const select = (id: TabId, focus = false) => {
    current = id;
    vscode.setState({ ...state, tab: id });
    buttons.forEach((b) => {
      const on = b.dataset.tab === id;
      b.setAttribute("aria-selected", String(on));
      b.tabIndex = on ? 0 : -1;
      if (on && focus) b.focus();
    });
    panel.replaceChildren(items.find(([x]) => x === id)![2]());
  };
  items.forEach(([id, label], i) => {
    const b = el("button", "tab", label);
    b.type = "button";
    b.dataset.tab = id;
    b.setAttribute("role", "tab");
    b.addEventListener("click", () => select(id));
    b.addEventListener("keydown", (ev) => {
      const d = ev.key === "ArrowRight" ? 1 : ev.key === "ArrowLeft" ? -1 : 0;
      if (d) select(items[(i + d + items.length) % items.length]![0], true);
    });
    buttons.push(b);
    bar.append(b);
  });
  wrap.append(bar, panel);
  select(current);
  return wrap;
}

function actions(strings: Record<string, string>, signed: boolean): HTMLElement {
  const a = el("div", "panel-actions");
  if (document.body.dataset.web !== "true") {
    a.append(button(strings.sign!, "primary", () => post({ type: "command", id: "mdsig.sign" })));
    if (signed) a.append(button(strings.timestamp!, "secondary", () => post({ type: "command", id: "mdsig.timestamp" })));
  }
  a.append(button(strings.verify!, "secondary", () => post({ type: "command", id: "mdsig.verify" })));
  if (signed) a.append(button(strings.openView!, "secondary", () => post({ type: "command", id: "mdsig.openView" })));
  return a;
}

function render(m: ViewModel | null, strings: Record<string, string>, doc: boolean) {
  root.replaceChildren();
  if (!m) {
    root.append(el("p", "empty", doc ? strings.unsigned : strings.noDoc));
    if (doc && mode === "panel") root.append(actions(strings, false));
    return;
  }
  const signed = m.cards.length > 0;
  const note = m.online ? [] : [el("p", "note", m.strings.offline)];
  if (mode === "panel") root.append(summary(m), ...note, actions(m.strings, signed), tabs(m));
  else root.append(summary(m), ...note, tabs(m));
}

window.addEventListener("message", (ev) => {
  const msg = ev.data as { type: string; model?: ViewModel; strings?: Record<string, string>; doc?: boolean; line?: number; focus?: boolean };
  if (msg.type === "reveal" && msg.focus) document.querySelector<HTMLButtonElement>('.tab[data-tab="ranges"][aria-selected="false"]')?.click();
  if (msg.type === "model") render(msg.model ?? null, msg.strings ?? msg.model?.strings ?? {}, msg.doc ?? true);
  if (msg.type === "reveal" && msg.line) {
    const rows = [...document.querySelectorAll<HTMLElement>("[data-ln]")];
    const target = rows.find((r) => Number(r.dataset.ln) >= msg.line!);
    target?.scrollIntoView({ block: "start" });
    rows.forEach((r) => r.classList.toggle("focus", r === target));
  }
});

post({ type: "ready" });
