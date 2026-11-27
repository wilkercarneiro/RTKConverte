// Ferramentas da prancheta pedidas pelo Wilker em 25/11/2026:
//  - rua nova que NÃO redesenha o loteamento (os lotes ficam onde estão; a rua só corta);
//  - giro das divisas dos lotes selecionados (mesma posição na rua, outro ângulo);
//  - gerar uma quadra inteira (tamanho, quantidade e formato dos lotes);
//  - trava de direção no arraste (só para cima/baixo/esquerda/direita do lote);
//  - pontos de referência deixados pela ferramenta Medir.
//
// Tudo devolve um projeto novo (o desfazer vem de graça) e usa as mesmas peças da
// edição livre (`contornos`/`gravar` congelam a quadra nos lotes desenhados).
import {
  antiHorario, areaPol, bufferLinha, caixa, cross, dentroPol, eixoDoTraco, diferenca, dist, distSegmento, dot, esquerda, intersecao, lerp, limparAnel, mult, quinasAviso, soma, sub, uniaoFechada, unit,
} from "./geom.ts";
import type { Poligono, Pt } from "./geom.ts";
import type { Lote, Quadra, Resultado } from "./calculo.ts";
import { fmt } from "./calculo.ts";
import { apagarLotes, contornos, desenharLote, gravar, naBordaDaQuadra, normalizar, posicaoNoDesenho, unirLotes } from "./edicao.ts";
import type { Edicao, Meta } from "./edicao.ts";
import { pontoInterno } from "./auto.ts";
import { paraPlano, paraUtm } from "./plano.ts";
import { novoId } from "./modelo.ts";
import type { LoteDesenhado, PontoReferencia, Projeto, QuadraCfg } from "./modelo.ts";

type Calc = (p: Projeto) => Resultado | null;

// ---------------------------------------------------------------------------
// Rua nova sem redesenhar o loteamento (item 10)
// ---------------------------------------------------------------------------

/** Assinatura geométrica dos lotes (para saber se a quadra mudou com a rua nova). */
const assinatura = (ls: { pol: Poligono }[]) =>
  ls.map((l) => l.pol.ext.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).sort().join(";")).sort().join("|");

/**
 * A rua desenhada à mão entra no projeto SEM o sistema redividir as quadras: cada
 * quadra que a rua corta (ou que o cruzamento novo muda) é congelada com os lotes de
 * ANTES, recortados pelas quadras novas. Os lotes que a rua atravessa ficam menores;
 * o pedaço pequeno demais para lote vira área livre (rosa). As outras quadras não mudam.
 */
