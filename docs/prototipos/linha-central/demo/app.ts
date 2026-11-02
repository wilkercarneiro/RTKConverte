// Demonstração interativa do motor da linha central (protótipo). Sem dependências.
import { estruturar, montar, montarMelhor, notaDe, cruzamentos, type Pt, type Layout, type Estrutura, type LoteL } from "../espinha.ts";

interface QuadraDemo { id: string; nome: string; origem: string; N: number; anel: Pt[]; tipos: ("rua" | "via" | "divisa" | "outro")[]; refs: string[]; antes?: { id: string; area: number; anel: Pt[]; problemas: string[] }[] }
declare const DADOS: { quadras: QuadraDemo[]; params: { profMin: number; profPadrao: number; frenteMin: number; areaMin: number } };

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const svg = $("prancheta") as unknown as SVGSVGElement;
const NS = "http://www.w3.org/2000/svg";
const fmt = (v: number, c = 2) => v.toLocaleString("pt-BR", { minimumFractionDigits: c, maximumFractionDigits: c });

interface Estado {
  q: QuadraDemo; E: Estrutura; L: Layout | null; C: Pt[] | null; N: number;
  esquinas: "absorver" | "iguais"; cab: ("auto" | "direta" | "ponta" | "testa")[];
  vista: "novo" | "antes"; hist: { C: Pt[] | null; N: number; L: Layout | null; manual: boolean }[]; ms: number; msg: string; manual: boolean;
}
let st: Estado;
let caixa = { minx: 0, miny: 0, w: 1, h: 1, m: 8 };

function cfgBase() {
  return { N: st.N, profMin: DADOS.params.profMin, profPadrao: DADOS.params.profPadrao, esquinas: st.esquinas };
}
function medir<T>(f: () => T): T { const t0 = performance.now(); const r = f(); st.ms = performance.now() - t0; return r; }

function ajustarAuto() {
  try {
    const L = medir(() => montarMelhor(st.E, { ...cfgBase() }));
    st.L = L; st.C = L.C.map((p) => [p[0], p[1]] as Pt);
    st.cab = [(L.cabeceiras?.[0] ?? "auto"), (L.cabeceiras?.[1] ?? "auto")];
    st.manual = false;
    st.msg = notaDe(L, st.N).desvio < 0.001 ? "Linha central automática: todos os lotes com a mesma área, laterais no esquadro da rua, fundo com fundo alinhado." : "Linha central automática: lotes do miolo com a mesma área; a esquina da fileira mais comprida absorve a cabeceira inclinada.";
  } catch (e) { st.msg = "Não fechou: " + (e as Error).message; }
}
function valido(L: Layout, exigirN = true): string | null {
  if (cruzamentos(L) > 0) return "as divisas se cruzariam";
  const n = notaDe(L, st.N);
  if (n.q5 > 0) return "algum lote ficaria com 5 quinas";
  if (L.avisos.some((a) => a.includes("não fechou"))) return "uma divisa não fecha a área";
  if (exigirN && L.lotes.length !== st.N) return `sairiam ${L.lotes.length} lotes`;
  if (n.desvio > 0.75) return "um lote ficaria grande ou pequeno demais";
  if (n.gmax > 30) return `uma lateral giraria ${fmt(n.gmax, 0)}° fora do esquadro`;
  return null;
}
function equilibrar(C: Pt[], aviso = true) {
  let erro = "";
  const t0 = performance.now();
  for (const extra of [{}, { _passo: 4 }]) {
    try {
      const L = montar(st.E, { ...cfgBase(), cab1: st.cab[0], cab2: st.cab[1], _C0: C, ...extra });
      const e = valido(L);
      if (e) { erro = erro || e; continue; }
      st.ms = performance.now() - t0;
      st.L = L; st.C = L.C.map((p) => [p[0], p[1]] as Pt); st.manual = true;
      if (aviso) st.msg = "Linha central sua: os ângulos ficaram como você deixou; ela só deslizou de lado para todos os lotes ficarem com a mesma área.";
      return true;
    } catch (e) { erro = erro || (e as Error).message; }
  }
  st.ms = performance.now() - t0;
  st.msg = "Essa linha não fecha: " + erro;
  return false;
}
function livre(C: Pt[]) {
  try {
    const L = medir(() => montar(st.E, { ...cfgBase(), cab1: st.cab[0], cab2: st.cab[1], C, _vivo: true }));
    if (cruzamentos(L) > 0) return false;
    st.L = L; return true;
  } catch { return false; }
}

