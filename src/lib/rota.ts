// Roteamento por hash.
//
// A navegação era `useState` puro: atualizar a página caía no dashboard e o
// botão voltar do navegador saía do sistema. Numa tela em que o operador
// alterna entre cliente, serviço e configurações o dia inteiro, isso custa
// trabalho perdido.
//
// Hash e não History API de propósito: o app é servido como estático (Vercel) e
// `#/servico/x` nunca chega ao servidor — não há rota 404 para configurar.
import { useEffect, useState } from "react";

export type Rota =
  | { t: "inicio" }
  | { t: "clientes" }
  | { t: "servicos" }
  | { t: "config" }
  | { t: "equipe" }
  | { t: "ajuda" }
  | { t: "pedidos" }
  // ferramentas (sem serviço): consultar/analisar um imóvel, medir no campo
  // com o GPS do celular e calcular terraplanagem (corte e aterro)
  | { t: "consulta" }
  | { t: "campo" }
  | { t: "terraplanagem" }
  // públicas (abrem sem login). #/assinar?plano=<id>&ciclo=anual: o autocadastro
  // (0040) com o plano e o período já escolhidos; #/cadastro (o link antigo) cai nela
  | { t: "assinar"; plano?: string; ciclo?: string }
  | { t: "termos" }
  | { t: "privacidade" }
  // conferência pública de documento (QR da planta): #/verificar/<código>
  | { t: "verificar"; codigo?: string }
  | { t: "cliente"; id: string }
  | { t: "servico"; id: string }
  // pedidoId: serviço do GPROL que este vai executar (#/novo/<chave>/<cliente|->/<pedido>)
  | { t: "novo"; chave: string; clienteId?: string; pedidoId?: string }
  // painel do superadmin (SaaS): #/admin/<aba>[/<id da empresa>]
  | { t: "admin"; aba: string; id?: string };

export function rotaParaHash(r: Rota): string {
  switch (r.t) {
    case "cliente": return `#/cliente/${r.id}`;
    case "servico": return `#/servico/${r.id}`;
    case "novo": return `#/novo/${r.chave}${r.clienteId || r.pedidoId ? `/${r.clienteId ?? "-"}` : ""}${r.pedidoId ? `/${r.pedidoId}` : ""}`;
    case "admin": return `#/admin/${r.aba}${r.id ? `/${r.id}` : ""}`;
    case "verificar": return `#/verificar${r.codigo ? `/${r.codigo}` : ""}`;
    case "assinar": {
      const q = new URLSearchParams({ ...(r.plano ? { plano: r.plano } : {}), ...(r.ciclo ? { ciclo: r.ciclo } : {}) }).toString();
      return `#/assinar${q ? `?${q}` : ""}`;
    }
    default: return `#/${r.t}`;
  }
}