export function manterLotesComRuaNova(pr0: Projeto, res0: Resultado, pr1: Projeto, calc: Calc): { pr: Projeto; cortados: number; livres: number; vazias: number } {
  let pr = pr1;
  let cortados = 0, livres = 0;
  const removidas = new Set<number>();
  const novas: QuadraCfg[] = [];
  const r1 = calc(pr1);
  if (!r1) return { pr: pr1, cortados, livres, vazias: 0 };
  const pl = res0.plano;
  const todas1 = [...r1.quadras, ...(r1.quadrasVazias ?? [])];
  const vazios: Poligono[] = [];
  let vazias = 0;
  for (const q0 of res0.quadras) {
    if (!q0.lotes.length) continue;
    // os lotes que hoje ocupam a terra desta quadra
    const depois = r1.lotes.filter((l) => dentroPol(pontoInterno(l.pol), q0.pol));
    if (depois.length === q0.lotes.length && assinatura(depois) === assinatura(q0.lotes)) continue;
    const { aneis, destinos } = contornos(pr0, res0, q0);
    // as quadras novas que ficaram na terra desta
    const pedacos = todas1.filter((Q) => intersecao([Q.pol], [q0.pol]).reduce((s, x) => s + areaPol(x), 0) > 1);
    if (!pedacos.length) continue;
    if (q0.cfg >= 0) removidas.add(q0.cfg);
    for (const j of q0.fundidas ?? []) removidas.add(j);
    for (const Q of pedacos) {
      const lotes: LoteDesenhado[] = [];
      let maior: Poligono | null = null;
      aneis.forEach((a, k) => {
        if (a.length < 3) return;
        const pg: Poligono = { ext: antiHorario(a), furos: [] };
        const a0 = areaPol(pg);
        const dentro = intersecao([pg], [Q.pol]).sort((x, y) => areaPol(y) - areaPol(x))[0];
        if (!dentro) return;
        const ad = areaPol(dentro);
        // nem toca de verdade nesta quadra nova
        if (ad < 0.5) return;
        if (ad < a0 - 0.5) cortados++;
        // lasquinha que a rua deixou do lote (menos de 15% dele e menos de 40 m²): fica livre
        if (ad < Math.max(40, 0.15 * a0) && ad < a0 - 0.5) { livres++; return; }
        const anel = ad < a0 - 0.05 ? limparAnel(dentro.ext, 0.005) : a;
        const m: Meta = destinos[k] ?? {};
        const ld: LoteDesenhado = { anel: anel.map((p) => paraUtm(pl, p)) };
        if (m.destino) ld.destino = m.destino;
        if (m.numero) ld.numero = m.numero;
        lotes.push(ld);
        if (!maior || ad > areaPol(maior)) maior = { ext: anel, furos: [] };
      });
      if (!lotes.length || !maior) {
        // pedaço que a rua separou sem nenhum lote (a área livre da quadra do operador, do
        // outro lado da rua nova): continua livre (rosa). Sem config ele virava uma quadra
        // automática e o sistema loteava a terra que o operador não definiu como quadra.
        vazios.push(Q.pol);
        continue;
      }
      const base: QuadraCfg = q0.cfg >= 0 && pr0.quadras[q0.cfg] ? { ...pr0.quadras[q0.cfg] } : { ancora: [0, 0], ajustes: [] };
      delete base.estrutura;
      base.ajustes = [];
      base.ancora = paraUtm(pl, pontoInterno(maior));
      // só o maior pedaço guarda o nome da quadra
      if (base.nome && novas.some((c) => c.nome === base.nome)) delete base.nome;
      novas.push({ ...base, lotes });
    }
  }
  // o pedaço vazio vira quadra do operador sem lote (`lotes: []`) — só se nenhum outro
  // pedaço congelado nem quadra que continua no projeto já tem a âncora nele
  const anc = (c: QuadraCfg) => paraPlano(pl, c.ancora);
  const ficam = pr1.quadras.filter((_, i) => !removidas.has(i));
  for (const V of vazios) {
    if ([...novas, ...ficam].some((c) => dentroPol(anc(c), V))) continue;
    novas.push({ ancora: paraUtm(pl, pontoInterno(V)), ajustes: [], lotes: [] });
    vazias++;
  }
  if (!novas.length) return { pr: pr1, cortados, livres, vazias };
  // os lotes congelados vêm dos contornos JÁ normalizados de cada quadra; costura os
  // vértices compartilhados entre os pedaços da mesma quadra (a divisa na rua nova)
  const quadras = pr1.quadras.filter((_, i) => !removidas.has(i)).concat(novas.map((c) => (!c.lotes?.length ? c : {
    ...c, lotes: normalizar(c.lotes!.map((l) => l.anel.map((p) => paraPlano(pl, p)))).map((an, k) => ({ ...c.lotes![k], anel: an.map((p) => paraUtm(pl, p)) })),
  })));
  pr = { ...pr1, quadras };
  return { pr, cortados, livres, vazias };
}

/**
 * Rua traçada pela borda de lotes que já existem (o operador clica os pontos da quina da
 * quadra que ele fez): centrada no traço ela comeria meia largura dos lotes. Se um dos
 * lados do traço não pega lote nenhum, a rua vai inteira para esse lado e a quadra fica
 * como está. Traço que passa por dentro dos lotes (os dois lados pegam lote) ou longe
 * deles fica centrado. Devolve o lado (ou undefined = centrada). `traco` no plano.
 */
