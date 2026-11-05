// Leitor de DXF ASCII (R12 a 2018) do loteamento pronto. Lê a seção ENTITIES:
//   • LWPOLYLINE e POLYLINE + VERTEX (com os arcos do "bulge" em cordas curtas),
//     LINE e ARC — polilinha fechada é polígono (lote, quadra, área);
//   • TEXT, MTEXT e os atributos de bloco (ATTRIB) — número do lote, nome da
//     quadra e da rua.
// O que fica dentro de blocos (INSERT sem atributo), hachura e spline não é
// lido: vira só contagem para o aviso. Coordenadas como estão no arquivo (o
// chamador confere se são UTM da gleba).
//
// Sem dependência: o mesmo código roda no navegador e nos testes do node.
import type { Pt } from "../geom.ts";

export interface PolilinhaDxf { camada: string; pts: Pt[]; fechada: boolean }
export interface TextoDxf {
  camada: string;
  texto: string;
  /** centro aproximado do texto (é ele que diz em que lote o texto está) */
  p: Pt;
  altura: number;
  /** rotação em graus (anti-horário) */
  rot: number;
}
export interface DesenhoDxf {
  polilinhas: PolilinhaDxf[];
  textos: TextoDxf[];
  /** entidades que não foram lidas, por tipo (HATCH, SPLINE, INSERT…) */
  ignorados: Record<string, number>;
}

/** Corda máxima do arco: 2° (a área do lote de esquina fica a menos de 1 dm² da do CAD). */
const PASSO_ARCO = (2 * Math.PI) / 180;

/** Pontos do arco de `a` a `b` com o "bulge" do DXF (tan(θ/4); positivo = anti-horário), sem `a`, com `b`. */
export function arcoDoBulge(a: Pt, b: Pt, bulge: number): Pt[] {
  if (!Number.isFinite(bulge) || Math.abs(bulge) < 1e-9) return [b];
  const theta = 4 * Math.atan(bulge);
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const c = Math.hypot(dx, dy);
  if (c < 1e-9) return [b];
  // centro: à esquerda da corda no arco anti-horário (θ > 0) — distância (c/2)/tan(θ/2)
  const h = c / 2 / Math.tan(theta / 2);
  const m: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const n: Pt = [-dy / c, dx / c];
  const cen: Pt = [m[0] + n[0] * h, m[1] + n[1] * h];
  const r = Math.hypot(a[0] - cen[0], a[1] - cen[1]);
  const a0 = Math.atan2(a[1] - cen[1], a[0] - cen[0]);
  const passos = Math.max(2, Math.ceil(Math.abs(theta) / PASSO_ARCO));
  const out: Pt[] = [];
  for (let k = 1; k < passos; k++) {
    const ang = a0 + (theta * k) / passos;
    out.push([cen[0] + r * Math.cos(ang), cen[1] + r * Math.sin(ang)]);
  }
  out.push(b);
  return out;
}

