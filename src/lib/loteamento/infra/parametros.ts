// Parâmetros dos projetos de infraestrutura do loteamento (água, esgoto,
// drenagem, energia e iluminação pública).
//
// Os padrões vêm da pesquisa de 30/10/2026 (docs/infraestrutura.md), com a fonte
// de cada número. ABNT é paga: onde a norma só aparece citada por manual de
// concessionária, o manual é a fonte. A Embasa não publica manual de projeto —
// per capita, ocupação por lote e a tensão da Coelba vêm da carta de viabilidade
// de cada empreendimento, por isso tudo aqui é editável e fica no projeto.
import type { Pt } from "../geom.ts";

export type TensaoBT = "220/127" | "380/220";
/** padrão de consumo da unidade (Neoenergia DIS-NOR-012, Tab. 16/17) */
export type PadraoLote = "A" | "B" | "C";

export interface ParametrosInfra {
  // ---------------- água (NBR 12218:2017) ----------------
  /** ocupação por lote (DAE Bauru 2.2; Sanepar MPHS 5.2.1 j) */
  habPorLote: number;
  /** consumo per capita, L/hab.dia (Sanepar: 100 popular, 150 médio, 250 alto) */
  perCapita: number;
  /** coeficiente do dia de maior consumo */
  k1: number;
  /** coeficiente da hora de maior consumo */
  k2: number;
  /** Hazen-Williams: PVC 140, PEAD 155 (DAE Jundiaí item 5) */
  cHW: number;
  /** perda de carga máxima nos tubos, m/km (NBR 12218:2017: 10; Sanepar: 7) */
  perdaMax: number;
  /** pressão dinâmica mínima, mca (NBR 12218:2017: 10) */
  pressaoMin: number;
  /** pressão estática máxima, mca (NBR 12218:2017: 40; até 50 em topografia acidentada) */
  pressaoMax: number;
  /** hidrantes de coluna (raio de atendimento, m; 0 = sem hidrantes) — RS RT 16 e GO NT 34: 300 m */
  raioHidrante: number;
  // ---------------- esgoto (NBR 9649) ----------------
  /** coeficiente de retorno água → esgoto */
  retorno: number;
  /** infiltração, L/s.km (Saneago: 0,05 em rede de PVC) */
  infiltracao: number;
  /** diâmetro mínimo da rede coletora (NBR 9649: 100; Sanepar/Bauru/SAMAE: 150) */
  dnMinEsgoto: number;
  /** recobrimento mínimo no leito da rua, m (NBR 9649 5.2.8: 0,90) */
  recobrimentoEsgoto: number;
  /** distância máxima entre PVs, m (Saneago e Bauru: 80) */
  distPv: number;
  /** destino do esgoto: estação de tratamento própria ou ligação na rede pública */
  destinoEsgoto: "ete" | "rede";
  // ---------------- drenagem (método racional) ----------------
  /** período de retorno da microdrenagem, anos (usual 2 a 10) */
  periodoRetorno: number;
  /** equação de chuva i = {[(a ln T + b) ln(t + δ/60)] + c ln T + d}/t (t em h, i em mm/h) */
  idf: { nome: string; a: number; b: number; c: number; d: number; delta: number };
  /** tempo de concentração inicial, min (Jundiaí 4.1.1.2: 10) */
  tcInicial: number;
  // ---------------- energia (Neoenergia DIS-NOR-012 rev. 08) ----------------
  tensaoBT: TensaoBT;
  padraoLote: PadraoLote;
  /** vão básico entre postes, m (6.6.31.9: 35, entre 30 e 40) */
  vao: number;
  /** queda de tensão máxima no circuito novo, % (6.8.5.5: 3,5) */
  quedaMax: number;
  // ---------------- iluminação pública (NBR 5101) ----------------
  /** classe da via local: V5 (5 lux, tráfego leve) ou V4 (10 lux) */
  classeIP: "V5" | "V4";
  // ---------------- pontos escolhidos pelo operador (UTM); sem = automático ----------------
  reservatorio?: Pt;
  lancamento?: Pt;
  entradaEnergia?: Pt;
}

/**
 * Equação de chuva de Salvador (SGB/CPRM, Furtunato et al. 2015, estação Ondina;
 * de 5 min a 1 h). Conferida: T = 10 anos e t = 10 min dão 120,3 mm/h, como a
 * tabela do relatório.
 */
export const IDF_SALVADOR = { nome: "Salvador/BA (SGB/CPRM 2015)", a: 7.5823, b: 24.201, c: 9.9834, d: 31.9, delta: 16 };

export const INFRA_PADRAO: ParametrosInfra = {
  habPorLote: 5,
  perCapita: 150,
  k1: 1.2,
  k2: 1.5,
  cHW: 140,
  perdaMax: 10,
  pressaoMin: 10,
  pressaoMax: 40,
  raioHidrante: 300,
  retorno: 0.8,
  infiltracao: 0.05,
  dnMinEsgoto: 150,
  recobrimentoEsgoto: 0.9,
  distPv: 80,
  destinoEsgoto: "ete",
  periodoRetorno: 10,
  idf: IDF_SALVADOR,
  tcInicial: 10,
  tensaoBT: "220/127",
  padraoLote: "B",
  vao: 35,
  quedaMax: 3.5,
  classeIP: "V5",
};

/** Parâmetros do projeto salvo, completando o que faltar (projeto antigo não tem). */
export function infraDe(p: Partial<ParametrosInfra> | null | undefined): ParametrosInfra {
  const q: ParametrosInfra = { ...INFRA_PADRAO, ...(p ?? {}) };
  const num = (k: keyof ParametrosInfra, min: number, max: number) => {
    const v = Number(q[k]);
    (q as unknown as Record<string, unknown>)[k] = Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : INFRA_PADRAO[k];
  };
  num("habPorLote", 1, 20); num("perCapita", 50, 400); num("k1", 1, 2); num("k2", 1, 3); num("cHW", 80, 160);
  num("perdaMax", 2, 30); num("pressaoMin", 5, 30); num("pressaoMax", 20, 80); num("raioHidrante", 0, 1000);
  num("retorno", 0.5, 1); num("infiltracao", 0, 2); num("dnMinEsgoto", 100, 200); num("recobrimentoEsgoto", 0.5, 2);
  num("distPv", 30, 120); num("periodoRetorno", 1, 100); num("tcInicial", 5, 30); num("vao", 25, 45); num("quedaMax", 1, 8);
  if (!q.idf || !Number.isFinite(q.idf.a)) q.idf = IDF_SALVADOR;
  if (q.tensaoBT !== "380/220") q.tensaoBT = "220/127";
  if (!["A", "B", "C"].includes(q.padraoLote)) q.padraoLote = "B";
  if (q.classeIP !== "V4") q.classeIP = "V5";
  if (q.destinoEsgoto !== "rede") q.destinoEsgoto = "ete";
  return q;
}

/** Intensidade de chuva (mm/h) para o período de retorno T (anos) e a duração t (min). */
export function intensidade(idf: ParametrosInfra["idf"], T: number, tMin: number): number {
  const t = Math.max(5, tMin) / 60;
  const lnT = Math.log(Math.max(1.01, T));
  return ((idf.a * lnT + idf.b) * Math.log(t + idf.delta / 60) + idf.c * lnT + idf.d) / t;
}