export function ladoLivreDaRua(res: Resultado, traco: Pt[], largura: number): "esquerda" | "direita" | undefined {
  if (traco.length < 2 || !(largura > 0)) return undefined;
  const corpo = (lado: "esquerda" | "direita" | undefined) => bufferLinha(eixoDoTraco(traco, lado, largura), largura, "reta");
  const cx = caixa(traco);
  const perto = res.lotes.filter((l) => {
    const b = caixa(l.pol.ext);
    return b.max[0] >= cx.min[0] - largura && b.min[0] <= cx.max[0] + largura && b.max[1] >= cx.min[1] - largura && b.min[1] <= cx.max[1] + largura;
  });
  if (!perto.length) return undefined;
  const come = (lado: "esquerda" | "direita" | undefined) => {
    const c = corpo(lado);
    return perto.reduce((s, l) => s + intersecao([l.pol], c).reduce((a, x) => a + areaPol(x), 0), 0);
  };
  const centro = come(undefined);
  if (centro < 1) return undefined;
  const esq = come("esquerda"), dir = come("direita");
  const [lado, menor, maior] = esq <= dir ? ["esquerda" as const, esq, dir] : ["direita" as const, dir, esq];
  // um lado livre (até 1 m² ou 3% do que a rua centrada comeria) e o outro cheio de lote
  return menor <= Math.max(1, 0.03 * centro) && maior > 4 * Math.max(1, menor) ? lado : undefined;
}

// ---------------------------------------------------------------------------
// Trava de direção no arraste (item 6)
// ---------------------------------------------------------------------------

/** Os dois eixos do lote: ao longo da frente (esquerda/direita) e para o fundo (cima/baixo). */
export function eixosDoLote(l: Lote, q?: Quadra): [Pt, Pt] {
  const fr = l.lados.filter((x) => x.tipo === "rua" || x.tipo === "via");
  const base = fr.length ? fr : l.lados;
  const maior = base.reduce((m, x) => (x.comp > m.comp ? x : m), base[0]);
  const u = maior ? unit(sub(maior.b, maior.a)) : q?.u ?? [1, 0];
  return [u, esquerda(u)];
}

/**
 * Leva o ponto `p` (cursor) para a reta que passa por `de` na direção do eixo do lote
 * mais próxima do movimento: o arraste só anda para cima/baixo ou para os lados.
 */
export function travarNoEixo(de: Pt, p: Pt, eixos: [Pt, Pt]): Pt {
  const d = sub(p, de);
  const [u, v] = eixos;
  const a = dot(d, u), b = dot(d, v);
  return Math.abs(a) >= Math.abs(b) ? soma(de, mult(u, a)) : soma(de, mult(v, b));
}

// ---------------------------------------------------------------------------
// Ângulo dos lotes selecionados (item 8)
// ---------------------------------------------------------------------------

interface Divisa { F: Pt; B: Pt; d: Pt }

/** Pontos comuns (até 2 cm) aos dois anéis — a divisa entre eles, como polilinha ordenada. */
function divisaComum(a: Pt[], b: Pt[]): Pt[] {
  const perto = (p: Pt, anel: Pt[]) => anel.some((q, i) => distSegmento(p, q, anel[(i + 1) % anel.length]).d < 0.02);
  const pts = a.filter((p) => perto(p, b));
  if (pts.length < 2) return pts;
  // os dois mais afastados são as pontas
  let i0 = 0, i1 = 1, dm = -1;
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) { const d = dist(pts[i], pts[j]); if (d > dm) { dm = d; i0 = i; i1 = j; } }
  return [pts[i0], pts[i1]];
}

/**
 * Gira as divisas laterais dos lotes selecionados `graus` em torno do ponto delas na
 * rua: cada lote continua no mesmo lugar da frente e muda só o ângulo. As divisas das
 * pontas do grupo são compartilhadas com os vizinhos de fora, que se ajustam (ganham
 * ou perdem a cunha); a borda da quadra (rua, divisa da gleba) não gira.
 */
