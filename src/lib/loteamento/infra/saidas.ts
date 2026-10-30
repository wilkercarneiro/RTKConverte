// O que sai dos projetos de infraestrutura além das pranchas: planilhas de
// dimensionamento trecho a trecho (colunas dos modelos DAE Bauru e Saneago 9.2),
// quantitativos para o orçamento, o memorial descritivo e de cálculo, o DXF
// em camadas e os pontos de locação (PV, poste, hidrante) para a coletora.
import JSZip from "jszip";
import type { Pt } from "../geom.ts";
import { dist } from "../geom.ts";
import type { Resultado } from "../calculo.ts";
import type { Projeto } from "../modelo.ts";
import { paraUtm } from "../plano.ts";
import type { SecaoDocx } from "../docx.ts";
import type { PontoLocacao } from "../saidas.ts";
import type { ResultadoInfra } from "./index.ts";
import { PROJECAO, demandaPorUnidade } from "./eletrica.ts";
import { intensidade } from "./parametros.ts";

const f = (v: number, c = 2) => (Number.isFinite(v) ? v.toLocaleString("pt-BR", { minimumFractionDigits: c, maximumFractionDigits: c }) : "—");
const cel = (c: string) => (/[;"\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c);
const csv = (linhas: string[][]) => "﻿" + linhas.map((l) => l.map(cel).join(";")).join("\r\n") + "\r\n";
const somaExt = (o: Record<number, number>) => Object.values(o).reduce((a, b) => a + b, 0);

// ---------------------------------------------------------------------------
// Planilhas
// ---------------------------------------------------------------------------

export function planilhaAgua(r: ResultadoInfra): string {
  const a = r.agua;
  const no = new Map(a.nos.map((n) => [n.no, n]));
  const cab = ["Trecho", "Rua", "Nó montante", "Nó jusante", "Extensão (m)", "Lotes", "Vazão (L/s)", "DN", "Rede", "Velocidade (m/s)", "Perda unitária (m/km)", "Perda (m)",
    "Cota terreno mont. (m)", "Cota terreno jus. (m)", "Cota piezométrica mont. (m)", "Cota piezométrica jus. (m)", "Pressão mont. (mca)", "Pressão jus. (mca)"];
  const linhas = a.tubos.map((t) => {
    // montante = de onde a água vem (maior carga)
    const [m, j] = t.q >= 0 ? [t.de, t.para] : [t.para, t.de];
    const nm = no.get(m), nj = no.get(j);
    const rua = t.aresta >= 0 ? r.grafo.arestas[t.aresta].nome : "Adutora do reservatório";
    return [t.id, rua, m === r.grafo.nos.length ? "R" : `N${m + 1}`, j === r.grafo.nos.length ? "R" : `N${j + 1}`, f(t.L), String(t.lotes), f(Math.abs(t.q), 3), String(t.dn),
      t.dupla ? "dupla" : "simples", f(t.v), f(t.j), f(t.hf, 3), nm ? f(nm.z) : f(a.reservatorio?.z ?? 0), nj ? f(nj.z) : "—",
      nm ? f(nm.carga) : f(a.reservatorio?.na ?? 0), nj ? f(nj.carga) : "—", nm ? f(nm.pDin) : "—", nj ? f(nj.pDin) : "—"];
  });
  return csv([cab, ...linhas]);
}

export function planilhaEsgoto(r: ResultadoInfra): string {
  const e = r.esgoto;
  const cab = ["Trecho", "PV montante", "PV jusante", "Extensão (m)", "Lotes", "Contribuição (L/s)", "Qi jusante (L/s)", "Qf jusante (L/s)", "DN", "Declividade (m/m)",
    "Cota terreno mont. (m)", "Cota terreno jus. (m)", "Cota coletor mont. (m)", "Cota coletor jus. (m)", "Profundidade mont. (m)", "Profundidade jus. (m)",
    "Lâmina y/D", "Velocidade final (m/s)", "Tensão trativa (Pa)", "Degrau no PV (m)"];
  const linhas = e.trechos.map((t) => {
    const a = e.pvs[t.de], b = e.pvs[t.para];
    return [t.id, a.id, b.id, f(t.L), String(t.lotes), f(t.contrib, 3), f(t.qi, 3), f(t.qf, 3), String(t.dn), t.I.toFixed(4).replace(".", ","),
      f(a.z), f(b.z), f(t.fMont, 3), f(t.fJus, 3), f(a.z - t.fMont), f(b.z - t.fJus), f(t.lamina), f(t.v), f(t.tensao), a.queda >= 0.5 ? f(a.queda) : ""];
  });
  return csv([cab, ...linhas]);
}

export function planilhaDrenagem(r: ResultadoInfra): string {
  const d = r.drenagem;
  const cab = ["Trecho", "PV montante", "PV jusante", "Extensão (m)", "Σ C·A (m²)", "Tc (min)", "i (mm/h)", "Vazão (L/s)", "Diâmetro (mm)", "Declividade (m/m)",
    "Cota terreno mont. (m)", "Cota terreno jus. (m)", "Cota galeria mont. (m)", "Cota galeria jus. (m)", "Profundidade mont. (m)", "Lâmina y/D", "Velocidade (m/s)"];
  const linhas = d.trechos.map((t) => {
    const a = d.pvs[t.de], b = d.pvs[t.para];
    return [t.id, a.id, b.id, f(t.L), f(t.ca, 0), f(t.tc, 1), f(t.i, 1), f(t.q, 1), String(t.dn), t.I.toFixed(4).replace(".", ","), f(a.z), f(b.z), f(t.fMont, 3), f(t.fJus, 3), f(a.z - t.fMont), f(t.lamina), f(t.v)];
  });
  const bocas = d.bocas.map((b) => [b.id, f(b.q, 1)]);
  return csv([cab, ...linhas, [], ["Boca de lobo", "Vazão captada (L/s)"], ...bocas]);
}

export function planilhaEletrica(res: Resultado, r: ResultadoInfra): string {
  const e = r.eletrica;
  const linhas: string[][] = [
    ["Transformador", "Poste", "Potência (kVA)", "Demanda (kVA)", "Carregamento (%)", "Lotes", "Circuitos", "Alcance do circuito (m)", "Queda máxima (%)"],
    ...e.trafos.map((t) => [t.id, e.postes[t.poste].id, f(t.kva, 1), f(t.demanda, 1), f((100 * t.demanda) / t.kva, 0), String(t.lotes), String(t.circuitos), f(t.alcance, 0), f(t.queda)]),
    [],
    ["Poste", "E (UTM)", "N (UTM)", "Altura (m)", "Esforço (daN)", "Média tensão", "Transformador", "Luminária (W)", "Equipamentos"],
    ...e.postes.map((p) => {
      const u = paraUtm(res.plano, p.p);
      return [p.id, u[0].toFixed(3).replace(".", ","), u[1].toFixed(3).replace(".", ","), String(p.altura), String(p.esforco), p.mt ? "sim" : "não",
        p.trafo !== null ? e.trafos[p.trafo].id : "", String(p.luminaria), p.equipamentos.join(" | ")];
    }),
  ];
  return csv(linhas);
}

export interface ItemQuantitativo { rede: string; item: string; un: string; qtd: number }

/** Lista de materiais para o orçamento (condutores com 4% de sobra — DIS-NOR-012 6.8.3.2). */
export function quantitativos(r: ResultadoInfra): ItemQuantitativo[] {
  const out: ItemQuantitativo[] = [];
  const add = (rede: string, item: string, un: string, qtd: number) => { if (qtd > 0) out.push({ rede, item, un, qtd }); };
  const a = r.agua;
  for (const [dn, L] of Object.entries(a.resumo.extensao).sort((x, y) => +x[0] - +y[0])) add("Água", `Tubo PVC ${+dn >= 150 ? "DEFoFo" : "PBA classe 15"} DN ${dn}`, "m", L);
  add("Água", "Registro de gaveta (manobra)", "un", a.registros.length);
  add("Água", "Descarga", "un", a.descargas.length);
  add("Água", "Ventosa de tríplice função", "un", a.ventosas.length);
  add("Água", "Hidrante de coluna DN 100", "un", a.hidrantes.length);
  add("Água", "Válvula redutora de pressão", "un", a.vrps.length);
  add("Água", "Ligação predial (ramal PEAD DE 20 + hidrômetro)", "un", a.ligacoes.length);
  if (a.reservatorio) add("Água", `Reservatório ${a.reservatorio.tipo} ${a.reservatorio.volume} m³${a.reservatorio.tipo === "elevado" ? ` (torre de ${a.reservatorio.altura} m)` : ""}`, "un", 1);
  const e = r.esgoto;
  for (const [dn, L] of Object.entries(e.resumo.extensao).sort((x, y) => +x[0] - +y[0])) add("Esgoto", `Tubo PVC coletor de esgoto DN ${dn}`, "m", L);
  const faixa = (p: number) => (p <= 1.5 ? "até 1,50 m" : p <= 2.5 ? "de 1,50 a 2,50 m" : p <= 4 ? "de 2,50 a 4,00 m" : "acima de 4,00 m");
  const porFaixa = new Map<string, number>();
  for (const pv of e.pvs) if (pv.tipo === "PV") porFaixa.set(faixa(pv.prof), (porFaixa.get(faixa(pv.prof)) ?? 0) + 1);
  for (const [fx, n] of porFaixa) add("Esgoto", `Poço de visita (PV) — profundidade ${fx}`, "un", n);
  add("Esgoto", "Terminal de inspeção e limpeza (TIL)", "un", e.resumo.nTil);
  add("Esgoto", "Tubo de queda", "un", e.resumo.quedas);
  add("Esgoto", "Ligação predial (ramal DN 100 + TIL no passeio)", "un", e.ligacoes.length);
  if (e.elevatoria) { add("Esgoto", "Estação elevatória de esgoto", "un", 1); add("Esgoto", "Linha de recalque (PEAD)", "m", e.elevatoria.L); }
  else if (e.saida?.destino === "ete") add("Esgoto", "Estação de tratamento de esgoto compacta", "un", 1);
  const d = r.drenagem;
  for (const [dn, L] of Object.entries(d.resumo.extensao).sort((x, y) => +x[0] - +y[0])) add("Drenagem", `Tubo de concreto armado Ø${dn}`, "m", L);
  const ramalBl = d.ramais.reduce((s, x) => s + dist(x.de, x.ate), 0);
  add("Drenagem", "Ramal de boca de lobo Ø400", "m", ramalBl);
  add("Drenagem", "Boca de lobo simples (grelha + guia chapéu)", "un", d.bocas.length);
  add("Drenagem", "Poço de visita de drenagem", "un", d.pvs.length);
  if (d.trechos.length) add("Drenagem", "Dissipador de energia no lançamento", "un", 1);
  const el = r.eletrica;
  const tipos = new Map<string, number>();
  for (const p of el.postes) tipos.set(`${p.altura}/${p.esforco}`, (tipos.get(`${p.altura}/${p.esforco}`) ?? 0) + 1);
  for (const [t, n] of [...tipos].sort()) add("Energia", `Poste de concreto duplo T ${t} daN`, "un", n);
  for (const kva of [45, 75, 112.5]) add("Energia", `Transformador trifásico ${kva.toLocaleString("pt-BR")} kVA`, "un", el.trafos.filter((t) => t.kva === kva).length);
  add("Energia", "Cabo coberto compacto 15 kV 3 × 50 mm² + mensageiro (+4%)", "m", el.resumo.extensaoMT * 1.04);
  const bt = (c: string) => el.vaos.filter((v) => v.bt && v.cabo === c).reduce((s, v) => s + v.L, 0) * 1.04;
  add("Energia", "Cabo multiplexado Al 3 × 1 × 70 + 70 mm² (+4%)", "m", bt("3x1x70+70"));
  add("Energia", "Cabo multiplexado Al 3 × 1 × 120 + 70 mm² (+4%)", "m", bt("3x1x120+70"));
  add("Energia", "Chave fusível 15 kV", "un", el.postes.reduce((s, p) => s + p.equipamentos.filter((x) => x === "Chave fusível").length, 0));
  add("Energia", "Para-raios 12 kV", "un", el.postes.reduce((s, p) => s + p.equipamentos.filter((x) => x === "Para-raios").length, 0));
  add("Energia", "Aterramento (3 hastes 13 × 2.400 mm)", "un", el.postes.filter((p) => p.equipamentos.some((x) => x.startsWith("Aterramento"))).length);
  add("Energia", "Ramal de ligação (vão poste → padrão de entrada)", "m", el.ramais.reduce((s, x) => s + x.L, 0) * 1.04);
  add("Iluminação", `Luminária LED ${el.ip.potencia} W com braço`, "un", el.ip.quantidade);
  add("Iluminação", "Relé fotoelétrico", "un", el.ip.quantidade);
  return out;
}

export function planilhaQuantitativos(r: ResultadoInfra): string {
  return csv([["Rede", "Item", "Unidade", "Quantidade"], ...quantitativos(r).map((q) => [q.rede, q.item, q.un, f(q.qtd, q.un === "un" ? 0 : 2)])]);
}

export async function zipPlanilhas(res: Resultado, r: ResultadoInfra, base: string): Promise<Blob> {
  const zip = new JSZip();
  zip.file(`${base}_AGUA_DIMENSIONAMENTO.csv`, planilhaAgua(r));
  zip.file(`${base}_ESGOTO_DIMENSIONAMENTO.csv`, planilhaEsgoto(r));
  zip.file(`${base}_DRENAGEM_DIMENSIONAMENTO.csv`, planilhaDrenagem(r));
  zip.file(`${base}_ENERGIA_TRAFOS_E_POSTES.csv`, planilhaEletrica(res, r));
  zip.file(`${base}_QUANTITATIVOS.csv`, planilhaQuantitativos(r));
  return zip.generateAsync({ type: "blob" });
}

// ---------------------------------------------------------------------------
// Memorial descritivo e de cálculo
// ---------------------------------------------------------------------------

export function memorialInfra(res: Resultado, pr: Projeto, r: ResultadoInfra, d: { municipio: string; uf: string; rt: string; rtRegistro: string; trt: string }): SecaoDocx[] {
  const p = r.params, a = r.agua, e = r.esgoto, dr = r.drenagem, el = r.eletrica;
  const loc = [d.municipio, d.uf].filter(Boolean).join("/");
  const rs = a.reservatorio;
  const tabelaExt = (o: Record<number, number>, rot: (dn: string) => string) => [["Diâmetro", "Extensão (m)"], ...Object.entries(o).sort((x, y) => +x[0] - +y[0]).map(([dn, L]) => [rot(dn), f(L)]), ["Total", f(somaExt(o))]];
  const i10 = intensidade(p.idf, p.periodoRetorno, p.tcInicial);
  const nl = r.lotes;
  return [
    {
      titulo: "MEMORIAL DESCRITIVO E DE CÁLCULO DOS PROJETOS DE INFRAESTRUTURA",
      subtitulo: `${pr.nome.toUpperCase()}${loc ? ` — ${loc}` : ""}`,
      paragrafos: [
        `1. OBJETO. Projetos de abastecimento de água, esgotamento sanitário, drenagem pluvial, distribuição de energia elétrica e iluminação pública do loteamento ${pr.nome}, com ${res.lotes.length} lotes em ${res.quadras.length} quadras e ${res.ruas.length} vias, atendendo à infraestrutura básica do art. 2º, §5º, da Lei Federal 6.766/79.`,
        `2. POPULAÇÃO DE PROJETO. ${nl} lotes atendidos × ${p.habPorLote} habitantes por lote = ${r.populacao.toLocaleString("pt-BR")} habitantes (ocupação de saturação, sem etapas).`,
        `3. BASE TOPOGRÁFICA. ${r.grafo.temRelevo ? "Cotas do terreno do modelo digital de elevação calibrado pelo levantamento GNSS do perímetro" : "Sem relevo disponível: terreno considerado plano (as declividades mínimas governam)"}. Coordenadas no SIRGAS 2000, projeção UTM, as mesmas da planta do loteamento.`,
        "Os valores adotados são editáveis no sistema e devem ser conferidos com as diretrizes da concessionária de água e esgoto, da distribuidora de energia, do Corpo de Bombeiros e da prefeitura para o empreendimento.",
      ],
    },
    {
      titulo: "4. SISTEMA DE ABASTECIMENTO DE ÁGUA",
      paragrafos: [
        `4.1 Critérios (ABNT NBR 12218:2017). Consumo per capita de ${p.perCapita} L/hab.dia; K1 = ${f(p.k1, 2)} (dia de maior consumo) e K2 = ${f(p.k2, 2)} (hora de maior consumo); perda de carga pela fórmula de Hazen-Williams com C = ${p.cHW}; perda de carga unitária máxima de ${f(p.perdaMax, 1)} m/km; pressão dinâmica mínima de ${p.pressaoMin} mca e estática máxima de ${p.pressaoMax} mca; diâmetro mínimo DN 50.`,
        `4.2 Vazões. Média Q = P·q/86.400 = ${f(a.resumo.qMedia, 3)} L/s; dia de maior consumo ${f(a.resumo.qDia, 3)} L/s; hora de maior consumo (vazão de dimensionamento da rede) ${f(a.resumo.qHora, 3)} L/s, distribuída pelas ruas na proporção dos lotes que dão frente para cada uma.`,
        `4.3 Rede. Malhada onde as vias fecham quadra, resolvida pelo método do gradiente global (Todini-Pilati, o mesmo do EPANET) — ${a.resumo.iteracoes} iterações, ${a.resumo.convergiu ? "convergência atingida" : "convergência parcial"}. Tubos de PVC no passeio, a 0,70 m do alinhamento predial: rede simples no passeio mais baixo e dupla nas vias com 15 m ou mais entre alinhamentos. Recobrimento mínimo de 0,70 m no passeio e 1,00 m sob a via. Pressões dinâmicas entre ${f(a.resumo.pMin, 1)} e ${f(a.resumo.pMax, 1)} mca; estática máxima de ${f(a.resumo.pEstMax, 1)} mca.`,
        rs ? `4.4 Reservação. Volume útil de ${rs.volume} m³ (1/3 do consumo do dia de maior consumo, ${f((r.populacao * p.perCapita * p.k1) / 1000, 1)} m³/dia — NBR 12217). Reservatório ${rs.tipo}${rs.area ? ` na ${rs.area}` : ""}, na cota ${f(rs.z, 2)} m, com nível mínimo de água na cota ${f(rs.na, 2)} m${rs.tipo === "elevado" ? ` (fuste de ${rs.altura} m)` : ""}, fixado pelo ponto crítico da rede (N${rs.critico + 1}) para manter a pressão dinâmica mínima.` : "4.4 Reservação: não dimensionada (sem rede).",
        `4.5 Acessórios. ${a.registros.length} registros de manobra nas derivações; ${a.descargas.length} descargas nos pontos baixos e pontas secas; ${a.ventosas.length} ventosas nos pontos altos; ${a.hidrantes.length} hidrante(s) de coluna DN 100 (raio de atendimento de ${p.raioHidrante} m, rede DN 100 no caminho até eles — confirmar a exigência do Corpo de Bombeiros); ${a.vrps.length} válvula(s) redutora(s) de pressão; ${a.ligacoes.length} ligações prediais em PEAD DE 20 pela frente dos lotes.`,
      ],
      tabela: tabelaExt(a.resumo.extensao, (dn) => `DN ${dn}`),
    },
    {
      titulo: "5. SISTEMA DE ESGOTAMENTO SANITÁRIO",
      paragrafos: [
        `5.1 Critérios (ABNT NBR 9649). Coeficiente de retorno C = ${f(p.retorno, 2)}; taxa de infiltração de ${f(p.infiltracao, 2)} L/s.km; vazão mínima de 1,5 L/s por trecho; vazões Qi = K2·Qm + Qinf e Qf = K1·K2·Qm + Qinf; declividade mínima I = 0,0055·Qi^-0,47 (tensão trativa ≥ 1,0 Pa, n = 0,013), nunca abaixo de 0,5%; declividade máxima I = 4,65·Qf^-0,67 (velocidade ≤ 5 m/s); lâmina máxima y/D = 0,75 (0,50 quando a velocidade passa da crítica); diâmetro mínimo DN ${p.dnMinEsgoto}; recobrimento mínimo de ${f(p.recobrimentoEsgoto, 2)} m no leito; PV a cada ${p.distPv} m no máximo e em toda junção; tubo de queda a partir de 0,50 m de degrau.`,
        `5.2 Vazões. Média de ${f(e.resumo.qMedia, 3)} L/s; vazão final no lançamento ${f(e.resumo.qFinal, 3)} L/s.`,
        `5.3 Rede. Coletor de PVC no eixo das vias, por gravidade, acompanhando o terreno com o recobrimento mínimo onde a declividade da rua permite. ${e.resumo.nPv} poços de visita e ${e.resumo.nTil} terminais de inspeção e limpeza; profundidade média de ${f(e.resumo.profMedia)} m e máxima de ${f(e.resumo.profMax)} m${e.resumo.quedas ? `; ${e.resumo.quedas} tubo(s) de queda` : ""}. Ligações prediais em DN 100 com TIL no passeio (${e.ligacoes.length}).`,
        e.elevatoria
          ? `5.4 Destino. O ponto baixo da rede fica ${f(e.elevatoria.altura, 1)} m abaixo da ligação na rede pública: estação elevatória junto ao ${e.saida ? e.pvs[e.saida.pv].id : "ponto baixo"} e ${f(e.elevatoria.L, 0)} m de linha de recalque até a rede pública na estrada de acesso.`
          : e.saida?.destino === "ete"
            ? `5.4 Destino. Estação de tratamento de esgoto compacta junto ao ${e.pvs[e.saida.pv].id}, no ponto mais baixo da rede, sujeita a licença ambiental e outorga de lançamento do efluente tratado.`
            : `5.4 Destino. Ligação na rede pública no ${e.saida ? e.pvs[e.saida.pv].id : "ponto de lançamento"} — confirmar a cota do PV de chegada com a concessionária.`,
      ],
      tabela: tabelaExt(e.resumo.extensao, (dn) => `DN ${dn}`),
    },
    {
      titulo: "6. SISTEMA DE DRENAGEM PLUVIAL",
      paragrafos: [
        `6.1 Critérios. Método racional (Q = C·i·A); chuva pela equação ${p.idf.nome} — i = {[(a·ln T + b)·ln(t + δ/60)] + c·ln T + d}/t, com a = ${p.idf.a}, b = ${p.idf.b}, c = ${p.idf.c}, d = ${p.idf.d}, δ = ${p.idf.delta}; período de retorno de ${p.periodoRetorno} anos; tempo de concentração inicial de ${p.tcInicial} min (i = ${f(i10, 1)} mm/h). Coeficiente de escoamento pelo tamanho do lote (0,90 abaixo de 200 m², 0,80 de 200 a 500, 0,70 de 500 a 1.000, 0,60 acima), 0,90 nas vias e 0,25 nas áreas verdes. Área drenada de ${f(dr.resumo.areaDrenada / 1e4, 2)} ha, C médio ${f(dr.resumo.cMedio, 2)}.`,
        `6.2 Sarjetas e bocas de lobo. Capacidade da sarjeta pela fórmula de Izzard com faixa alagada de até 2,0 m sobre a pista (declividade transversal de 3%, n = 0,016). Bocas de lobo onde a sarjeta esgota, a montante dos cruzamentos com sarjeta carregada e nos pontos baixos: ${dr.bocas.length} unidades.`,
        `6.3 Galerias. Tubos de concreto (n = 0,013), diâmetro mínimo Ø400, lâmina até 0,85 do diâmetro, velocidades entre 0,75 e 6,0 m/s, recobrimento mínimo de 1,0 m e poços de visita a cada 60 m no máximo (${dr.pvs.length} PVs). Lançamento ${dr.lancamento?.rio ? "no curso d'água" : "no ponto mais baixo da divisa"} com ${f(dr.resumo.qLancamento / 1000, 3)} m³/s, com dissipador de energia${dr.lancamento?.rio ? " e outorga de lançamento" : ""}.`,
      ],
      tabela: tabelaExt(dr.resumo.extensao, (dn) => `Ø${dn}`),
    },
    {
      titulo: "7. REDE DE DISTRIBUIÇÃO DE ENERGIA ELÉTRICA",
      paragrafos: [
        `7.1 Critérios (Neoenergia DIS-NOR-012 rev. 08; REN ANEEL 1.000/2021). Média tensão em rede compacta (obrigatória em loteamento) e baixa tensão multiplexada em ${p.tensaoBT} V. Demanda diversificada da Tab. 17 para unidade tipo ${p.padraoLote} (${f(demandaPorUnidade(p.padraoLote, 1), 2)} kVA até 5 unidades, ${f(demandaPorUnidade(p.padraoLote, 41), 2)} kVA acima de 40, interpolada entre as faixas) × ${f(PROJECAO, 2)} de projeção (Tab. 18), mais a iluminação pública com fator 1. Transformadores de 45, 75 e 112,5 kVA (limites da Tab. 19), circuitos de baixa tensão até ${p.tensaoBT === "380/220" ? 500 : 200} m e queda de tensão até ${f(p.quedaMax, 1)}%.`,
        `7.2 Rede. ${el.resumo.nPostes} postes de concreto duplo T nos passeios, nas divisas de lotes, com vão básico de ${p.vao} m, em um lado só nas vias de até 20 m (o lado com mais lotes, ou as faces norte e oeste), afastados das esquinas. ${f(el.resumo.extensaoMT, 0)} m de média tensão desde a derivação da rede da distribuidora (${el.entrada ? el.postes[el.entrada.poste].id : "—"}) até os transformadores e ${f(el.resumo.extensaoBT, 0)} m de baixa tensão. Demanda total de ${f(el.resumo.demanda, 1)} kVA (${f(el.resumo.porLote, 2)} kVA por lote), ${el.trafos.length} transformadores somando ${f(el.resumo.kvaInstalado, 1)} kVA; queda de tensão máxima de ${f(el.resumo.quedaMax)}%. Chave fusível e para-raios em cada transformador; aterramento com resistência máxima de 20 Ω.`,
        "7.3 Ligações. Ramal de conexão pela frente de cada lote, sem cruzar terreno de terceiros, com vão de até 40 m (DIS-NOR-030).",
      ],
      tabela: [["Transformador", "Poste", "kVA", "Demanda (kVA)", "Lotes", "Queda (%)"], ...el.trafos.map((t) => [t.id, el.postes[t.poste].id, f(t.kva, 1), f(t.demanda, 1), String(t.lotes), f(t.queda)])],
    },
    {
      titulo: "8. ILUMINAÇÃO PÚBLICA",
      paragrafos: [
        `Vias locais classe ${el.ip.classe} da ABNT NBR 5101 (iluminância média mínima de ${el.ip.alvo} lux, uniformidade 0,2). Uma luminária LED de ${el.ip.potencia} W (${el.ip.fluxo.toLocaleString("pt-BR")} lm) em cada poste da rede de distribuição, arranjo unilateral, com relé fotoelétrico. Iluminância média estimada pelo método dos lúmens (coeficiente de utilização 0,40, fator de manutenção 0,80): ${f(el.ip.eMedia, 1)} lux. Carga de ${f(el.ip.kva, 2)} kVA somada aos transformadores. A rede de iluminação não é incorporada pela distribuidora (REN 1.000/2021, art. 490): o consumo fica com a prefeitura (ofício) ou com o loteador.`,
      ],
    },
    {
      titulo: "9. QUANTITATIVOS",
      paragrafos: ["Quantidades geradas a partir do traçado (condutores com 4% de sobra). Base para o orçamento e o cronograma de obras do art. 18, V, da Lei 6.766/79."],
      tabela: [["Rede", "Item", "Un.", "Quantidade"], ...quantitativos(r).map((q) => [q.rede, q.item, q.un, f(q.qtd, q.un === "un" ? 0 : 2)])],
    },
    {
      titulo: "10. OBSERVAÇÕES E RESPONSABILIDADE TÉCNICA",
      paragrafos: [
        ...[...a.avisos, ...e.avisos, ...dr.avisos, ...el.avisos].map((t) => `• ${t}`),
        "Estudo gerado pelo sistema a partir do traçado do loteamento, para aprovação e orçamento. O projeto executivo deve confirmar as cotas por levantamento planialtimétrico e seguir as diretrizes de cada concessionária.",
        `${d.rt || "Responsável técnico"}${d.rtRegistro ? ` — ${d.rtRegistro}` : ""}${d.trt ? ` — ART/TRT ${d.trt}` : ""}.`,
        `${loc ? `${loc}, ` : ""}${new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" })}.`,
      ],
    },
  ];
}

// ---------------------------------------------------------------------------
// DXF das redes (R12, em camadas, UTM)
// ---------------------------------------------------------------------------

const CAMADAS_DXF: [string, number][] = [
  ["LOTE", 8], ["AGUA_REDE", 5], ["AGUA_ACESSORIOS", 5], ["AGUA_TEXTO", 5], ["ESGOTO_REDE", 34], ["ESGOTO_PV", 34], ["ESGOTO_TEXTO", 34],
  ["DRENAGEM_GALERIA", 4], ["DRENAGEM_BL", 4], ["DRENAGEM_TEXTO", 4], ["ENERGIA_MT", 1], ["ENERGIA_BT", 30], ["ENERGIA_POSTE", 7], ["ENERGIA_TEXTO", 1],
];

export function dxfRedes(res: Resultado, r: ResultadoInfra): string {
  const U = (p: Pt) => paraUtm(res.plano, p);
  const o: string[] = [];
  const g = (c: number, v: string | number) => { o.push(String(c), typeof v === "number" ? v.toFixed(4) : v); };
  g(0, "SECTION"); g(2, "HEADER"); g(9, "$ACADVER"); g(1, "AC1009"); g(0, "ENDSEC");
  g(0, "SECTION"); g(2, "TABLES");
  g(0, "TABLE"); g(2, "LTYPE"); g(70, "1"); g(0, "LTYPE"); g(2, "CONTINUOUS"); g(70, "0"); g(3, "Solid line"); g(72, "65"); g(73, "0"); g(40, 0); g(0, "ENDTAB");
  g(0, "TABLE"); g(2, "LAYER"); g(70, String(CAMADAS_DXF.length));
  for (const [nome, cor] of CAMADAS_DXF) { g(0, "LAYER"); g(2, nome); g(70, "0"); g(62, String(cor)); g(6, "CONTINUOUS"); }
  g(0, "ENDTAB"); g(0, "ENDSEC");
  g(0, "SECTION"); g(2, "ENTITIES");
  const poli = (pts: Pt[], camada: string, fechada = false) => {
    if (pts.length < 2) return;
    g(0, "POLYLINE"); g(8, camada); g(66, "1"); g(70, fechada ? "1" : "0"); g(10, 0); g(20, 0); g(30, 0);
    for (const p of pts) { const u = U(p); g(0, "VERTEX"); g(8, camada); g(10, u[0]); g(20, u[1]); g(30, 0); }
    g(0, "SEQEND"); g(8, camada);
  };
  const circ = (p: Pt, raio: number, camada: string) => { const u = U(p); g(0, "CIRCLE"); g(8, camada); g(10, u[0]); g(20, u[1]); g(30, 0); g(40, raio); };
  const texto = (p: Pt, t: string, alt: number, camada: string) => {
    const u = U(p);
    g(0, "TEXT"); g(8, camada); g(10, u[0] + 0.8); g(20, u[1] + 0.8); g(30, 0); g(40, alt); g(1, t.normalize("NFD").replace(/[̀-ͯ]/g, ""));
  };
  for (const l of res.lotes) poli(l.pol.ext, "LOTE", true);
  for (const t of r.agua.tubos) { poli(t.linha, "AGUA_REDE"); if (t.linha2) poli(t.linha2, "AGUA_REDE"); const m = t.linha[Math.floor(t.linha.length / 2)]; texto(m, `DN${t.dn}`, 1, "AGUA_TEXTO"); }
  for (const x of [...r.agua.registros.map((y) => y.p), ...r.agua.descargas.map((y) => y.p), ...r.agua.ventosas.map((y) => y.p)]) circ(x, 0.4, "AGUA_ACESSORIOS");
  for (const h of r.agua.hidrantes) { circ(h.p, 0.8, "AGUA_ACESSORIOS"); texto(h.p, "HIDRANTE", 1, "AGUA_TEXTO"); }
  if (r.agua.reservatorio) { circ(r.agua.reservatorio.p, 3, "AGUA_ACESSORIOS"); texto(r.agua.reservatorio.p, `RESERVATORIO ${r.agua.reservatorio.volume} m3`, 1.5, "AGUA_TEXTO"); }
  for (const t of r.esgoto.trechos) { poli(t.linha, "ESGOTO_REDE"); const m = t.linha[0]; texto([m[0] + 2, m[1] + 2], `DN${t.dn} i=${(t.I * 100).toFixed(2)}%`, 0.8, "ESGOTO_TEXTO"); }
  if (r.esgoto.elevatoria) poli(r.esgoto.elevatoria.recalque, "ESGOTO_REDE");
  for (const pv of r.esgoto.pvs) { circ(pv.p, pv.tipo === "TIL" ? 0.35 : 0.6, "ESGOTO_PV"); texto(pv.p, `${pv.id} CT${pv.z.toFixed(2)} CF${pv.fundo.toFixed(2)}`, 0.7, "ESGOTO_TEXTO"); }
  for (const t of r.drenagem.trechos) { poli(t.linha, "DRENAGEM_GALERIA"); texto(t.linha[0], `D${t.dn}`, 0.8, "DRENAGEM_TEXTO"); }
  for (const rm of r.drenagem.ramais) poli([rm.de, rm.ate], "DRENAGEM_GALERIA");
  for (const b of r.drenagem.bocas) circ(b.p, 0.45, "DRENAGEM_BL");
  for (const pv of r.drenagem.pvs) { circ(pv.p, 0.6, "DRENAGEM_GALERIA"); texto(pv.p, pv.id, 0.7, "DRENAGEM_TEXTO"); }
  const e = r.eletrica;
  for (const v of e.vaos) {
    if (v.mt) poli([e.postes[v.a].p, e.postes[v.b].p], "ENERGIA_MT");
    if (v.bt) poli([e.postes[v.a].p, e.postes[v.b].p], "ENERGIA_BT");
  }
  for (const p of e.postes) { circ(p.p, 0.3, "ENERGIA_POSTE"); texto(p.p, `${p.id} ${p.altura}/${p.esforco}${p.trafo !== null ? ` TR ${e.trafos[p.trafo].kva}kVA` : ""}`, 0.7, "ENERGIA_TEXTO"); }
  g(0, "ENDSEC"); g(0, "EOF");
  return o.join("\r\n") + "\r\n";
}

// ---------------------------------------------------------------------------
// Locação: PVs, postes, hidrantes e o reservatório para a coletora
// ---------------------------------------------------------------------------

export function pontosDasRedes(res: Resultado, r: ResultadoInfra): PontoLocacao[] {
  const pt = (nome: string, p: Pt, codigo: string, h: number): PontoLocacao => {
    const u = paraUtm(res.plano, p);
    return { nome, e: u[0], n: u[1], h, codigo, p, tipo: "eixo" };
  };
  return [
    ...r.esgoto.pvs.map((pv) => pt(pv.id, pv.p, `${pv.tipo} ESGOTO CF ${pv.fundo.toFixed(2)}`, pv.z)),
    ...r.drenagem.pvs.map((pv) => pt(pv.id, pv.p, `PV DRENAGEM CF ${pv.fundo.toFixed(2)}`, pv.z)),
    ...r.drenagem.bocas.map((b) => pt(b.id, b.p, "BOCA DE LOBO", r.grafo.cota(b.p))),
    ...r.eletrica.postes.map((p) => pt(p.id, p.p, `POSTE ${p.altura}/${p.esforco}${p.trafo !== null ? ` TRAFO ${r.eletrica.trafos[p.trafo].kva}KVA` : ""}`, p.z)),
    ...r.agua.hidrantes.map((h, i) => pt(`HID-${String(i + 1).padStart(2, "0")}`, h.p, "HIDRANTE", r.grafo.cota(h.p))),
    ...(r.agua.reservatorio ? [pt("RES-01", r.agua.reservatorio.p, `RESERVATORIO ${r.agua.reservatorio.volume}M3`, r.agua.reservatorio.z)] : []),
  ];
}