export function hashParaRota(hash: string): Rota {
  // a consulta (?plano=…) só existe no link de cadastro; o resto do caminho não a usa
  const [caminho, consulta = ""] = hash.replace(/^#\/?/, "").split("?");
  const p = caminho.split("/").filter(Boolean);
  switch (p[0]) {
    case "clientes": return { t: "clientes" };
    case "servicos": return { t: "servicos" };
    case "config": return { t: "config" };
    case "equipe": return { t: "equipe" };
    // o guia da marca mora no painel do superadmin (links antigos caem lá)
    case "marca": return { t: "admin", aba: "marca" };
    case "ajuda": return { t: "ajuda" };
    case "pedidos": return { t: "pedidos" };
    case "consulta": return { t: "consulta" };
    case "campo": return { t: "campo" };
    case "terraplanagem": return { t: "terraplanagem" };
    case "cadastro":
    case "assinar": {
      const q = new URLSearchParams(consulta);
      const plano = q.get("plano")?.trim();
      const ciclo = q.get("ciclo")?.trim();
      return { t: "assinar", ...(plano ? { plano } : {}), ...(ciclo ? { ciclo } : {}) };
    }
    case "termos": return { t: "termos" };
    case "privacidade": return { t: "privacidade" };
    case "verificar": return p[1] ? { t: "verificar", codigo: p[1] } : { t: "verificar" };
    case "cliente": return p[1] ? { t: "cliente", id: p[1] } : { t: "clientes" };
    case "servico": return p[1] ? { t: "servico", id: p[1] } : { t: "servicos" };
    // sem cliente na URL a chave nem aparece: um `clienteId: undefined`
    // explícito faria a rota deixar de ser igual à que a gerou
    case "novo": return p[1] ? { t: "novo", chave: p[1], ...(p[2] && p[2] !== "-" ? { clienteId: p[2] } : {}), ...(p[3] ? { pedidoId: p[3] } : {}) } : { t: "inicio" };
    case "admin": return { t: "admin", aba: p[1] ?? "visao", ...(p[2] ? { id: p[2] } : {}) };
    default: return { t: "inicio" };
  }
}

/** A última tela fora de "novo serviço": de onde a pessoa veio (useRota mantém). */
let origemDoNovo: Rota | null = null;

/**
 * Para onde o "← Voltar" de uma tela de novo serviço leva: para a tela de onde
 * a pessoa veio — a página do cliente, o Início ou a lista de serviços (um
 * pedido do GPROL com cliente, executado pelo Início, volta ao Início). Sem
 * origem conhecida (link aberto direto, F5), pelo endereço: com cliente
 * (#/novo/<chave>/<cliente>), ao cliente; senão, ao Início.
 */
export function voltarDoNovo(r: { clienteId?: string }, origem: Rota | null = origemDoNovo): { rota: Rota; rotulo: string } {
  if (origem?.t === "cliente") return { rota: origem, rotulo: "o cliente" };
  if (origem?.t === "inicio") return { rota: origem, rotulo: "o Início" };
  if (origem?.t === "servicos") return { rota: origem, rotulo: "os serviços" };
  return r.clienteId ? { rota: { t: "cliente", id: r.clienteId }, rotulo: "o cliente" } : { rota: { t: "inicio" }, rotulo: "o Início" };
}

// ---------------------------------------------------------------------------
// Pilha do sistema: o "‹ Voltar" do celular (fora do Início não há menu) volta
// para a tela anterior DESTE uso do sistema — e nunca sai dele. Cada entrada do
// histórico ganha um número (history.state.n); os endereços ficam guardados na
// aba (sessionStorage), então o F5 no meio de um serviço continua sabendo de onde
// veio. Aberto direto por um link (sem nada antes), volta ao "pai" da tela.
// ---------------------------------------------------------------------------
const CHAVE_PILHA = "vertces.pilha";
let atualN = 0;
let pilhaHashes: string[] = [];
const ouvintesPilha = new Set<() => void>();

function lerPilha(): string[] {
  try { const v = JSON.parse(sessionStorage.getItem(CHAVE_PILHA) ?? "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
}
function gravarPilha() {
  try { sessionStorage.setItem(CHAVE_PILHA, JSON.stringify(pilhaHashes.slice(-60))); } catch { /* aba privada: só não lembra */ }
}
function numeroDoEstado(): number | null {
  const n = (history.state as { n?: unknown } | null)?.n;
  return typeof n === "number" ? n : null;
}
function marcar(n: number) {
  history.replaceState({ ...(history.state ?? {}), n }, "");
}
if (typeof window !== "undefined") {
  pilhaHashes = lerPilha();
  const n = numeroDoEstado();
  if (n === null || pilhaHashes[n] !== location.hash) {
    // primeira tela desta aba (ou histórico que não é nosso): começa do zero
    atualN = 0; pilhaHashes = [location.hash]; marcar(0);
  } else {
    atualN = n;
  }
  gravarPilha();
  // A rolagem é nossa (não do navegador): tela nova abre no TOPO; voltar
  // devolve a tela onde ela estava — como no WhatsApp. Antes, a tela nova
  // herdava a rolagem da anterior (abria no meio).
  try { history.scrollRestoration = "manual"; } catch { /* navegador antigo */ }
  addEventListener("hashchange", () => {
    rolagens[atualN] = scrollY; // a tela que sai ainda está desenhada aqui
    const n2 = numeroDoEstado();
    let voltou = false;
    if (n2 !== null && pilhaHashes[n2] === location.hash) {
      atualN = n2; // voltar/avançar do navegador
      voltou = true;
    } else {
      atualN += 1; // entrada nova: o que estava à frente deixa de existir
      pilhaHashes = [...pilhaHashes.slice(0, atualN), location.hash];
      marcar(atualN);
    }
    gravarPilha();
    ouvintesPilha.forEach((f) => f());
    rolarPara(voltou ? rolagens[atualN] ?? 0 : 0);
  });
}

const rolagens: Record<number, number> = {};
/** Leva a página a `y` depois que a tela nova desenhar; se os dados ainda
 *  estão chegando (página curta), tenta de novo — a menos que a pessoa já
 *  tenha rolado por conta própria. */
function rolarPara(y: number) {
  // a pessoa mexeu (dedo, roda, tecla): para de insistir
  let mexeu = false;
  const parar = () => { mexeu = true; };
  const eventos = ["touchstart", "wheel", "keydown", "mousedown"] as const;
  eventos.forEach((e) => addEventListener(e, parar, { passive: true, once: true }));
  const tentar = () => {
    if (mexeu) return;
    const alvo = Math.min(y, Math.max(0, document.documentElement.scrollHeight - innerHeight));
    if (Math.abs(scrollY - alvo) > 1) scrollTo({ top: alvo, left: 0, behavior: "instant" as ScrollBehavior });
  };
  requestAnimationFrame(() => requestAnimationFrame(tentar));
  if (y > 0) [150, 400, 800].forEach((ms) => setTimeout(tentar, ms));
  setTimeout(() => eventos.forEach((e) => removeEventListener(e, parar)), 900);
}

/** Tela que o "‹ Voltar" leva quando não há nada antes nesta aba. */
export function paiDe(r: Rota): Rota {
  switch (r.t) {
    case "servico": return { t: "servicos" };
    case "cliente": return { t: "clientes" };
    case "novo": return voltarDoNovo(r).rota;
    default: return { t: "inicio" };
  }
}

const NOMES: Partial<Record<Rota["t"], string>> = {
  inicio: "Início", servicos: "Serviços", clientes: "Clientes", cliente: "Cliente", servico: "Serviço",
  config: "Configurações", equipe: "Equipe", ajuda: "Ajuda", pedidos: "Pedidos", consulta: "Consulta",
  campo: "Campo", terraplanagem: "Terraplanagem", novo: "Novo serviço", admin: "Painel",
};

/**
 * Para onde o "‹ Voltar" do celular leva: a tela anterior desta aba (pelo
 * histórico do navegador, que mantém a rolagem e o estado) ou, sem nada antes,
 * o pai da tela atual. `rotulo` é o nome da tela de destino.
 */
export function useVoltar(rota: Rota, ir: (r: Rota) => void): { rotulo: string; voltar: () => void } {
  const [, setVersao] = useState(0);
  useEffect(() => {
    const f = () => setVersao((v) => v + 1);
    ouvintesPilha.add(f);
    return () => { ouvintesPilha.delete(f); };
  }, []);
  const anterior = atualN > 0 ? pilhaHashes[atualN - 1] : undefined;
  if (anterior !== undefined) {
    const r = hashParaRota(anterior);
    return { rotulo: NOMES[r.t] ?? "Voltar", voltar: () => history.back() };
  }
  const pai = paiDe(rota);
  return { rotulo: NOMES[pai.t] ?? "Início", voltar: () => ir(pai) };
}

/** Rota atual + navegação. `trocar` empilha no histórico; `substituir`, não. */
export function useRota(): { rota: Rota; ir: (r: Rota) => void; substituir: (r: Rota) => void } {
  const [rota, setRota] = useState<Rota>(() => hashParaRota(location.hash));

  useEffect(() => {
    const onHash = () => setRota(hashParaRota(location.hash));
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);
  useEffect(() => { if (rota.t !== "novo") origemDoNovo = rota; }, [rota]);

  return {
    rota,
    ir: (r) => { location.hash = rotaParaHash(r); },
    // replace: usado quando a tela atual deixou de existir (ex.: serviço recém
    // criado assume o lugar da tela "novo"), para que voltar não retorne a ela
    substituir: (r) => {
      // mantém o número da entrada (a pilha do "‹ Voltar") e troca o endereço dela
      const h = rotaParaHash(r);
      history.replaceState(history.state, "", h);
      pilhaHashes[atualN] = h;
      gravarPilha();
      setRota(r);
    },
  };
}