export function girarLotes(pr0: Projeto, res: Resultado, q: Quadra, sel: Lote[], graus: number): Edicao | null {
  if (!sel.length || !Number.isFinite(graus) || Math.abs(graus) < 0.01) return null;
  if (Math.abs(graus) > 60) return { pr: pr0, msg: "Gire no máximo 60° para cada lado.", erro: true };
  const { pr, i, aneis, destinos } = contornos(pr0, res, q);
  // posição de cada selecionado no desenho: pelo ponto de dentro
  const k = (l: Lote) => aneis.findIndex((a) => a.length >= 3 && dentroPol(pontoInterno(l.pol), { ext: antiHorario(a), furos: [] }));
  const idxSel = [...new Set(sel.map(k).filter((x) => x >= 0))];
  if (!idxSel.length) return null;
  const naBorda = (p: Pt) => dist(naBordaDaQuadra(q, p), p) < 0.1;
  // as divisas: entre um selecionado e qualquer outro lote da quadra, que tocam a rua numa ponta
  const divisas: (Divisa & { lados: [number, number] })[] = [];
  const vistos = new Set<string>();
  const loteDe = new Map<number, Lote>();
  for (const l of sel) { const x = k(l); if (x >= 0) loteDe.set(x, l); }
  for (const a of idxSel) {
    // direção da frente do lote: a divisa lateral sai dela em ângulo (o trecho da linha
    // de fundo que encosta na rua da cabeceira corre paralelo à frente e não gira)
    const uA = eixosDoLote(loteDe.get(a)!, q)[0];
    for (let b = 0; b < aneis.length; b++) {
      if (b === a || aneis[b].length < 3) continue;
      const chave = [Math.min(a, b), Math.max(a, b)].join("-");
      if (vistos.has(chave)) continue;
      const c = divisaComum(aneis[a], aneis[b]);
      if (c.length < 2 || dist(c[0], c[1]) < 1) continue;
      const [p, r] = c;
      // só divisa lateral: uma ponta na FRENTE do lote (lado de rua) — a outra no fundo
      const frentes = loteDe.get(a)!.lados.filter((x) => x.tipo === "rua" || x.tipo === "via");
      const dFrente = (x: Pt) => (frentes.length ? Math.min(...frentes.map((f) => distSegmento(x, f.a, f.b).d)) : naBorda(x) ? 0 : Infinity);
      const dp = dFrente(p), dr = dFrente(r);
      if (Math.min(dp, dr) > 0.1) continue;
      vistos.add(chave);
      const F = dp <= dr ? p : r, B = dp <= dr ? r : p;
      const d = unit(sub(B, F));
      if (Math.abs(cross(d, uA)) < 0.5) continue;
      divisas.push({ F, B, d, lados: [a, b] });
    }
  }
  if (!divisas.length) return { pr: pr0, msg: "Não achei divisas laterais nesses lotes (a divisa precisa sair da rua). Selecione lotes vizinhos de uma fileira.", erro: true };
  const ang = (graus * Math.PI) / 180;
  const girar = (v: Pt): Pt => [v[0] * Math.cos(ang) - v[1] * Math.sin(ang), v[0] * Math.sin(ang) + v[1] * Math.cos(ang)];
  const mesmo = (p: Pt, r: Pt) => dist(p, r) < 0.02;
  /** reta p + t·d cortando o segmento a–b: o ponto (ou null) */
  const corta = (p: Pt, d: Pt, a: Pt, b: Pt): Pt | null => {
    const e = sub(b, a), den = cross(d, e);
    if (Math.abs(den) < 1e-12) return null;
    const w = sub(a, p);
    const t = cross(w, e) / den, uu = cross(w, d) / den;
    return uu >= -1e-6 && uu <= 1 + 1e-6 ? soma(p, mult(d, t)) : null;
  };
  /**
   * Para onde vai a ponta `X` da divisa quando ela gira em torno de `P`: corre pelos
   * lados que saem de X (e pelo seguinte, se o giro passar de um vértice) — a linha de
   * fundo ou a rua — até a reta girada. Fica a interseção mais perto de X.
   */
  const correr = (X: Pt, P: Pt, dNova: Pt, fora: Pt): Pt | null => {
    const segs: [Pt, Pt][] = [];
    const borda = q.pol.ext;
    const add = (a: Pt, b: Pt) => { if (!segs.some(([x, y]) => (mesmo(x, a) && mesmo(y, b)) || (mesmo(x, b) && mesmo(y, a)))) segs.push([a, b]); };
    for (const an of aneis) {
      const n = an.length;
      for (let j = 0; j < n; j++) {
        if (!mesmo(an[j], X)) continue;
        for (const s of [1, -1]) {
          const v1 = an[(j + s + n) % n], v2 = an[(j + 2 * s + 2 * n) % n];
          if (mesmo(v1, fora)) continue; // a própria divisa
          add(X, v1); add(v1, v2);
        }
      }
    }
    // a ponta na borda da quadra (rua, divisa da gleba) corre pela borda
    for (let j = 0; j < borda.length; j++) { const a = borda[j], b = borda[(j + 1) % borda.length]; if (distSegmento(X, a, b).d < 0.05) add(a, b); }
    let melhor: Pt | null = null, dm = Infinity;
    for (const [a, b] of segs) {
      const x = corta(P, dNova, a, b);
      if (!x || dot(sub(x, P), sub(X, P)) <= 0) continue;
      const d = dist(x, X);
      if (d < dm) { dm = d; melhor = x; }
    }
    return melhor;
  };
  // divisa atravessada (fundo com fundo): a da frente e a de trás chegam na mesma
  // junção, alinhadas. Com os lotes dos dois lados selecionados, ela gira inteira em
  // torno da junção (o fundo com fundo continua alinhado); senão, em torno do pé na rua.
  const movimentos: { de: Pt; para: Pt }[] = [];
  const usadas = new Set<number>();
  // divisa que não tem para onde correr (a do lote de cabeceira, paralela à rua) fica como está
  let paradas = 0;
  for (let x = 0; x < divisas.length; x++) {
    if (usadas.has(x)) continue;
    const dv = divisas[x];
    const par = divisas.findIndex((o, y) => y !== x && !usadas.has(y) && mesmo(o.B, dv.B) && Math.abs(cross(o.d, dv.d)) < 0.2 && dot(o.d, dv.d) < 0);
    if (par >= 0) {
      const ov = divisas[par];
      usadas.add(x); usadas.add(par);
      const J = dv.B;
      const F1 = correr(dv.F, J, girar(mult(dv.d, -1)), J), F2 = correr(ov.F, J, girar(mult(ov.d, -1)), J);
      if (!F1 || !F2) { paradas++; continue; }
      movimentos.push({ de: dv.F, para: F1 }, { de: ov.F, para: F2 });
    } else {
      usadas.add(x);
      const B2 = correr(dv.B, dv.F, girar(dv.d), dv.F);
      if (!B2) { paradas++; continue; }
      movimentos.push({ de: dv.B, para: B2 });
    }
  }
  if (!movimentos.length) return { pr: pr0, msg: "Com esse ângulo nenhuma divisa desses lotes consegue girar (sairia do lote) — tente um giro menor.", erro: true };
  // um ponto, um destino (a junção pedida por duas divisas fica na média)
  const finais: { de: Pt; para: Pt }[] = [];
  for (const m of movimentos) {
    const j = finais.find((f) => mesmo(f.de, m.de));
    if (j) j.para = lerp(j.para, m.para, 0.5); else finais.push({ ...m });
  }
  const novos = aneis.map((an) => an.map((v) => finais.find((f) => mesmo(f.de, v))?.para ?? v));
  // nada pode sumir nem se sobrepor: a soma das áreas fica a mesma e nenhum contorno se cruza
  const areaDe = (an: Pt[]) => Math.abs(areaPol({ ext: an, furos: [] }));
  const antes = aneis.reduce((s, an) => s + areaDe(an), 0), depois = novos.reduce((s, an) => s + areaDe(an), 0);
  const cruzaSi = (an: Pt[]) => an.some((a, j) => an.some((c, k) => {
    if (Math.abs(j - k) <= 1 || (j === 0 && k === an.length - 1) || (k === 0 && j === an.length - 1)) return false;
    const b = an[(j + 1) % an.length], d = an[(k + 1) % an.length];
    const o = (p1: Pt, p2: Pt, p3: Pt) => cross(sub(p2, p1), sub(p3, p1));
    return o(a, b, c) * o(a, b, d) < -1e-9 && o(c, d, a) * o(c, d, b) < -1e-9;
  }));
  if (Math.abs(antes - depois) > 0.05 || novos.some((an, j) => an !== aneis[j] && cruzaSi(an)) || novos.some((an) => an.length >= 3 && areaDe(an) < 1)) {
    return { pr: pr0, msg: "Esse giro faria as divisas se cruzarem ou passarem da próxima quina — tente um ângulo menor.", erro: true };
  }
  const mudados = novos.map((an, j) => an.some((v, t) => !mesmo(v, aneis[j][t]))).map((m, j) => (m ? j : -1)).filter((j) => j >= 0);
  const fora = mudados.filter((x) => !idxSel.includes(x)).length;
  return {
    pr: gravar(pr, res, i, normalizar(novos.map((an) => limparAnel(an, 0.005))), destinos),
    msg: `Divisas de ${idxSel.length} lote${idxSel.length > 1 ? "s" : ""} giradas ${fmt(Math.abs(graus), 1)}° para ${graus > 0 ? "a esquerda (anti-horário)" : "a direita (horário)"}; cada lote ficou no mesmo lugar${fora ? ` e ${fora} vizinho${fora > 1 ? "s" : ""} se ajust${fora > 1 ? "aram" : "ou"}` : ""}${paradas ? `; ${paradas} divisa${paradas > 1 ? "s" : ""} de cabeceira ficou como estava` : ""} (Ctrl+Z desfaz).`,
    sel: { quadra: q.nome, indices: idxSel },
  };
}

