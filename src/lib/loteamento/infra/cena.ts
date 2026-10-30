// As redes na maquete 3D — só os dados (sem three.js, testável em node): onde
// fica cada poste, fio, hidrante, tampa de PV, boca de lobo, o reservatório e a
// estação, já com a cota do terreno projetado (o greide das ruas da maquete).
import type { Pt } from "../geom.ts";
import { esquerda, pontoNaPolilinha, unit, sub } from "../geom.ts";
import type { Grade3D, Poste } from "../cena3d.ts";
import { cotaFinal } from "../cena3d.ts";
import type { ResultadoInfra } from "./index.ts";

/** Fio entre dois pontos: altura sobre o chão em cada ponta e a flecha no meio. */
export interface Fio { a: Pt; b: Pt; ha: number; hb: number; za: number; zb: number; flecha: number; tipo: "mt" | "bt" | "ramal" }

export interface Infra3D {
  fios: Fio[];
  hidrantes: { p: Pt; z: number }[];
  tampas: { p: Pt; z: number; tipo: "esgoto" | "drenagem" }[];
  bocas: { p: Pt; z: number; dir: Pt }[];
  reservatorio: { p: Pt; z: number; altura: number; raio: number; lamina: number; elevado: boolean } | null;
  estacao: { p: Pt; z: number; tipo: "ete" | "ee" } | null;
}

/** Altura da luminária no poste (m) e do cabo de baixa tensão. */
export const alturaLuminaria = (alturaPoste: number) => (alturaPoste >= 12 ? 9 : alturaPoste >= 9 ? 7.5 : 6.9);
export const alturaBT = (alturaPoste: number) => (alturaPoste >= 12 ? 8.2 : 7.0);
export const alturaMT = (alturaPoste: number) => alturaPoste - 0.45;

/** Os postes do projeto elétrico no formato da maquete. */
export function postesDoProjeto(r: ResultadoInfra): Poste[] {
  return r.eletrica.postes.map((p) => ({
    p: p.p, z: 0, dir: p.dir, altura: p.altura, mt: p.mt,
    trafo: p.trafo !== null ? r.eletrica.trafos[p.trafo].kva : undefined, id: p.id,
  }));
}

export function infra3d(r: ResultadoInfra, g: Grade3D): Infra3D {
  const z = (p: Pt) => cotaFinal(g, p);
  const e = r.eletrica;
  const fios: Fio[] = [];
  for (const v of e.vaos) {
    const A = e.postes[v.a], B = e.postes[v.b];
    const za = z(A.p), zb = z(B.p);
    const flecha = Math.max(0.15, 0.012 * v.L);
    if (v.mt) {
      // rede compacta: três fases no braço, lado a lado
      const u = unit(sub(B.p, A.p)), n = esquerda(u);
      for (const k of [-0.28, 0, 0.28]) {
        const a: Pt = [A.p[0] + n[0] * k, A.p[1] + n[1] * k], b: Pt = [B.p[0] + n[0] * k, B.p[1] + n[1] * k];
        fios.push({ a, b, ha: alturaMT(A.altura), hb: alturaMT(B.altura), za, zb, flecha, tipo: "mt" });
      }
    }
    if (v.bt) fios.push({ a: A.p, b: B.p, ha: alturaBT(A.altura), hb: alturaBT(B.altura), za, zb, flecha: flecha * 1.3, tipo: "bt" });
  }
  // ramais: do poste até o padrão de entrada na frente do lote
  for (const rm of e.ramais) {
    const P = e.postes[rm.poste];
    fios.push({ a: rm.de, b: rm.ate, ha: alturaBT(P.altura) - 0.3, hb: 3.2, za: z(rm.de), zb: z(rm.ate), flecha: Math.max(0.1, 0.02 * rm.L), tipo: "ramal" });
  }
  // hidrante: na calçada, logo depois da esquina
  const hidrantes = r.agua.hidrantes.map((h) => {
    const no = r.grafo.nos[h.no];
    const ar = r.grafo.arestas[no.arestas[0]];
    const linha = ar.a === no.id ? ar.linha : ar.linha.slice().reverse();
    const { pt, dir } = pontoNaPolilinha(linha, Math.min(ar.L / 2, ar.largura / 2 + 3));
    const nrm = esquerda(dir), off = Math.max(1.5, ar.largura / 2 - 0.6);
    const p: Pt = [pt[0] + nrm[0] * off, pt[1] + nrm[1] * off];
    return { p, z: z(p) };
  });
  const tampas = [
    ...r.esgoto.pvs.map((pv) => ({ p: pv.p, z: z(pv.p), tipo: "esgoto" as const })),
    ...r.drenagem.pvs.map((pv) => ({ p: pv.p, z: z(pv.p), tipo: "drenagem" as const })),
  ];
  const bocas = r.drenagem.bocas.map((b) => ({ p: b.p, z: z(b.p), dir: b.dir }));
  const rs = r.agua.reservatorio;
  // volume útil numa lâmina de 4 m (elevado) ou 3,5 m (apoiado)
  const lamina = rs?.tipo === "elevado" ? 4 : 3.5;
  const reservatorio = rs ? { p: rs.p, z: z(rs.p), altura: rs.altura, raio: Math.max(1.6, Math.sqrt(rs.volume / (Math.PI * lamina))), lamina, elevado: rs.tipo === "elevado" } : null;
  // estação de tratamento ou elevatória (ligação direta na rede pública não tem prédio)
  const sd = r.esgoto.saida;
  const tipoEstacao = !sd ? null : r.esgoto.elevatoria ? "ee" as const : sd.destino === "ete" ? "ete" as const : null;
  const estacao = sd && tipoEstacao ? { p: sd.p, z: z(sd.p), tipo: tipoEstacao } : null;
  return { fios, hidrantes, tampas, bocas, reservatorio, estacao };
}