function abrir(id: string) {
  const q = DADOS.quadras.find((x) => x.id === id)!;
  const E = estruturar(q.anel, q.tipos, q.refs);
  st = { q, E, L: null, C: null, N: q.N, esquinas: "absorver", cab: ["auto", "auto"], vista: "novo", hist: [], ms: 0, msg: "", manual: false };
  const xs = q.anel.map((p) => p[0]), ys = q.anel.map((p) => p[1]);
  const m = Math.max(xs.length ? (Math.max(...xs) - Math.min(...xs)) : 10, Math.max(...ys) - Math.min(...ys)) * 0.06;
  caixa = { minx: Math.min(...xs) - m, miny: Math.min(...ys) - m, w: Math.max(...xs) - Math.min(...xs) + 2 * m, h: Math.max(...ys) - Math.min(...ys) + 2 * m, m };
  svg.setAttribute("viewBox", `0 0 ${caixa.w.toFixed(2)} ${caixa.h.toFixed(2)}`);
  ajustarAuto();
  ($("vista-antes") as HTMLButtonElement).disabled = !q.antes;
  $("origem").textContent = q.origem;
  render();
}

const X = (p: Pt) => p[0] - caixa.minx;
const Y = (p: Pt) => caixa.miny + caixa.h - p[1];
const dPath = (r: Pt[], fecha = true) => "M" + r.map((p) => `${X(p).toFixed(2)},${Y(p).toFixed(2)}`).join("L") + (fecha ? "Z" : "");
function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, pai: Element = svg): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  pai.appendChild(e);
  return e;
}
const centro = (r: Pt[]): Pt => {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length], c = p[0] * q[1] - q[0] * p[1]; a += c; cx += (p[0] + q[0]) * c; cy += (p[1] + q[1]) * c; }
  return Math.abs(a) < 1e-9 ? r[0] : [cx / (3 * a), cy / (3 * a)];
};

/** numeração em volta da quadra: ponta/testa 1, fileira 1, ponta/testa 2, fileira 2 ao contrário */
function numerar(L: Layout): Map<LoteL, number> {
  const ordem: LoteL[] = [];
  const z = (n: string) => L.lotes.filter((l) => l.zona === n).sort((a, b) => a.ordem - b.ordem);
  ordem.push(...z("ponta1").reverse(), ...z("testa1"), ...z("f1"), ...z("ponta2").reverse(), ...z("testa2"), ...z("f2").reverse());
  return new Map(ordem.map((l, i) => [l, i + 1]));
}

function escalaENorte(fs: number) {
  // barra de escala com número redondo e seta do norte (o plano é o da UTM: norte para cima)
  const alvo = caixa.w / 6;
  const passos = [5, 10, 20, 25, 50, 100];
  const L = passos.reduce((a, b) => (Math.abs(b - alvo) < Math.abs(a - alvo) ? b : a));
  const x0 = caixa.m * 0.6, y0 = caixa.h - caixa.m * 0.45;
  const g = el("g", { class: "escala" });
  el("rect", { x: x0, y: y0 - fs * 0.32, width: L / 2, height: fs * 0.32, class: "esc-a" }, g);
  el("rect", { x: x0 + L / 2, y: y0 - fs * 0.32, width: L / 2, height: fs * 0.32, class: "esc-b" }, g);
  el("text", { x: x0, y: y0 - fs * 0.55, class: "esc-t", "font-size": fs * 0.8, "text-anchor": "start" }, g).textContent = "0";
  el("text", { x: x0 + L, y: y0 - fs * 0.55, class: "esc-t", "font-size": fs * 0.8, "text-anchor": "end" }, g).textContent = `${L} m`;
  const nx = caixa.w - caixa.m * 0.7, ny = caixa.m * 0.5;
  el("path", { d: `M${nx},${ny} l${fs * 0.55},${fs * 1.5} l${-fs * 0.55},${-fs * 0.45} l${-fs * 0.55},${fs * 0.45}Z`, class: "norte" }, g);
  el("text", { x: nx, y: ny + fs * 2.6, class: "esc-t", "font-size": fs * 0.85 }, g).textContent = "N";
}