// ---------------------------------------------------------------------------
// Gerar quadra (item 9)
// ---------------------------------------------------------------------------

export interface PedidoQuadra {
  /** ponto inicial da frente (plano) */
  a: Pt;
  /** direção da frente (unitário, plano) */
  u: Pt;
  /** comprimento da quadra ao longo da frente (m) */
  comprimento: number;
  /** profundidade total da quadra (m) — com 2 fileiras é o fundo a fundo */
  profundidade: number;
  fileiras: 1 | 2;
  /** lotes por fileira */
  lotes: number;
  /** a quadra fica à esquerda ou à direita da linha desenhada */
  lado: "esquerda" | "direita";
}

/** Os contornos dos lotes da quadra pedida (plano), em ordem: fileira da frente e depois a de trás. */
export function lotesDaQuadra(q: PedidoQuadra): Pt[][] {
  const n = Math.max(1, Math.round(q.lotes));
  const v = q.lado === "esquerda" ? esquerda(q.u) : mult(esquerda(q.u), -1);
  const P = (s: number, t: number): Pt => soma(q.a, soma(mult(q.u, s), mult(v, t)));
  const larg = q.comprimento / n;
  const prof = q.profundidade / q.fileiras;
  const out: Pt[][] = [];
  for (let f = 0; f < q.fileiras; f++) {
    for (let k = 0; k < n; k++) {
      const s0 = k * larg, s1 = (k + 1) * larg, t0 = f * prof, t1 = (f + 1) * prof;
      out.push(antiHorario([P(s0, t0), P(s1, t0), P(s1, t1), P(s0, t1)]));
    }
  }
  return out;
}

