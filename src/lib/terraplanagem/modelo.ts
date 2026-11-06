// O projeto de terraplanagem como é gravado (tabela terraplanagens, migração
// 0046, e cópia no aparelho): os pontos do levantamento e as escolhas do
// usuário. Volumes, mapa e seções são recalculados a cada abertura — o projeto
// guarda a intenção, nunca o resultado (não há número velho para desconfiar).
import type { Pt } from "./geometria.ts";
import type { PontoCota } from "./pontos.ts";

export type { Pt } from "./geometria.ts";
export type { PontoCota } from "./pontos.ts";

export type ModoPlataforma = "contorno" | "retangulo" | "poligono";
export type ModoCota = "equilibrio" | "fixa";

export interface Retangulo {
  centro: Pt;
  largura: number;
  comprimento: number;
  /** azimute do comprimento, graus (0 = norte, horário) */
  giro: number;
}

export interface ProjetoTerraplanagem {
  versao: 1;
  id: string;
  nome: string;
  criadoEm: string;
  atualizadoEm: string;
  /** de onde vieram os pontos */
  fonte: { tipo: "arquivo"; arquivo: string } | { tipo: "relevo"; descricao: string };
  /** fuso UTM dos pontos (null = não informado; só é preciso para KML e para levar a área a um serviço) */
  fuso: number | null;
  pontos: PontoCota[];
  plataforma: {
    modo: ModoPlataforma;
    /** contorno: quanto a plataforma fica para dentro da borda dos pontos (null = automático, cabe o talude) */
    folga: number | null;
    retangulo: Retangulo | null;
    /** polígono (KML ou relevo público), UTM, anel aberto */
    poligono: Pt[] | null;
    nomePoligono?: string | null;
  };
  cota: {
    modo: ModoCota;
    /** cota no centro da plataforma, quando digitada */
    valor: number | null;
    /** inclinação para escoar água, % (0 = plana) */
    inclinacao: number;
    /** azimute para onde a água escorre (graus) */
    direcao: number;
  };
  /** taludes: metros na horizontal para cada 1 m na vertical (1:1 corte, 1:1,5 aterro) */
  taludes: { corte: number; aterro: number };
  fatores: {
    /** empolamento do material solto, % (25 = 1 m³ cortado vira 1,25 m³ no caminhão) */
    empolamento: number;
    /** caçamba do caminhão, m³ */
    caminhao: number;
    /** 1 m³ de aterro compactado pede quantos m³ de corte (1 = sem perda) */
    compactacao: number;
  };
  /** seções: centro e azimute da longitudinal (null = automático, pelo meio da plataforma) */
  secao: { centro: Pt | null; giro: number | null };
}

export const PADRAO_TALUDES = { corte: 1, aterro: 1.5 };
export const PADRAO_FATORES = { empolamento: 25, caminhao: 12, compactacao: 1 };

export function novoId(): string {
  try { return crypto.randomUUID(); } catch { /* sem crypto */ }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function projetoNovo(nome: string, pontos: PontoCota[], fonte: ProjetoTerraplanagem["fonte"], fuso: number | null = null, agora = new Date()): ProjetoTerraplanagem {
  const t = agora.toISOString();
  return {
    versao: 1, id: novoId(), nome: nome || "Terraplanagem", criadoEm: t, atualizadoEm: t,
    fonte, fuso, pontos,
    plataforma: { modo: "contorno", folga: null, retangulo: null, poligono: null, nomePoligono: null },
    cota: { modo: "equilibrio", valor: null, inclinacao: 0, direcao: 180 },
    taludes: { ...PADRAO_TALUDES },
    fatores: { ...PADRAO_FATORES },
    secao: { centro: null, giro: null },
  };
}

const num = (v: unknown, padrao: number, min = -Infinity, max = Infinity): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : padrao;
};
const ponto = (v: unknown): Pt | null => (Array.isArray(v) && v.length >= 2 && Number.isFinite(Number(v[0])) && Number.isFinite(Number(v[1])) ? [Number(v[0]), Number(v[1])] : null);

