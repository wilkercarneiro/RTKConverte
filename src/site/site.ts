/* Página pública do Vertces: motor das cenas, navegação, perguntas e o
 * formulário de reunião. TypeScript puro, sem dependências.
 *
 * Tudo aqui é aprimoramento: sem JS (ou com "reduzir movimento") o HTML já
 * está inteiro, no estado final de cada cena. As animações só existem quando
 * o script do <head> liga `html.cenas`. */

type El = HTMLElement | SVGElement;

const doc = document;
const win = window;
const raiz = doc.documentElement;
const animar = raiz.classList.contains("cenas");
const menosMovimento = win.matchMedia("(prefers-reduced-motion: reduce)").matches;

const $ = <T extends Element = HTMLElement>(s: string, r: ParentNode = doc) => r.querySelector<T>(s);
const $$ = <T extends Element = HTMLElement>(s: string, r: ParentNode = doc) => Array.from(r.querySelectorAll<T>(s));
const limita = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/* ── formatos dos números que contam com a rolagem ─────────────────────── */
const fmt: Record<string, (v: number) => string> = {
  int: (v) => Math.round(v).toLocaleString("pt-BR"),
  ha: (v) => v.toLocaleString("pt-BR", { minimumFractionDigits: 4, maximumFractionDigits: 4 }) + " ha",
  m: (v) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " m",
  horas: (v) => {
    const h = Math.floor(v);
    const m = Math.floor((v - h) * 60);
    return `${h}h${String(m).padStart(2, "0")}`;
  },
  hora: (v) => {
    let h = Math.floor(v);
    let m = Math.round(((v - h) * 60) / 5) * 5;
    if (m === 60) { h += 1; m = 0; }
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  },
};

/* ── o motor das cenas ─────────────────────────────────────────────────────
 * Cada [data-cena] tem um palco grudado; `p` é quanto da cena já rolou. As
 * etapas [data-e] ganham `on` (atual) / `foi` (anteriores) e `--ep`, o
 * progresso dentro delas. [data-anima="de,para,ini,fim,formato"] conta um
 * número entre `ini` e `fim` de `p`. */
interface Etapa { el: El; i: number; ep: number; on: boolean; foi: boolean; }
interface Anima { el: El; de: number; para: number; ini: number; fim: number; f: (v: number) => string; txt: string; }
interface Cena { el: HTMLElement; n: number; ultimo: number; estagio: number; etapas: Etapa[]; animas: Anima[]; extra?: (p: number) => void; }

const cenas: Cena[] = $$("[data-cena]").map((el) => {
  const n = Number(el.getAttribute("data-estagios")) || 1;
  return {
    el,
    n,
    ultimo: -1,
    estagio: -1,
    etapas: $$<El>("[data-e]", el).map((x) => ({ el: x, i: Number(x.getAttribute("data-e")), ep: -1, on: false, foi: false })),
    animas: $$<El>("[data-anima]", el).map((x) => {
      const f = (x.getAttribute("data-anima") || "").split(",");
      return { el: x, de: +f[0], para: +f[1], ini: +f[2], fim: +f[3], f: fmt[f[4]] || fmt.int, txt: "" };
    }),
  };
});

function aplicar(c: Cena, p: number) {
  c.el.style.setProperty("--p", p.toFixed(4));
  const s = p * c.n;
  const cur = Math.min(c.n - 1, Math.floor(s));
  const local = limita(s - cur);
  if (cur !== c.estagio) {
    c.estagio = cur;
    c.el.setAttribute("data-estagio", String(cur));
  }
  for (const e of c.etapas) {
    const ep = e.i < cur ? 1 : e.i > cur ? 0 : local;
    const on = e.i === cur;
    const foi = e.i < cur;
    if (on !== e.on) { e.on = on; e.el.classList.toggle("on", on); }
    if (foi !== e.foi) { e.foi = foi; e.el.classList.toggle("foi", foi); }
    if (Math.abs(ep - e.ep) > 0.0008) { e.ep = ep; e.el.style.setProperty("--ep", ep.toFixed(4)); }
  }
  for (const a of c.animas) {
    const txt = a.f(a.de + (a.para - a.de) * limita((p - a.ini) / (a.fim - a.ini)));
    if (txt !== a.txt) { a.txt = txt; a.el.textContent = txt; }
  }
  c.extra?.(p);
}