/** Texto do DXF sem códigos: %%d → °, \U+00C1 → Á, e o MTEXT sem formatação (\P vira quebra de linha). */
export function limparTextoDxf(s: string, mtext = false): string {
  let t = s.replace(/\\U\+([0-9A-Fa-f]{4})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/%%[dD]/g, "°").replace(/%%[pP]/g, "±").replace(/%%[cC]/g, "Ø").replace(/%%[uUoOkK]/g, "").replace(/%%%/g, "%");
  if (mtext) {
    t = t.replace(/\\[Pp]/g, "\n")
      .replace(/\\S([^;]*?)[\^#/]([^;]*?);/g, "$1/$2")
      .replace(/\\[ACFHQTWfhcqtwap][^;\\]*;/g, "")
      .replace(/\\[LlOoKkNn]/g, "")
      .replace(/\\~/g, " ")
      .replace(/\\\\/g, "\\")
      .replace(/[{}]/g, "");
  }
  return t.replace(/[ \t]+/g, " ").split("\n").map((x) => x.trim()).filter(Boolean).join("\n");
}

interface Grupo { c: number; v: string }

/**
 * Centro aproximado do texto: o ponto de inserção do DXF é o canto (TEXT
 * alinhado à esquerda, MTEXT pelo "attachment"), e num lote estreito o canto
 * pode cair no vizinho. Largura estimada em 0,6 × altura por caractere.
 */
function centroDoTexto(base: Pt, texto: string, altura: number, rot: number, alinH: number, alinV: number): Pt {
  const linhas = texto.split("\n");
  const largura = 0.6 * altura * Math.max(...linhas.map((l) => l.length), 1);
  const alturaTot = altura * (1 + 1.4 * (linhas.length - 1));
  // deslocamento do ponto de base até o centro, no referencial do texto
  const dx = alinH === 0 ? largura / 2 : alinH === 2 ? -largura / 2 : 0;
  const dy = alinV === 3 ? -alturaTot / 2 : alinV === 1 ? alturaTot / 2 : alinV === 0 ? altura / 2 : 0;
  const a = (rot * Math.PI) / 180;
  return [base[0] + dx * Math.cos(a) - dy * Math.sin(a), base[1] + dx * Math.sin(a) + dy * Math.cos(a)];
}

export function lerDxf(conteudo: string): DesenhoDxf {
  if (/^AutoCAD Binary DXF/.test(conteudo.slice(0, 30))) {
    throw new Error("Este DXF é binário. No CAD, salve como DXF ASCII (texto) e importe de novo.");
  }
  const linhas = conteudo.split(/\r\n|\r|\n/);
  const grupos: Grupo[] = [];
  for (let i = 0; i + 1 < linhas.length; i += 2) {
    const c = parseInt(linhas[i].trim(), 10);
    if (!Number.isFinite(c)) { i -= 1; continue; } // linha solta (arquivo editado à mão): ressincroniza
    grupos.push({ c, v: linhas[i + 1] });
  }
  // só a seção ENTITIES
  const entidades: Grupo[][] = [];
  let dentro = false, atual: Grupo[] | null = null;
  for (let i = 0; i < grupos.length; i++) {
    const g = grupos[i];
    if (g.c === 0 && g.v.trim() === "SECTION") {
      const nome = grupos[i + 1]?.c === 2 ? grupos[i + 1].v.trim() : "";
      dentro = nome === "ENTITIES";
      if (atual) { entidades.push(atual); atual = null; }
      continue;
    }
    if (g.c === 0 && g.v.trim() === "ENDSEC") { if (atual) entidades.push(atual); atual = null; dentro = false; continue; }
    if (!dentro) continue;
    if (g.c === 0) { if (atual) entidades.push(atual); atual = [g]; continue; }
    if (atual) atual.push(g);
  }
  if (atual) entidades.push(atual);
  if (!entidades.length && !grupos.some((g) => g.c === 0 && g.v.trim() === "SECTION")) {
    throw new Error("O arquivo não parece um DXF (não achei as seções do desenho).");
  }

  const out: DesenhoDxf = { polilinhas: [], textos: [], ignorados: {} };
  const ignorar = (t: string) => { out.ignorados[t] = (out.ignorados[t] ?? 0) + 1; };
  const num = (gs: Grupo[], c: number, padrao = 0) => { const g = gs.find((x) => x.c === c); const n = g ? Number(g.v.trim()) : NaN; return Number.isFinite(n) ? n : padrao; };
  const str = (gs: Grupo[], c: number) => gs.find((x) => x.c === c)?.v ?? "";
  const camada = (gs: Grupo[]) => str(gs, 8).trim() || "0";
  // extrusão (0,0,−1): a entidade 2D foi espelhada no CAD — o X do sistema dela é o −X do mundo
  const espelho = (gs: Grupo[]) => num(gs, 230, 1) < 0;
  const fecharSeIgual = (pts: Pt[], fechada: boolean): { pts: Pt[]; fechada: boolean } => {
    if (pts.length > 2 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 1e-6) return { pts: pts.slice(0, -1), fechada: true };
    return { pts, fechada };
  };
  /** vértices com bulge → polilinha densificada */
  const montar = (vs: { p: Pt; bulge: number }[], fechada: boolean): Pt[] => {
    if (!vs.length) return [];
    const pts: Pt[] = [vs[0].p];
    const n = vs.length;
    for (let i = 0; i < (fechada ? n : n - 1); i++) {
      const a = vs[i], b = vs[(i + 1) % n];
      const arco = arcoDoBulge(a.p, b.p, a.bulge);
      if (fechada && i === n - 1) arco.pop(); // o último ponto é o primeiro
      pts.push(...arco);
    }
    return pts;
  };
  const textoDe = (gs: Grupo[], tipo: "TEXT" | "ATTRIB" | "MTEXT") => {
    const bruto = tipo === "MTEXT" ? [...gs.filter((g) => g.c === 3).map((g) => g.v), str(gs, 1)].join("") : str(gs, 1);
    const texto = limparTextoDxf(bruto, tipo === "MTEXT");
    if (!texto) return;
    const altura = num(gs, 40, 1) || 1;
    let rot = num(gs, 50, 0);
    let base: Pt = [num(gs, 10), num(gs, 20)];
    let alinH = 0, alinV = 0;
    if (tipo === "MTEXT") {
      // direção pelo vetor do eixo X (11/21), quando vier
      const vx = num(gs, 11, NaN), vy = num(gs, 21, NaN);
      if (Number.isFinite(vx) && Number.isFinite(vy) && Math.hypot(vx, vy) > 1e-9) rot = (Math.atan2(vy, vx) * 180) / Math.PI;
      const at = num(gs, 71, 1); // 1..9: cima/meio/baixo × esquerda/centro/direita
      alinH = (at - 1) % 3; // 0 esquerda, 1 centro, 2 direita
      alinV = 3 - Math.floor((at - 1) / 3); // 3 cima, 2 meio, 1 baixo
    } else {
      alinH = num(gs, 72, 0);
      alinV = num(gs, tipo === "ATTRIB" ? 74 : 73, 0);
      const p11: Pt = [num(gs, 11, base[0]), num(gs, 21, base[1])];
      // "aligned"/"fit": o texto vai do ponto 10 ao 11 (o meio é a média); "middle": o 11 é o centro
      if (alinH === 3 || alinH === 5) { base = [(base[0] + p11[0]) / 2, (base[1] + p11[1]) / 2]; alinH = 1; alinV = 0; }
      else if (alinH === 4) { base = p11; alinH = 1; alinV = 2; }
      else if (alinH || alinV) base = p11;
      if (espelho(gs)) { base = [-base[0], base[1]]; rot = 180 - rot; }
    }
    if (!Number.isFinite(base[0]) || !Number.isFinite(base[1])) return;
    out.textos.push({ camada: camada(gs), texto, p: centroDoTexto(base, texto, altura, rot, alinH, alinV), altura, rot });
  };

  for (let i = 0; i < entidades.length; i++) {
    const gs = entidades[i];
    const tipo = gs[0].v.trim();
    switch (tipo) {
      case "LWPOLYLINE": {
        const vs: { p: Pt; bulge: number }[] = [];
        for (const g of gs) {
          if (g.c === 10) vs.push({ p: [Number(g.v.trim()), NaN], bulge: 0 });
          else if (g.c === 20 && vs.length) vs[vs.length - 1].p[1] = Number(g.v.trim());
          else if (g.c === 42 && vs.length) vs[vs.length - 1].bulge = Number(g.v.trim()) || 0;
        }
        const ok = vs.filter((x) => Number.isFinite(x.p[0]) && Number.isFinite(x.p[1]));
        if (espelho(gs)) for (const x of ok) { x.p[0] = -x.p[0]; x.bulge = -x.bulge; }
        const fechada0 = (num(gs, 70) & 1) === 1;
        const r = fecharSeIgual(montar(ok, fechada0), fechada0);
        if (r.pts.length >= 2) out.polilinhas.push({ camada: camada(gs), ...r });
        break;
      }
      case "POLYLINE": {
        const flag = num(gs, 70);
        const vs: { p: Pt; bulge: number }[] = [];
        let j = i + 1;
        for (; j < entidades.length; j++) {
          const v = entidades[j];
          const t = v[0].v.trim();
          if (t === "SEQEND") break;
          if (t !== "VERTEX") { j--; break; }
          const vf = num(v, 70);
          if (vf & 16) continue; // ponto de controle de spline
          vs.push({ p: [num(v, 10, NaN), num(v, 20, NaN)], bulge: num(v, 42, 0) });
        }
        i = j;
        if (flag & (16 | 64)) { ignorar("POLYLINE 3D (malha)"); break; }
        const ok = vs.filter((x) => Number.isFinite(x.p[0]) && Number.isFinite(x.p[1]));
        if (espelho(gs)) for (const x of ok) { x.p[0] = -x.p[0]; x.bulge = -x.bulge; }
        const fechada0 = (flag & 1) === 1;
        const r = fecharSeIgual(montar(ok, fechada0), fechada0);
        if (r.pts.length >= 2) out.polilinhas.push({ camada: camada(gs), ...r });
        break;
      }
      case "LINE": {
        const a: Pt = [num(gs, 10, NaN), num(gs, 20, NaN)], b: Pt = [num(gs, 11, NaN), num(gs, 21, NaN)];
        if ([...a, ...b].every(Number.isFinite) && Math.hypot(b[0] - a[0], b[1] - a[1]) > 1e-6) out.polilinhas.push({ camada: camada(gs), pts: [a, b], fechada: false });
        break;
      }
      case "ARC": {
        const c: Pt = [num(gs, 10, NaN), num(gs, 20, NaN)], r = num(gs, 40, 0);
        let a0 = (num(gs, 50) * Math.PI) / 180, a1 = (num(gs, 51) * Math.PI) / 180;
        if (!c.every(Number.isFinite) || !(r > 0)) break;
        while (a1 <= a0) a1 += 2 * Math.PI;
        const passos = Math.max(2, Math.ceil((a1 - a0) / PASSO_ARCO));
        const pts: Pt[] = [];
        for (let k = 0; k <= passos; k++) { const ang = a0 + ((a1 - a0) * k) / passos; pts.push([c[0] + r * Math.cos(ang), c[1] + r * Math.sin(ang)]); }
        if (espelho(gs)) for (const p of pts) p[0] = -p[0];
        out.polilinhas.push({ camada: camada(gs), pts, fechada: false });
        break;
      }
      case "TEXT": textoDe(gs, "TEXT"); break;
      case "MTEXT": textoDe(gs, "MTEXT"); break;
      case "ATTRIB": textoDe(gs, "ATTRIB"); break;
      case "INSERT": {
        // bloco com atributos: os ATTRIB vêm em seguida (até o SEQEND); o desenho do bloco não é lido
        if (num(gs, 66) !== 1) ignorar("INSERT (bloco)");
        break;
      }
      case "SEQEND": case "VERTEX": case "ATTDEF": case "POINT": case "VIEWPORT": break;
      default: ignorar(tipo);
    }
  }
  return out;
}