/**
 * Desenha a quadra pedida: cada lote entra como um lote desenhado (toma a terra de
 * lotes, área livre e quadras que estiverem embaixo, como a ferramenta Lote).
 */
/**
 * O desenho pedido que fica a poucos metros da borda da quadra embaixo dele encosta
 * nela (a folga é repartida por igual entre os lotes): sem isso, a tira entre o
 * desenho e a rua sobrava dos lotes antigos como lotes picados de 6 quinas.
 */
export function encostarNaQuadra(res: Resultado, pedido: PedidoQuadra, frente: number, profundidade: number): PedidoQuadra {
  const n = Math.max(1, Math.round(pedido.lotes));
  const v = pedido.lado === "esquerda" ? esquerda(pedido.u) : mult(esquerda(pedido.u), -1);
  const P = (s: number, t: number): Pt => soma(pedido.a, soma(mult(pedido.u, s), mult(v, t)));
  const centro = P(pedido.comprimento / 2, pedido.profundidade / 2);
  const q = [...res.quadras, ...(res.quadrasVazias ?? [])].find((x) => dentroPol(centro, x.pol));
  if (!q) return pedido;
  // extensão da quadra nas direções do desenho, medida pelas retas que passam pelo meio do desenho
  const ss = q.pol.ext.map((x) => dot(sub(x, pedido.a), pedido.u));
  const tt = q.pol.ext.map((x) => dot(sub(x, pedido.a), v));
  const qs0 = Math.min(...ss), qs1 = Math.max(...ss), qt0 = Math.min(...tt), qt1 = Math.max(...tt);
  const folgaS = Math.max(4, 0.6 * frente), folgaT = Math.max(3, 0.5 * profundidade);
  let s0 = 0, s1 = pedido.comprimento, t0 = 0, t1 = pedido.profundidade;
  if (qs0 < s0 && s0 - qs0 <= folgaS) s0 = qs0;
  if (qs1 > s1 && qs1 - s1 <= folgaS) s1 = qs1;
  if (qt0 < t0 && t0 - qt0 <= folgaT) t0 = qt0;
  if (qt1 > t1 && qt1 - t1 <= folgaT * pedido.fileiras) t1 = qt1;
  if (s0 === 0 && s1 === pedido.comprimento && t0 === 0 && t1 === pedido.profundidade) return pedido;
  void n;
  return { ...pedido, a: P(s0, t0), comprimento: s1 - s0, profundidade: t1 - t0 };
}