function render() {
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  const fs = Math.max(caixa.w, caixa.h * 1.3) / 60;
  const q = st.q;
  escalaENorte(fs);
  // rua em volta (faixa) e a quadra
  el("path", { d: dPath(q.anel), class: "quadra" });
  const tip = $("dica");
  if (st.vista === "antes" && q.antes) {
    q.antes.forEach((l) => {
      const ruim = l.problemas.length > 0;
      const p = el("path", { d: dPath(l.anel), class: "lote antes" + (ruim ? " ruim" : "") });
      p.addEventListener("pointerenter", () => { tip.innerHTML = `<b>${l.id}</b> · ${fmt(l.area)} m²${ruim ? `<br><span class="aviso">${l.problemas.join("<br>")}</span>` : ""}`; });
      const c = centro(l.anel);
      el("text", { x: X(c), y: Y(c), class: "rot", "font-size": fs }).textContent = l.id.split("-")[1];
      el("text", { x: X(c), y: Y(c) + fs * 1.05, class: "rot-area", "font-size": fs * 0.78 }).textContent = fmt(l.area, 1);
    });
    resumo();
    return;
  }
  const L = st.L;
  if (!L) return;
  const num = numerar(L);
  for (const l of L.lotes) {
    const ruim = l.quinas.length > 4;
    const p = el("path", { d: dPath(l.anel), class: `lote z-${l.zona}${ruim ? " ruim" : ""}` });
    p.addEventListener("pointerenter", () => {
      const g = l.giroLat.filter(Number.isFinite);
      const lin = [`<b>Lote ${String(num.get(l)).padStart(2, "0")}</b> · ${fmt(l.area)} m²`];
      if (l.zona === "f1" || l.zona === "f2") lin.push(`frente ${fmt(l.frente)} m · fundo ${fmt(l.fundo)} m`, `laterais ${l.laterais.map((v) => fmt(v)).join(" e ")} m`);
      else lin.push(l.zona.startsWith("ponta") ? "ponta de fileira única (de rua a rua)" : "cabeceira: frente para a rua da ponta");
      if (g.length) lin.push(`laterais fora do esquadro: ${g.map((v) => fmt(v, 1) + "°").join(" e ")}`);
      lin.push(`${l.quinas.length} quinas${l.quinas.some((k) => k.arco) ? " (o arco da esquina conta como uma)" : ""}`);
      tip.innerHTML = lin.join("<br>");
    });
  }
  // divisas compartilhadas (as que cruzam a linha central) em destaque
  for (const d of L.divisas) if (d.length === 3) el("path", { d: dPath(d, false), class: "divisa" });
  // quinas de arco (PI)
  for (const l of L.lotes) for (const k of l.quinas) if (k.arco) el("circle", { cx: X(k.pi), cy: Y(k.pi), r: fs * 0.32, class: "pi" });
  for (const l of L.lotes) {
    const c = centro(l.anel);
    el("text", { x: X(c), y: Y(c), class: "rot", "font-size": fs }).textContent = String(num.get(l)).padStart(2, "0");
    el("text", { x: X(c), y: Y(c) + fs * 1.05, class: "rot-area", "font-size": fs * 0.78 }).textContent = fmt(l.area, 1);
  }
  // linha central e alças
  const C = st.C ?? L.C;
  const linha = el("path", { d: dPath(C, false), class: "central" });
  const linhaToque = el("path", { d: dPath(C, false), class: "central-toque" });
  linhaToque.addEventListener("dblclick", (ev) => novoVertice(ev as MouseEvent));
  void linha;
  for (const j of L.juncoes) el("circle", { cx: X(j), cy: Y(j), r: fs * 0.22, class: "juncao" });
  C.forEach((v, i) => {
    const g = el("g", { class: "alca", tabindex: 0, role: "button", "aria-label": `ponto ${i + 1} da linha central` });
    el("circle", { cx: X(v), cy: Y(v), r: fs * 1.1, class: "alca-toque" }, g);
    el("rect", { x: X(v) - fs * 0.42, y: Y(v) - fs * 0.42, width: fs * 0.84, height: fs * 0.84, transform: `rotate(45 ${X(v)} ${Y(v)})`, class: "alca-forma" }, g);
    g.addEventListener("pointerdown", (ev) => iniciarArraste(ev as PointerEvent, i));
    g.addEventListener("dblclick", () => apagarVertice(i));
  });
  resumo();
}