/** Lê um projeto gravado (de qualquer versão ou meio quebrado) sem derrubar a tela. */
export function normalizarProjeto(bruto: unknown): ProjetoTerraplanagem | null {
  if (!bruto || typeof bruto !== "object") return null;
  const b = bruto as Partial<ProjetoTerraplanagem> & Record<string, unknown>;
  const pontos = Array.isArray(b.pontos)
    ? b.pontos.map((p) => {
        // gravado compacto: [nome, e, n, z]
        if (Array.isArray(p)) return { nome: String(p[0] ?? ""), e: Number(p[1]), n: Number(p[2]), z: Number(p[3]) };
        const q = p as PontoCota;
        return { nome: String(q.nome ?? ""), e: Number(q.e), n: Number(q.n), z: Number(q.z), ...(q.descricao ? { descricao: String(q.descricao) } : {}) };
      }).filter((p) => Number.isFinite(p.e) && Number.isFinite(p.n) && Number.isFinite(p.z))
    : [];
  const base = projetoNovo(String(b.nome ?? "Terraplanagem"), pontos, b.fonte && typeof b.fonte === "object" ? b.fonte as ProjetoTerraplanagem["fonte"] : { tipo: "arquivo", arquivo: "" });
  const pl = (b.plataforma ?? {}) as Partial<ProjetoTerraplanagem["plataforma"]>;
  const r = pl.retangulo as Partial<Retangulo> | null | undefined;
  const ret = r && ponto(r.centro) ? { centro: ponto(r.centro)!, largura: num(r.largura, 20, 0.5), comprimento: num(r.comprimento, 30, 0.5), giro: num(r.giro, 0) } : null;
  const poli = Array.isArray(pl.poligono) ? pl.poligono.map(ponto).filter((p): p is Pt => !!p) : null;
  const modo: ModoPlataforma = pl.modo === "retangulo" && ret ? "retangulo" : pl.modo === "poligono" && poli && poli.length >= 3 ? "poligono" : "contorno";
  const c = (b.cota ?? {}) as Partial<ProjetoTerraplanagem["cota"]>;
  const t = (b.taludes ?? {}) as Partial<ProjetoTerraplanagem["taludes"]>;
  const f = (b.fatores ?? {}) as Partial<ProjetoTerraplanagem["fatores"]>;
  const s = (b.secao ?? {}) as Partial<ProjetoTerraplanagem["secao"]>;
  return {
    ...base,
    id: typeof b.id === "string" && b.id ? b.id : base.id,
    criadoEm: typeof b.criadoEm === "string" ? b.criadoEm : base.criadoEm,
    atualizadoEm: typeof b.atualizadoEm === "string" ? b.atualizadoEm : base.atualizadoEm,
    fuso: b.fuso == null ? null : num(b.fuso, 24, 18, 25),
    plataforma: {
      modo, folga: pl.folga == null ? null : num(pl.folga, 0, 0, 1000),
      retangulo: ret, poligono: poli && poli.length >= 3 ? poli : null, nomePoligono: pl.nomePoligono ?? null,
    },
    cota: {
      modo: c.modo === "fixa" && Number.isFinite(Number(c.valor)) ? "fixa" : "equilibrio",
      valor: c.valor == null || !Number.isFinite(Number(c.valor)) ? null : Number(c.valor),
      inclinacao: num(c.inclinacao, 0, 0, 30),
      direcao: num(c.direcao, 180),
    },
    taludes: { corte: num(t.corte, PADRAO_TALUDES.corte, 0, 20), aterro: num(t.aterro, PADRAO_TALUDES.aterro, 0, 20) },
    fatores: {
      empolamento: num(f.empolamento, PADRAO_FATORES.empolamento, 0, 200),
      caminhao: num(f.caminhao, PADRAO_FATORES.caminhao, 1, 100),
      compactacao: num(f.compactacao, PADRAO_FATORES.compactacao, 0.5, 2),
    },
    secao: { centro: ponto(s.centro), giro: s.giro == null ? null : num(s.giro, 0) },
  };
}

/** Pontos compactos para gravar ([nome, e, n, z] com 3 casas). */
export function paraGravar(p: ProjetoTerraplanagem): Record<string, unknown> {
  return {
    ...p,
    pontos: p.pontos.map((q) => [q.nome, Math.round(q.e * 1000) / 1000, Math.round(q.n * 1000) / 1000, Math.round(q.z * 1000) / 1000]),
  };
}