function limparSobrasDoDesenho(pr0: Projeto, res0: Resultado, aneis: Pt[][], calc: Calc, nominal: number): { pr: Projeto; n: number } | null {
  const p = pr0.params;
  const perim = (pg: Poligono) => pg.ext.reduce((s2, q, i) => s2 + dist(q, pg.ext[(i + 1) % pg.ext.length]), 0);
  const contato = (a: Poligono, b: Poligono) => { const u = uniaoFechada([a, b]); return u.length === 1 && !u[0].furos.length ? (perim(a) + perim(b) - perim(u[0])) / 2 : 0; };
  const gerados = aneis.map((an) => ({ ext: antiHorario(an), furos: [] as Pt[][] }));
  const ehGerado = (l: Lote) => gerados.some((g) => dentroPol(pontoInterno(l.pol), g));
  let pr = pr0, res = res0, n = 0;
  const chave = (l: Lote) => pontoInterno(l.pol).map((x) => x.toFixed(1)).join(",");
  const pulados = new Set<string>();
  const juntados = new Set<string>();
  for (let guarda = 0; guarda < 40; guarda++) {
    // ruim: pequeno, torto, raso demais ou sem frente — o lote gerado que caiu na cunha
    // da ponta da quadra, ou a tira que sobrou do lote antigo
    // (o tamanho que o operador PEDIU manda: lote gerado abaixo do mínimo do projeto é escolha
    // dele — só o pedaço bem menor que o pedido, a cunha torta ou sem frente é que junta)
    const ehRuim = (l: Lote) => !juntados.has(chave(l)) && (quinasAviso(l.pol.ext) > 4 || !(l.frente > 0.5)
      || (ehGerado(l) ? l.area < 0.6 * nominal : l.area < Math.min(p.areaMin - 0.5, 0.6 * nominal) || l.area < 0.4 * nominal));
    const ruim = res.lotes.find((l) => ehRuim(l) && !pulados.has(chave(l))
      && (ehGerado(l) || res.lotes.some((g) => g.quadra === l.quadra && ehGerado(g) && contato(g.pol, l.pol) >= 1)));
    if (!ruim) break;
    const q = res.quadras.find((x) => x.nome === ruim.quadra);
    if (!q) break;
    // o vizinho que recebe: gerado primeiro (o desenho do operador é a régua), o mais encostado
    const viz = res.lotes.filter((g) => g.quadra === ruim.quadra && g !== ruim)
      .map((g) => ({ g, c: contato(g.pol, ruim.pol) })).filter((x) => x.c >= 1)
      .map((x) => ({ ...x, u: uniaoFechada([x.g.pol, ruim.pol])[0] }))
      .filter((x) => x.u && quinasAviso(limparAnel(x.u.ext, 0.005)) <= 4)
      .sort((a, b) => Number(ehGerado(b.g)) - Number(ehGerado(a.g)) || b.c - a.c);
    let feito = false;
    for (const { g } of viz) {
      const ed = unirLotes(pr, res, q, [posicaoNoDesenho(pr, res, g), posicaoNoDesenho(pr, res, ruim)]);
      const r2 = ed && !ed.erro ? calc(ed.pr) : null;
      if (!ed || !r2 || r2.lotes.length !== res.lotes.length - 1) continue;
      pr = ed.pr; res = r2; n++; feito = true;
      // o lote que recebeu não recebe de novo (sem cascata)
      const novo = r2.lotes.find((x) => dentroPol(pontoInterno(g.pol), x.pol));
      if (novo) juntados.add(chave(novo));
      break;
    }
    if (!feito) {
      // sem vizinho que fique com 4 quinas: a sobra pequena vira área livre (o operador decide)
      const ed = ruim.area < p.areaMin - 0.5 ? apagarLotes(pr, res, q, [posicaoNoDesenho(pr, res, ruim)]) : null;
      const r2 = ed && !ed.erro ? calc(ed.pr) : null;
      if (!ed || !r2) { pulados.add(chave(ruim)); continue; }
      pr = ed.pr; res = r2; n++;
    }
  }
  return n ? { pr, n } : null;
}