function resumo() {
  const L = st.L, q = st.q;
  const set = (id: string, html: string) => { $(id).innerHTML = html; };
  if (st.vista === "antes" && q.antes) {
    const ar = q.antes.map((l) => l.area), ruins = q.antes.filter((l) => l.problemas.length);
    set("k-lotes", String(q.antes.length));
    set("k-area", `${fmt(Math.min(...ar), 1)} a ${fmt(Math.max(...ar), 1)}`);
    set("k-giro", "—");
    set("k-quinas", String(ruins.filter((l) => l.problemas.some((p) => p.includes("quinas"))).length));
    set("k-fundo", "—");
    set("k-avisos", String(ruins.length));
    set("mensagem", `Assim está hoje no sistema: ${ruins.map((l) => `${l.id} (${l.problemas.join("; ")})`).join(" · ") || "sem avisos"}.`);
    return;
  }
  if (!L) return;
  const n = notaDe(L, st.N);
  const ar = L.lotes.map((l) => l.area);
  const mn = Math.min(...ar), mx = Math.max(...ar);
  set("k-lotes", String(L.lotes.length));
  set("k-area", mx - mn < 0.05 ? `${fmt(mn, 2)} <small>todas iguais</small>` : `${fmt(mn, 1)} a ${fmt(mx, 1)}`);
  set("k-giro", `${fmt(n.gmax, 1)}°`);
  set("k-quinas", String(n.q5));
  const pares = L.lotes.filter((l) => l.zona === "f1").length;
  set("k-fundo", `${L.juncoes.length + 1} de ${pares}`);
  set("k-avisos", String(L.avisos.length));
  const cab = (L.cabeceiras ?? []).map((c) => ({ direta: "esquina direta", ponta: "ponta de fileira única", testa: "lotes de frente para a rua da ponta" }[c])).join(" · ");
  set("mensagem", `${st.msg}${cab ? ` <span class="sub">Cabeceiras: ${cab}.</span>` : ""}${L.avisos.length ? ` <span class="aviso">${L.avisos.join(" · ")}</span>` : ""} <span class="sub">Cálculo: ${fmt(st.ms, 0)} ms.</span>`);
  $("n-lotes").textContent = String(st.N);
}