/* Loteamento: o sol cruza o céu na etapa da maquete e as sombras das casas
 * giram no sentido oposto. */
const lote = cenas.find((c) => c.el.id === "loteamento");
if (lote) {
  const tab = $(".tab", lote.el);
  const sol = $("[data-sol]", lote.el);
  lote.extra = (p) => {
    const t = limita((p - 0.5) / 0.25);
    const ang = Math.PI * (0.08 + 0.84 * t);
    const alto = Math.sin(ang);
    const L = 55 + 95 * (1 - alto);
    tab?.style.setProperty("--sx", (-Math.cos(ang) * L).toFixed(1));
    tab?.style.setProperty("--sy", (25 + 45 * (1 - alto)).toFixed(1));
    sol?.style.setProperty("--sunx", (50 + Math.cos(ang) * 44).toFixed(1) + "%");
    sol?.style.setProperty("--suny", (30 - alto * 26).toFixed(1) + "%");
  };
}

/* Entradas: cada seção com [data-entrada] recebe `--e` enquanto o topo dela
 * sobe da base até o topo da tela. */
const entradas = $$("[data-entrada]").map((el) => ({ el, ultimo: -1 }));
const progressos = $$("[data-progresso]").map((el) => ({ el, ultimo: -1 }));
const saidas = $$("[data-saida]");

/* Topo: fundo ao rolar, tom claro/escuro conforme a seção embaixo dele e a
 * barrinha de progresso da página. */
const topo = $("[data-topo]");
const secoes = $$("main > section");
let tomAtual = "";

let pedido = false;
function quadro() {
  pedido = false;
  const vh = win.innerHeight;
  if (animar) {
    for (const c of cenas) {
      const r = c.el.getBoundingClientRect();
      if (r.bottom < -vh || r.top > vh * 2) continue;
      const p = limita(-r.top / Math.max(1, r.height - vh));
      if (Math.abs(p - c.ultimo) < 0.0004) continue;
      c.ultimo = p;
      aplicar(c, p);
    }
    for (const x of entradas) {
      const r = x.el.getBoundingClientRect();
      const e = r.top >= vh ? 0 : r.top <= 0 ? 1 : limita((vh - r.top) / vh);
      if (Math.abs(e - x.ultimo) < 0.0005) continue;
      x.ultimo = e;
      x.el.style.setProperty("--e", e.toFixed(4));
    }
    for (const x of progressos) {
      const r = x.el.getBoundingClientRect();
      if (r.bottom < -vh || r.top > vh * 2) continue;
      const p = limita((vh - r.top) / Math.max(1, vh + r.height));
      if (Math.abs(p - x.ultimo) < 0.0005) continue;
      x.ultimo = p;
      x.el.style.setProperty("--p", p.toFixed(4));
    }
    for (const el of saidas) {
      const r = el.getBoundingClientRect();
      if (r.bottom < 0) continue;
      el.style.setProperty("--s", limita(-r.top / Math.max(1, r.height)).toFixed(4));
    }
  }
  if (topo) {
    const y = win.scrollY;
    topo.classList.toggle("rolou", y > 24);
    const max = Math.max(1, doc.documentElement.scrollHeight - vh);
    topo.style.setProperty("--rol", limita(y / max).toFixed(4));
    const meio = topo.offsetHeight / 2;
    let tom = "escuro";
    for (const s of secoes) {
      const r = s.getBoundingClientRect();
      if (r.top <= meio && r.bottom > meio) { tom = s.classList.contains("dk") ? "escuro" : "claro"; break; }
    }
    if (tom !== tomAtual) { tomAtual = tom; topo.setAttribute("data-tom", tom); }
  }
}
function pedir() {
  if (!pedido) { pedido = true; requestAnimationFrame(quadro); }
}
win.addEventListener("scroll", pedir, { passive: true });
win.addEventListener("resize", () => {
  cenas.forEach((c) => (c.ultimo = -1));
  entradas.forEach((x) => (x.ultimo = -1));
  progressos.forEach((x) => (x.ultimo = -1));
  pedir();
});
quadro();