export function gerarQuadra(pr0: Projeto, res0: Resultado, pedido0: PedidoQuadra, calc: Calc): Edicao | null {
  const pedido = encostarNaQuadra(res0, pedido0, pr0.params.frente, pr0.params.profundidade);
  const aneis = lotesDaQuadra(pedido);
  let pr = pr0, res: Resultado | null = res0;
  let feitos = 0, areaTotal = 0;
  let selQuadra: string | undefined;
  for (const an of aneis) {
    if (!res) break;
    const ed = desenharLote(pr, res, an);
    if (!ed || ed.erro) continue;
    pr = ed.pr;
    feitos++;
    areaTotal += Math.abs(areaPol({ ext: an, furos: [] }));
    selQuadra = ed.sel?.quadra ?? selQuadra;
    res = calc(pr);
  }
  if (!feitos) return { pr: pr0, msg: "A quadra caiu toda em rua, área pública ou fora da gleba — escolha outro lugar.", erro: true };
  // sobra dos lotes antigos encostada no desenho (tira entre ele e a rua, pedaço do
  // lote cortado ao meio): pequena ou torta, entra no lote gerado vizinho
  const nominal = (pedido.comprimento / Math.max(1, Math.round(pedido.lotes))) * (pedido.profundidade / pedido.fileiras);
  const juntadas = res ? limparSobrasDoDesenho(pr, res, aneis, calc, nominal) : null;
  if (juntadas) { pr = juntadas.pr; }
  const ped = aneis.length;
  return {
    pr,
    msg: `Quadra gerada: ${feitos} lote${feitos > 1 ? "s" : ""} de ${fmt(pedido.comprimento / Math.max(1, Math.round(pedido.lotes)))} × ${fmt(pedido.profundidade / pedido.fileiras)} m (${fmt(areaTotal / feitos)} m² cada)${feitos < ped ? ` — ${ped - feitos} caíram fora da terra loteável` : ""}. Os lotes que estavam embaixo cederam a terra (Ctrl+Z desfaz).`,
    sel: selQuadra ? { quadra: selQuadra, indices: [] } : undefined,
  };
}

// ---------------------------------------------------------------------------
// Pontos de referência (item 4)
// ---------------------------------------------------------------------------

export function adicionarReferencia(pr: Projeto, pUtm: Pt): { pr: Projeto; ref: PontoReferencia } {
  const refs = pr.referencias ?? [];
  // o menor número livre (apagar o P1 e marcar outro devolve o P1)
  let n = 1;
  while (refs.some((r) => r.nome === `P${n}`)) n++;
  const ref: PontoReferencia = { id: novoId("p"), nome: `P${n}`, p: pUtm };
  return { pr: { ...pr, referencias: [...refs, ref] }, ref };
}

export const removerReferencia = (pr: Projeto, id: string): Projeto => ({ ...pr, referencias: (pr.referencias ?? []).filter((r) => r.id !== id) });

/** Ponto a `d` metros de `de`, na direção de `para` (a distância digitada na ferramenta). */
export function pontoNaDistancia(de: Pt, para: Pt, d: number): Pt | null {
  const L = dist(de, para);
  if (!(L > 1e-6) || !(d > 0)) return null;
  return lerp(de, para, d / L);
}

/** A área livre (rosa) ou quadra embaixo do ponto ficou sem lote? (para a mensagem do gerar quadra) */
export function terraLivreEm(res: Resultado, p: Pt): boolean {
  return res.sobras.some((s) => dentroPol(p, s)) || diferenca([{ ext: [p, soma(p, [0.01, 0]), soma(p, [0, 0.01])], furos: [] }], res.lotes.map((l) => l.pol)).length > 0;
}