// --- arraste da linha central
let arraste: { i: number; C0: Pt[]; ultimo: Pt[] | null; quadro: number } | null = null;
function paraPlano(ev: { clientX: number; clientY: number }): Pt {
  const pt = svg.createSVGPoint(); pt.x = ev.clientX; pt.y = ev.clientY;
  const m = svg.getScreenCTM(); if (!m) return [0, 0];
  const s = pt.matrixTransform(m.inverse());
  return [s.x + caixa.minx, caixa.miny + caixa.h - s.y];
}
function projetarNaBorda(p: Pt): Pt {
  const r = st.q.anel;
  let best: Pt = r[0], bd = Infinity;
  for (let i = 0; i < r.length; i++) {
    const a = r[i], b = r[(i + 1) % r.length], ab: Pt = [b[0] - a[0], b[1] - a[1]], l2 = ab[0] ** 2 + ab[1] ** 2;
    const f = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / l2)) : 0;
    const q: Pt = [a[0] + ab[0] * f, a[1] + ab[1] * f], d = Math.hypot(p[0] - q[0], p[1] - q[1]);
    if (d < bd) { bd = d; best = q; }
  }
  return best;
}
const naBorda = (p: Pt) => { const q = projetarNaBorda(p); return Math.hypot(p[0] - q[0], p[1] - q[1]) < 0.5; };
function iniciarArraste(ev: PointerEvent, i: number) {
  if (!st.C) return;
  ev.preventDefault();
  (ev.target as Element).setPointerCapture?.(ev.pointerId);
  st.hist.push({ C: st.C.map((p) => [p[0], p[1]] as Pt), N: st.N, L: st.L, manual: st.manual });
  arraste = { i, C0: st.C.map((p) => [p[0], p[1]] as Pt), ultimo: null, quadro: 0 };
  svg.classList.add("arrastando");
}
svg.addEventListener("pointermove", (ev) => {
  if (!arraste) return;
  const p = paraPlano(ev);
  const C = arraste.C0.map((q) => [q[0], q[1]] as Pt);
  const ponta = arraste.i === 0 || arraste.i === C.length - 1;
  C[arraste.i] = ponta && naBorda(arraste.C0[arraste.i]) ? projetarNaBorda(p) : p;
  arraste.ultimo = C;
  if (arraste.quadro) return;
  arraste.quadro = requestAnimationFrame(() => {
    if (!arraste) return;
    arraste.quadro = 0;
    const Cn = arraste.ultimo!;
    if (livre(Cn)) { st.C = Cn; st.msg = "Arrastando: cada fileira fica igual entre si; ao soltar, as duas se igualam."; render(); }
  });
});
const soltar = () => {
  if (!arraste) return;
  const C = st.C!;
  const { C0, i } = arraste;
  arraste = null;
  svg.classList.remove("arrastando");
  for (const f of [1, 0.75, 0.5, 0.25]) {
    const Cf = C0.map((q) => [q[0], q[1]] as Pt);
    const alvo: Pt = [C0[i][0] + (C[i][0] - C0[i][0]) * f, C0[i][1] + (C[i][1] - C0[i][1]) * f];
    Cf[i] = (i === 0 || i === Cf.length - 1) && naBorda(C0[i]) ? projetarNaBorda(alvo) : alvo;
    if (equilibrar(Cf)) {
      if (f < 1) st.msg = `O ponto foi até onde a quadra deixa (${Math.round(f * 100)}% do que você puxou): mais que isso, uma lateral sairia mais de 30° do esquadro, uma fileira ficaria rasa demais ou um lote deformaria. Todos continuam com a mesma área.`;
      render();
      return;
    }
  }
  if (true) {
    // não deu para igualar as duas fileiras com essa dobra: fica a sua linha, cada fileira igual entre si
    try {
      const L = montar(st.E, { ...cfgBase(), cab1: st.cab[0], cab2: st.cab[1], C });
      if (valido(L) || Math.abs(L.T1 - L.T2) > 0.15 * Math.max(L.T1, L.T2)) throw new Error("ruim");
      st.L = L; st.C = C; st.manual = true;
      st.msg = `Com essa dobra a linha passa perto demais de uma rua: cada fileira ficou igual entre si (${fmt(L.T1, 1)} e ${fmt(L.T2, 1)} m²), mas as duas não empatam. Volte um pouco o ponto ou clique Ajustar.`;
    } catch {
      const h = st.hist.pop();
      if (h) { st.L = h.L; st.C = h.C; st.N = h.N; st.manual = h.manual; }
      st.msg = (st.msg.startsWith("Essa linha não fecha") ? st.msg : "Essa linha não fecha") + ". Voltei para a anterior.";
    }
  }
  render();
};
svg.addEventListener("pointerup", soltar);
svg.addEventListener("pointercancel", soltar);

function novoVertice(ev: MouseEvent) {
  if (!st.C) return;
  const p = paraPlano(ev);
  // insere no trecho mais perto
  let best = 0, bd = Infinity;
  for (let i = 0; i + 1 < st.C.length; i++) {
    const a = st.C[i], b = st.C[i + 1], ab: Pt = [b[0] - a[0], b[1] - a[1]], l2 = ab[0] ** 2 + ab[1] ** 2;
    const f = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / l2)) : 0;
    const d = Math.hypot(p[0] - a[0] - ab[0] * f, p[1] - a[1] - ab[1] * f);
    if (d < bd) { bd = d; best = i; }
  }
  st.hist.push({ C: st.C.map((q) => [q[0], q[1]] as Pt), N: st.N, L: st.L, manual: st.manual });
  const C = st.C.slice(); C.splice(best + 1, 0, p);
  if (equilibrar(C)) st.msg = "Ponto novo na linha central: arraste-o para dobrar a linha ali.";
  render();
}
function apagarVertice(i: number) {
  if (!st.C || st.C.length <= 2 || i === 0 || i === st.C.length - 1) return;
  st.hist.push({ C: st.C.map((q) => [q[0], q[1]] as Pt), N: st.N, L: st.L, manual: st.manual });
  const C = st.C.slice(); C.splice(i, 1);
  equilibrar(C);
  render();
}