/* ── revelar ao entrar na tela ─────────────────────────────────────────── */
if (animar && "IntersectionObserver" in win) {
  const vistos = new IntersectionObserver(
    (es) => {
      for (const e of es) {
        if (!e.isIntersecting) continue;
        e.target.classList.add("in");
        vistos.unobserve(e.target);
      }
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
  );
  $$(".rv").forEach((el) => vistos.observe(el));
} else {
  $$(".rv").forEach((el) => el.classList.add("in"));
}

/* ── hero: a mira percorre os vértices e a leitura acompanha ────────────── */
(function mira() {
  const vis = $("[data-mira]");
  const alvo = $<SVGGElement>("[data-mira-alvo]");
  if (!vis || !alvo) return;
  const hero = vis.closest("section") as HTMLElement | null;
  const V: [number, number, string, string, string][] = [
    [212, 138, "VRTX-M-0001", "218", "442"],
    [372, 104, "VRTX-M-0002", "184", "607"],
    [500, 176, "VRTX-P-0003", "771", "830"],
    [528, 330, "VRTX-M-0004", "904", "801"],
    [430, 448, "VRTX-V-0005", "120", "953"],
    [262, 430, "VRTX-M-0006", "036", "927"],
    [150, 318, "VRTX-M-0007", "852", "590"],
  ];
  const cod = $("[data-leitura='cod']", vis);
  const e = $("[data-leitura='e']", vis);
  const n = $("[data-leitura='n']", vis);
  const milhar = (v: number) => Math.round(v).toLocaleString("pt-BR");
  let i = 0;
  let visivel = true;
  function ir(k: number) {
    const [x, y, c, de, dn] = V[k];
    alvo!.style.transform = `translate(${x}px, ${y}px)`;
    if (cod) cod.textContent = c;
    if (e) e.textContent = `${milhar(712000 + x * 2.5)},${de}`;
    if (n) n.textContent = `${milhar(8252000 - y * 2.5)},${dn}`;
  }
  ir(0);
  if (!animar) return;
  if (hero && "IntersectionObserver" in win) {
    new IntersectionObserver((es) => { visivel = es[0].isIntersecting; }).observe(hero);
  }
  setTimeout(() => {
    setInterval(() => {
      if (!visivel || doc.hidden) return;
      i = (i + 1) % V.length;
      ir(i);
    }, 1700);
  }, 3000);

  /* paralaxe leve do ponteiro (só mouse) */
  if (hero && win.matchMedia("(pointer: fine)").matches) {
    let pend = false;
    let mx = 0;
    let my = 0;
    hero.addEventListener("pointermove", (ev) => {
      const r = hero.getBoundingClientRect();
      mx = ((ev.clientX - r.left) / r.width) * 2 - 1;
      my = ((ev.clientY - r.top) / r.height) * 2 - 1;
      if (pend) return;
      pend = true;
      requestAnimationFrame(() => {
        pend = false;
        hero.style.setProperty("--mx", mx.toFixed(3));
        hero.style.setProperty("--my", my.toFixed(3));
      });
    });
  }
})();

/* ── navegação ─────────────────────────────────────────────────────────── */
(function navegacao() {
  const bt = $<HTMLButtonElement>("[data-menu]");
  const painel = $("#menu-cel");
  if (bt && painel) {
    const rotulo = $(".sr", bt);
    const fechar = () => {
      bt.setAttribute("aria-expanded", "false");
      painel.hidden = true;
      if (rotulo) rotulo.textContent = "Abrir menu";
    };
    bt.addEventListener("click", () => {
      const abrir = painel.hidden;
      painel.hidden = !abrir;
      bt.setAttribute("aria-expanded", String(abrir));
      if (rotulo) rotulo.textContent = abrir ? "Fechar menu" : "Abrir menu";
      if (abrir) topo?.classList.add("rolou");
    });
    $$("a", painel).forEach((a) => a.addEventListener("click", fechar));
    doc.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !painel.hidden) { fechar(); bt.focus(); }
    });
    win.addEventListener("resize", () => { if (win.innerWidth > 1080 && !painel.hidden) fechar(); });
  }

  /* marca no menu a seção que está sendo lida */
  const links = new Map<string, HTMLElement>();
  $$("[data-cap]").forEach((a) => links.set(a.getAttribute("data-cap") || "", a));
  if ("IntersectionObserver" in win) {
    const caps = new IntersectionObserver(
      (es) => {
        for (const e of es) links.get(e.target.id)?.classList.toggle("on", e.isIntersecting);
      },
      { rootMargin: "-45% 0px -50% 0px" },
    );
    links.forEach((_, id) => {
      const s = doc.getElementById(id);
      if (s) caps.observe(s);
    });
  }
})();