// --- controles
$("quadra").addEventListener("change", (e) => abrir((e.target as HTMLSelectElement).value));
$("btn-ajustar").addEventListener("click", () => {
  const b = $("btn-ajustar") as HTMLButtonElement; b.disabled = true; b.textContent = "Ajustando…";
  st.hist.push({ C: st.C?.map((p) => [p[0], p[1]] as Pt) ?? null, N: st.N, L: st.L, manual: st.manual });
  setTimeout(() => { st.cab = ["auto", "auto"]; ajustarAuto(); st.vista = "novo"; vista(); render(); b.disabled = false; b.textContent = "Ajustar fundo com fundo"; }, 30);
});
$("btn-reta").addEventListener("click", () => {
  if (!st.C) return;
  st.hist.push({ C: st.C.map((p) => [p[0], p[1]] as Pt), N: st.N, L: st.L, manual: st.manual });
  if (equilibrar([st.C[0], st.C[st.C.length - 1]])) st.msg = "Linha central reta, de ponta a ponta: as áreas continuam iguais.";
  render();
});
$("btn-desfazer").addEventListener("click", () => {
  const h = st.hist.pop(); if (!h) return;
  st.N = h.N; st.L = h.L; st.C = h.C; st.manual = h.manual;
  if (!st.L) ajustarAuto();
  st.msg = "Desfeito.";
  render();
});
const mudarN = (d: number) => {
  st.hist.push({ C: st.C?.map((p) => [p[0], p[1]] as Pt) ?? null, N: st.N, L: st.L, manual: st.manual });
  st.N = Math.max(4, st.N + d);
  const ok = st.manual && st.C ? equilibrar(st.C, false) : (ajustarAuto(), !!st.L && !valido(st.L));
  if (!ok) { const h = st.hist.pop()!; st.N = h.N; st.L = h.L; st.C = h.C; st.manual = h.manual; st.msg = `Com ${st.N + d} lotes esta quadra não fecha sem deformar lote; ficou com ${st.N}.`; }
  else st.msg = `${st.N} lotes. ` + (notaDe(st.L!, st.N).desvio < 0.001 ? "Todos com a mesma área." : "Os do miolo com a mesma área; a esquina absorve a cabeceira inclinada.");
  render();
};
$("n-menos").addEventListener("click", () => mudarN(-2));
$("n-mais").addEventListener("click", () => mudarN(2));
for (const id of ["esq-absorver", "esq-iguais"]) $(id).addEventListener("click", () => {
  st.esquinas = id === "esq-absorver" ? "absorver" : "iguais";
  $("esq-absorver").setAttribute("aria-pressed", String(st.esquinas === "absorver"));
  $("esq-iguais").setAttribute("aria-pressed", String(st.esquinas === "iguais"));
  if (st.manual && st.C) equilibrar(st.C); else ajustarAuto();
  render();
});
function vista() {
  $("vista-antes").setAttribute("aria-pressed", String(st.vista === "antes"));
  $("vista-novo").setAttribute("aria-pressed", String(st.vista === "novo"));
}
$("vista-antes").addEventListener("click", () => { st.vista = "antes"; vista(); render(); });
$("vista-novo").addEventListener("click", () => { st.vista = "novo"; vista(); render(); });
document.addEventListener("keydown", (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); $("btn-desfazer").click(); } });

const sel = $("quadra") as HTMLSelectElement;
for (const q of DADOS.quadras) { const o = document.createElement("option"); o.value = q.id; o.textContent = q.nome; sel.appendChild(o); }
abrir(DADOS.quadras[0].id);
vista();