/* ── perguntas: abre e fecha com a altura animada ──────────────────────── */
$$<HTMLDetailsElement>(".faq details").forEach((d) => {
  const sum = $("summary", d);
  const corpo = $(".faq-r", d);
  if (!sum || !corpo || menosMovimento || !corpo.animate) return;
  let anim: Animation | null = null;
  sum.addEventListener("click", (ev) => {
    ev.preventDefault();
    anim?.cancel();
    const op: KeyframeAnimationOptions = { duration: 380, easing: "cubic-bezier(.22,1,.36,1)" };
    if (d.open) {
      const h = corpo.offsetHeight;
      anim = corpo.animate([{ height: `${h}px`, opacity: 1 }, { height: "0px", opacity: 0 }], { ...op, duration: 260 });
      anim.onfinish = () => { d.open = false; anim = null; };
    } else {
      d.open = true;
      const h = corpo.offsetHeight;
      anim = corpo.animate([{ height: "0px", opacity: 0 }, { height: `${h}px`, opacity: 1 }], op);
      anim.onfinish = () => { anim = null; };
    }
  });
});

/* ── ano do rodapé ─────────────────────────────────────────────────────── */
$$("[data-ano]").forEach((el) => (el.textContent = String(new Date().getFullYear())));

/* ── formulário de reunião ─────────────────────────────────────────────── */
(function formulario() {
  const form = $<HTMLFormElement>("[data-form]");
  if (!form) return;
  const st = $("[data-st]", form)!;
  const btn = $<HTMLButtonElement>("button[type='submit']", form)!;
  const btTx = $(".bt-tx", btn);
  const wa = $<HTMLAnchorElement>("[data-wa]", form);

  const env = import.meta.env;
  const base = String(env.VITE_SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const anon = String(env.VITE_SUPABASE_ANON_KEY || "").trim();
  const numeroWa = String(env.VITE_SUPORTE_WHATSAPP || "").replace(/\D/g, "");

  const campo = (nome: string) => form.elements.namedItem(nome) as HTMLInputElement | HTMLTextAreaElement;
  const valor = (nome: string) => (campo(nome)?.value || "").trim();

  function textoWa() {
    const linhas = ["Olá! Quero agendar uma demonstração do Vertces."];
    const nome = valor("nome");
    const emp = valor("empresa");
    const cid = valor("cidade_uf");
    if (nome) linhas.push(`Nome: ${nome}`);
    if (emp) linhas.push(`Escritório: ${emp}`);
    if (cid) linhas.push(`Cidade: ${cid}`);
    return linhas.join("\n");
  }
  function atualizarWa() {
    if (wa && numeroWa) wa.href = `https://wa.me/${numeroWa}?text=${encodeURIComponent(textoWa())}`;
  }
  if (wa && numeroWa) {
    wa.hidden = false;
    atualizarWa();
    form.addEventListener("input", atualizarWa);
  }

  function status(msg: string, tipo: "erro" | "ok" | "" = "") {
    st.textContent = msg;
    st.className = "form-st" + (tipo ? " " + tipo : "");
  }
  function marcar(nome: string, ruim: boolean) {
    const c = campo(nome);
    if (!c) return;
    if (ruim) c.setAttribute("aria-invalid", "true");
    else c.removeAttribute("aria-invalid");
  }
  form.addEventListener("input", (e) => {
    const alvo = e.target as HTMLElement;
    if (alvo.getAttribute("aria-invalid") === "true") alvo.removeAttribute("aria-invalid");
  });

  function validar(): { campo: string; msg: string } | null {
    const nome = valor("nome");
    const tel = valor("telefone");
    const email = valor("email");
    const erros: { campo: string; msg: string }[] = [];
    if (nome.length < 2 || nome.length > 120) erros.push({ campo: "nome", msg: "Informe o seu nome." });
    const dig = tel.replace(/\D/g, "");
    if (tel.length < 8 || tel.length > 30 || dig.length < 10 || dig.length > 15) erros.push({ campo: "telefone", msg: "Informe um WhatsApp ou telefone com DDD." });
    if (email && (email.length > 160 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) erros.push({ campo: "email", msg: "Confira o e-mail (ou deixe em branco)." });
    if (valor("empresa").length > 160) erros.push({ campo: "empresa", msg: "O nome da empresa ficou longo demais." });
    if (valor("cidade_uf").length > 80) erros.push({ campo: "cidade_uf", msg: "Use até 80 caracteres em Cidade/UF." });
    if (valor("mensagem").length > 2000) erros.push({ campo: "mensagem", msg: "A mensagem passou de 2.000 caracteres." });
    ["nome", "telefone", "email", "empresa", "cidade_uf", "mensagem"].forEach((n) => marcar(n, erros.some((x) => x.campo === n)));
    return erros[0] || null;
  }

  const dicaWa = numeroWa ? " Se preferir, chame a gente no WhatsApp." : "";

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (form.getAttribute("data-estado") === "enviando") return;
    const erro = validar();
    if (erro) {
      status(erro.msg, "erro");
      campo(erro.campo)?.focus();
      return;
    }
    if (!base || !anon) {
      status("O envio pelo site está indisponível no momento." + (numeroWa ? " Chame a gente no WhatsApp para marcar a reunião." : " Tente de novo mais tarde."), "erro");
      wa?.focus();
      return;
    }
    const corpo = {
      nome: valor("nome"),
      empresa: valor("empresa") || null,
      telefone: valor("telefone"),
      email: valor("email") || null,
      cidade_uf: valor("cidade_uf") || null,
      mensagem: valor("mensagem") || null,
      origem: "site",
    };
    form.setAttribute("data-estado", "enviando");
    btn.disabled = true;
    if (btTx) btTx.textContent = "Enviando…";
    status("");
    const ctrl = new AbortController();
    const prazo = setTimeout(() => ctrl.abort(), 15000);
    try {
      const r = await fetch(`${base}/rest/v1/contatos_site`, {
        method: "POST",
        headers: {
          apikey: anon,
          Authorization: `Bearer ${anon}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify(corpo),
        signal: ctrl.signal,
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      atualizarWa();
      form.reset();
      status("Recebemos! Vamos chamar você no WhatsApp para marcar a reunião.", "ok");
    } catch (e) {
      console.error("[vertice] contato", e);
      status("Não conseguimos enviar agora. Confira a conexão e tente de novo." + dicaWa, "erro");
    } finally {
      clearTimeout(prazo);
      form.removeAttribute("data-estado");
      btn.disabled = false;
      if (btTx) btTx.textContent = "Agendar uma demonstração";
    }
  });
})();
