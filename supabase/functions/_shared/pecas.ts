// Gerador das PEÇAS TÉCNICAS: preenche os 7 modelos DOCX da empresa a partir
// dos dados do serviço (banco) + PDF de prévia do SIGEF.
//
// Estratégia: os modelos contêm um caso real de exemplo (FAZENDA VIBRAÇÃO).
// Substituímos os valores de exemplo pelos do serviço atual, com um motor de
// substituição que opera no TEXTO CONCATENADO de cada parágrafo (os valores
// ficam fatiados em vários runs no XML do Word). Tabelas de vértices e de
// confrontantes são reconstruídas clonando a primeira linha como protótipo.
import type { DadosSigef, LinhaSigef } from "./sigef_pdf.ts";
import { fmtBR } from "./geo.ts";

// ---------------------------------------------------------------------------
// util XML
// ---------------------------------------------------------------------------
const dec = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");
const enc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

// IMPORTANTE: a tag de texto é exatamente <w:t> (com ou sem atributos).
// `<w:t[^>]*>` casaria também <w:tc>, <w:tab>, <w:trPr> etc.
const RE_WT_CONTEUDO = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
const RE_WT_REESCRITA = /(<w:t(?:\s[^>]*)?)(\/>|>[\s\S]*?<\/w:t>)/g;

// Substitui pares [busca, novo] no texto concatenado de cada parágrafo,
// PRESERVANDO a formatação de cada run: cada trecho substituído é gravado no
// run onde o texto encontrado começa; os runs seguintes perdem só a parte que
// pertencia ao texto buscado (o negrito de um nome não "vaza" para o resto).
export function substituirEmParagrafos(xml: string, pares: [string, string][]): string {
  return xml.replace(/<w:p[ >][\s\S]*?<\/w:p>/g, (par) => {
    // um pedaço de texto por <w:t> (self-closed = ""), na ordem de RE_WT_REESCRITA
    const pecas: string[] = [];
    par.replace(RE_WT_REESCRITA, (all, _abre: string, corpo: string) => {
      pecas.push(corpo === "/>" ? "" : dec(corpo.slice(1, -"</w:t>".length)));
      return all;
    });
    if (pecas.length === 0) return par;
    let mudou = false;
    for (const [busca, novo] of pares) {
      if (!busca) continue;
      let desde = 0;
      for (;;) {
        const texto = pecas.join("");
        const pos = texto.indexOf(busca, desde);
        if (pos < 0) break;
        mudou = true;
        let off = 0;
        for (let i = 0; i < pecas.length; i++) {
          const ini = off, fim = off + pecas[i].length;
          off = fim;
          const a = Math.max(ini, pos), b = Math.min(fim, pos + busca.length);
          if (a >= b) continue;
          const antes = pecas[i].slice(0, a - ini);
          const depois = pecas[i].slice(b - ini);
          pecas[i] = a === pos ? antes + novo + depois : antes + depois;
        }
        desde = pos + novo.length;
      }
    }
    if (!mudou) return par;
    let i = 0;
    return par.replace(RE_WT_REESCRITA, (all, abre: string) => {
      const tag = abre.replace(/ xml:space="preserve"/, "") + ' xml:space="preserve"';
      return `${tag}>${enc(pecas[i++] ?? "")}</w:t>`;
    });
  });
}

function textoDoTrecho(x: string): string {
  return dec([...x.matchAll(RE_WT_CONTEUDO)].map((m) => m[1]).join(""));
}

// células de uma linha <w:tr>
function celulas(tr: string): string[] {
  return tr.match(/<w:tc[ >][\s\S]*?<\/w:tc>/g) ?? [];
}

// define o texto de uma célula (primeiro parágrafo, primeiro run)
function setCelula(tc: string, valor: string): string {
  let primeiroT = true;
  let out = tc.replace(RE_WT_REESCRITA, (all, abre: string) => {
    const tag = abre.replace(/ xml:space="preserve"/, "") + ' xml:space="preserve"';
    if (primeiroT) {
      primeiroT = false;
      return `${tag}>${enc(valor)}</w:t>`;
    }
    return `${tag}></w:t>`;
  });
  if (primeiroT) {
    // célula sem run: injeta run simples no primeiro parágrafo
    out = out.replace(/<w:p([ >])([\s\S]*?)<\/w:p>/, (all, sep, inner) =>
      `<w:p${sep}${inner}<w:r><w:t xml:space="preserve">${enc(valor)}</w:t></w:r></w:p>`);
  }
  return out;
}

// Reconstrói as linhas de dados de uma tabela: mantém linha(s) de cabeçalho,
// usa a 1ª linha de dados como protótipo e gera uma linha por item.
export function reconstruirTabela(
  tblXml: string,
  ehLinhaDados: (textoLinha: string) => boolean,
  dados: string[][],
): string {
  const trs = tblXml.match(/<w:tr[ >][\s\S]*?<\/w:tr>/g) ?? [];
  const idxDados = trs.findIndex((tr) => ehLinhaDados(textoDoTrecho(tr)));
  if (idxDados < 0) throw new Error("Tabela: linha de dados protótipo não encontrada");
  const prot = trs[idxDados];
  const protCels = celulas(prot);
  const novas = dados.map((valores) => {
    let tr = prot;
    // substitui célula a célula, da última para a primeira (índices estáveis)
    const cels = celulas(tr);
    for (let c = cels.length - 1; c >= 0; c--) {
      const valor = c < valores.length ? valores[c] : "";
      tr = tr.replace(cels[c], setCelula(cels[c], valor));
    }
    return tr;
  });
  // remove todas as linhas de dados antigas e insere as novas no lugar da 1ª
  let out = tblXml;
  for (let i = trs.length - 1; i >= 0; i--) {
    if (i === idxDados) continue;
    if (ehLinhaDados(textoDoTrecho(trs[i]))) out = out.replace(trs[i], "");
  }
  out = out.replace(prot, novas.join(""));
  if (protCels.length === 0) throw new Error("Tabela: protótipo sem células");
  return out;
}

// aplica f à N-ésima tabela que satisfaça o filtro
function mapearTabelas(xml: string, filtro: (texto: string) => boolean, f: (tbl: string) => string): string {
  return xml.replace(/<w:tbl>[\s\S]*?<\/w:tbl>/g, (tbl) => (filtro(textoDoTrecho(tbl)) ? f(tbl) : tbl));
}

// ---------------------------------------------------------------------------
// domínio
// ---------------------------------------------------------------------------

export interface Requerente { nome: string; cpf: string; genero: "M" | "F" }

export interface DadosRt {
  nome: string;
  formacao: string;        // "Técnico em Agropecuária"
  conselhoSigla: string;   // "CFTA"
  conselhoNumero: string;  // "0578839458-9"
  identidade: string;      // "22.106.549-04 SSP/BA"
  cpf: string;
}

export interface PessoaConfrontante { nome: string; cpf: string | null }

export interface TrechoPecas {
  descritivo: string;
  tipoLimite: string;
  pessoas: PessoaConfrontante[];
  imovelLabel: string;      // "FAZENDA TERRA NOVA (MATR.4.403/CNS.00.803-7)" | "FAZENDA LAMEIRO (POSSE)"
  posse: boolean;
  ehVia: boolean;           // estrada/corredor/rio etc. (faixa de domínio pública)
  linhas: LinhaSigef[];     // segmentos (do PDF) pertencentes ao trecho
}

export interface DadosPecas {
  requerentes: Requerente[];      // 1 ou 2
  rg: string | null;              // RG do requerente 1 (opcional)
  endereco: string;
  municipio: string;              // "Araci"
  uf: string;                     // "BA"
  denominacao: string;            // "FAZENDA VIBRAÇÃO"
  matricula: string;              // "4.490" (como deve sair)
  cns: string;                    // "00.803-7"
  sncrFmt: string;                // "312.010.028.860-1"
  sncrNum: string;                // "3120100288601"
  areaHa: string;                 // "84,0638" (do PDF)
  perimetro: string;              // "4.077,80" (do PDF)
  areaMatriculaHa: string | null; // "86" — área constante na matrícula (doc 6)
  mcAbs: number;
  trt: string;                    // "BR20250804764"
  dataStr: string;                // "03/06/2026"
  rt: DadosRt;
  viaDominio: string | null;      // "BA 408"
  sigef: DadosSigef;
  trechos: TrechoPecas[];
  confrontacaoDe: (codigoVertice: string) => string; // descritivo completo p/ tabela do doc 2
}

// Faixa de domínio pública: estrada, corredor, rio, rodovia etc.
const RE_VIA =
  /\b(ESTRADA|RODOVIA|CORREDOR|SERVID[ÃA]O|RIO|RIACHO|C[ÓO]RREGO|LAGOA?|A[ÇC]UDE|FAIXA\s+DE\s+DOM[ÍI]NIO|(?:BR|BA|AL|SE|PE|PB|RN|CE|PI|MA|TO|GO|MG|ES|RJ|SP|PR|SC|RS|MS|MT|DF|RO|AC|AM|RR|PA|AP)[-\s]?\d{2,3})\b/i;

// "do BA 408" / "da ESTRADA VICINAL" — artigo usado em "faixa de domínio ..."
export function artigoVia(rotulo: string): string {
  return /^(ESTRADA|RODOVIA|SERVID[ÃA]O|LAGOA|AVENIDA|RUA|FAIXA)/i.test(rotulo.trim()) ? "da" : "do";
}

// Extrai pessoas e rótulo do imóvel a partir do descritivo formal.
// Formatos aceitos:
//   "(MATR.4.403/CNS.00.803-7) FAZENDA TERRA NOVA\ CARLOS...\ CPF:...\ DIVALDO...\ CPF:..."
//   "MARIA NINA DA SILVA COSTA\ CPF:666.186.815-53"  (confrontante sem rótulo de imóvel)
//   "ESTRADA VICINAL" | "BA 408" | "CORREDOR"        (faixa de domínio pública)
export function parseDescritivo(descritivo: string): { pessoas: PessoaConfrontante[]; imovelLabel: string; posse: boolean; ehVia: boolean } {
  const partes = descritivo.split("\\").map((p) => p.trim()).filter(Boolean);
  const m = partes[0]?.match(/^\(([^)]*)\)\s*(.+)$/);
  const lerPessoas = (ps: string[]): PessoaConfrontante[] => {
    const pessoas: PessoaConfrontante[] = [];
    for (const p of ps) {
      if (/^CPF\s*:/i.test(p)) {
        if (pessoas.length) pessoas[pessoas.length - 1].cpf = p.replace(/^CPF\s*:/i, "").trim();
      } else {
        pessoas.push({ nome: p, cpf: null });
      }
    }
    return pessoas;
  };
  if (m) {
    const tag = m[1].trim();
    const nomeImovel = m[2].trim();
    return { pessoas: lerPessoas(partes.slice(1)), imovelLabel: `${nomeImovel} (${tag})`, posse: /^POSSE$/i.test(tag), ehVia: false };
  }
  // sem "(TAG) imóvel": ou é faixa de domínio pública, ou lista de pessoas
  const temCpf = partes.some((p) => /^CPF\s*:/i.test(p));
  if (!temCpf && partes.length === 1 && RE_VIA.test(partes[0])) {
    return { pessoas: [], imovelLabel: partes[0], posse: false, ehVia: true };
  }
  return { pessoas: lerPessoas(partes), imovelLabel: "", posse: false, ehVia: false };
}

// ---------------------------------------------------------------------------
// número por extenso (p/ área em hectares no doc 6)
// ---------------------------------------------------------------------------
const UNID = ["", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez", "onze", "doze", "treze", "quatorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"];
const DEZ = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];
const CENT = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos", "setecentos", "oitocentos", "novecentos"];

export function numeroPorExtenso(n: number): string {
  if (n === 0) return "zero";
  if (n === 100) return "cem";
  if (n < 0 || n > 999999) return String(n);
  const partes: string[] = [];
  const mil = Math.floor(n / 1000);
  const resto = n % 1000;
  if (mil > 0) partes.push(mil === 1 ? "mil" : `${numeroPorExtenso(mil)} mil`);
  if (resto > 0) {
    const c = Math.floor(resto / 100), d = resto % 100;
    const sub: string[] = [];
    if (c > 0) sub.push(resto === 100 ? "cem" : CENT[c]);
    if (d > 0) sub.push(d < 20 ? UNID[d] : DEZ[Math.floor(d / 10)] + (d % 10 ? ` e ${UNID[d % 10]}` : ""));
    partes.push(sub.join(" e "));
  }
  return partes.join(" e ");
}

// "84,0638" → "oitenta e quatro hectares, seis ares e trinta e oito centiares"
export function areaPorExtenso(areaHaStr: string): string {
  const [intp, decp = ""] = areaHaStr.replace(/\./g, "").split(",");
  const ha = parseInt(intp || "0", 10);
  const dec4 = (decp + "0000").slice(0, 4);
  const ares = parseInt(dec4.slice(0, 2), 10);
  const cent = parseInt(dec4.slice(2, 4), 10);
  const partes = [`${numeroPorExtenso(ha)} hectare${ha === 1 ? "" : "s"}`];
  if (ares > 0) partes.push(`${numeroPorExtenso(ares)} are${ares === 1 ? "" : "s"}`);
  if (cent > 0) partes.push(`${numeroPorExtenso(cent)} centiare${cent === 1 ? "" : "s"}`);
  return partes.join(" e ");
}

export const UF_EXTENSO: Record<string, string> = {
  AC: "ACRE", AL: "ALAGOAS", AP: "AMAPÁ", AM: "AMAZONAS", BA: "BAHIA", CE: "CEARÁ",
  DF: "DISTRITO FEDERAL", ES: "ESPÍRITO SANTO", GO: "GOIÁS", MA: "MARANHÃO",
  MT: "MATO GROSSO", MS: "MATO GROSSO DO SUL", MG: "MINAS GERAIS", PA: "PARÁ",
  PB: "PARAÍBA", PR: "PARANÁ", PE: "PERNAMBUCO", PI: "PIAUÍ", RJ: "RIO DE JANEIRO",
  RN: "RIO GRANDE DO NORTE", RS: "RIO GRANDE DO SUL", RO: "RONDÔNIA", RR: "RORAIMA",
  SC: "SANTA CATARINA", SP: "SÃO PAULO", SE: "SERGIPE", TO: "TOCANTINS",
};

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
export function dataPorExtenso(dataStr: string): string {
  const [d, m, a] = dataStr.split("/").map((x) => parseInt(x, 10));
  return `${String(d).padStart(2, "0")} de ${MESES[(m ?? 1) - 1]} de ${a}`;
}

// ---------------------------------------------------------------------------
// mapa de substituições comum (valores de exemplo dos modelos → valores reais)
// ---------------------------------------------------------------------------
const EX = {
  nome1: "LARISSA LIMA GONCALVES ARAUJO",
  cpf1: "028.090.615-30",
  nome2: "GILBERTO GONCALVES ARAUJO JUNIOR",
  cpf2: "048.778.385-97",
  fazenda: "FAZENDA VIBRAÇÃO",
  areaHa: "84,0638",
  perimetro: "4.077,80",
  sncrFmt: "312.010.028.860-1",
  sncrNum: "3120100288601",
  matricula: "4.490",
  matriculaNum: "4490",
  cns: "00.803-7",
  trt: "BR20260601082",
  rtNome: "DANIEL NASCIMENTO SANTOS",
  conselhoNumero: "0578839458-9",
  conselhoNumeroSemTraco: "05788394589",
  conselhoSigla: "CFTA",
  rtCpf: "057.883.945-89",
  identidade: "22.106.549-04 SSP/BA",
  endereco: "Rua Presidente Costa E Silva, Nº 218 G, Centro, Conceição Do Coité, Bahia, CEP:48.730-000",
  via: "BA 408",
  data: "03/06/2026",
  dataExtenso: "03 de junho de 2026",
  tarefas: "192,98",
};

function rotProp(r: Requerente): string { return r.genero === "F" ? "Proprietária" : "Proprietário"; }
function nacional(r: Requerente): string { return r.genero === "F" ? "BRASILEIRA" : "BRASILEIRO"; }
function inscrito(r: Requerente): string { return r.genero === "F" ? "inscrita" : "inscrito"; }

export function mapaComum(d: DadosPecas): [string, string][] {
  const r1 = d.requerentes[0];
  const r2 = d.requerentes[1] ?? r1;
  const um = d.requerentes.length === 1;
  const o = r1.genero === "F" ? "a" : "o";
  const muniUp = d.municipio.toUpperCase();
  const ufExt = UF_EXTENSO[d.uf.toUpperCase()] ?? d.uf;
  const nomesJuntos = d.requerentes.map((r) => r.nome).join("/ ");
  // RG (opcional) entra na célula de CPF do cabeçalho quando há 1 requerente
  const cpfsJuntos = d.requerentes.map((r) => r.cpf).join("/ ") + (um && d.rg ? ` – RG: ${d.rg}` : "");
  const tarefas = calcTarefas(d.areaHa);
  // Com um único requerente, as frases conjuntas dos modelos viram singulares
  // e as menções ao 2º proprietário de exemplo são absorvidas aqui (as
  // assinaturas dele são removidas por removerBlocosSegundoRequerente).
  const paresUmRequerente: [string, string][] = !um ? [] : [
    // 7-declaração faixa de domínio: qualificação conjunta
    [`${EX.nome1}, maior, capaz, inscrita no CPF nº:${EX.cpf1} e  ${EX.nome2}, maior, capaz, inscrito no CPF nº:${EX.cpf2}, residentes e domiciliados`,
      `${r1.nome}, maior, capaz, ${inscrito(r1)} no CPF nº:${r1.cpf}, residente e domiciliad${o}`],
    [`${EX.nome1}, maior, capaz, inscrita no CPF nº:${EX.cpf1} e ${EX.nome2}, maior, capaz, inscrito no CPF nº:${EX.cpf2}, residentes e domiciliados`,
      `${r1.nome}, maior, capaz, ${inscrito(r1)} no CPF nº:${r1.cpf}, residente e domiciliad${o}`],
    ["legítimos proprietários do imóvel", `legítim${o} proprietári${o} do imóvel`],
    // 3-cartas: dupla de proprietários
    [`Eu, Proprietária ${EX.nome1}, CPF nº:${EX.cpf1}, Eu, Proprietário ${EX.nome2}, CPF nº:${EX.cpf2},  proprietários do imóvel rural denominado`,
      `Eu, ${rotProp(r1)} ${r1.nome}, CPF nº:${r1.cpf}, proprietári${o} do imóvel rural denominado`],
    [`Eu, Proprietária ${EX.nome1}, CPF nº:${EX.cpf1}, Eu, Proprietário ${EX.nome2}, CPF nº:${EX.cpf2}, proprietários do imóvel rural denominado`,
      `Eu, ${rotProp(r1)} ${r1.nome}, CPF nº:${r1.cpf}, proprietári${o} do imóvel rural denominado`],
    // 5-declaração do proprietário
    [`Eu, ${EX.nome1}, CPF nº:${EX.cpf1}, BRASILEIRA, MAIOR, CAPAZ e Eu, ${EX.nome2}, CPF nº:${EX.cpf2}, BRASILEIRO, MAIOR, CAPAZ.`,
      `Eu, ${r1.nome}, CPF nº:${r1.cpf}, ${nacional(r1)}, MAIOR, CAPAZ.`],
    [`${EX.nome1}, ${EX.nome2}.`, `${r1.nome}.`],
    // 4-declaração do técnico
    [`propriedade dos Srs. ${EX.nome1}, CPF nº:${EX.cpf1}, ${EX.nome2}, CPF nº:${EX.cpf2}.`,
      `propriedade d${o} Sr${r1.genero === "F" ? "a" : ""}. ${r1.nome}, CPF nº:${r1.cpf}.`],
    // 6-requerimento
    [`Proprietário: ${EX.nome1}, CPF nº:${EX.cpf1}, BRASILEIRA, MAIOR, CAPAZ, ${EX.nome2}, CPF nº:${EX.cpf2}, BRASILEIRO, MAIOR, CAPAZ e ainda,`,
      `${rotProp(r1)}: ${r1.nome}, CPF nº:${r1.cpf}, ${nacional(r1)}, MAIOR, CAPAZ e ainda,`],
  ];
  const pares: [string, string][] = [
    ...paresUmRequerente,
    // compostos com gênero — SEMPRE antes dos nomes isolados
    [`Proprietária: ${EX.nome1}`, `${rotProp(r1)}: ${r1.nome}`],
    [`Proprietário: ${EX.nome2}`, `${rotProp(r2)}: ${r2.nome}`],
    [`Eu, Proprietária ${EX.nome1}, CPF nº:${EX.cpf1},`, `Eu, ${rotProp(r1)} ${r1.nome}, CPF nº:${r1.cpf},`],
    [`Eu, Proprietário ${EX.nome2}, CPF nº:${EX.cpf2},`, `Eu, ${rotProp(r2)} ${r2.nome}, CPF nº:${r2.cpf},`],
    [`${EX.nome1}, CPF nº:${EX.cpf1}, BRASILEIRA, MAIOR, CAPAZ`, `${r1.nome}, CPF nº:${r1.cpf}, ${nacional(r1)}, MAIOR, CAPAZ`],
    [`${EX.nome2}, CPF nº:${EX.cpf2}, BRASILEIRO, MAIOR, CAPAZ`, `${r2.nome}, CPF nº:${r2.cpf}, ${nacional(r2)}, MAIOR, CAPAZ`],
    [`${EX.nome1}, maior, capaz, inscrita no CPF nº:${EX.cpf1}`, `${r1.nome}, maior, capaz, ${inscrito(r1)} no CPF nº:${r1.cpf}`],
    [`${EX.nome2}, maior, capaz, inscrito no CPF nº:${EX.cpf2}`, `${r2.nome}, maior, capaz, ${inscrito(r2)} no CPF nº:${r2.cpf}`],
    // conjuntos e isolados
    [`${EX.nome1}/ ${EX.nome2}`, nomesJuntos],
    [`${EX.cpf1}/ ${EX.cpf2}`, cpfsJuntos],
    [EX.nome1, r1.nome],
    [EX.nome2, r2.nome],
    [EX.cpf1, r1.cpf],
    [EX.cpf2, r2.cpf],
    // imóvel / números
    [`${EX.areaHa} HA/ ${EX.tarefas} TAREFAS`, `${d.areaHa} HA/ ${tarefas} TAREFAS`],
    [`${EX.areaHa} ha`, `${d.areaHa} ha`],
    [EX.areaHa, d.areaHa],
    [`${EX.perimetro} m`, `${d.perimetro} m`],
    [EX.perimetro, d.perimetro],
    [EX.fazenda, d.denominacao.toUpperCase()],
    [EX.sncrFmt, d.sncrFmt],
    [EX.sncrNum, d.sncrNum],
    [`MATR.${EX.matricula}`, `MATR.${d.matricula}`],
    [`nº ${EX.matricula}`, `nº ${d.matricula}`],
    [`: ${EX.matricula}`, `: ${d.matricula}`],
    [EX.matriculaNum, d.matricula.replace(/\./g, "")],
    [EX.cns, d.cns],
    ["39° WGr", `${d.mcAbs}° WGr`],
    [EX.trt, d.trt],
    // RT
    [EX.rtNome, d.rt.nome.toUpperCase()],
    ["TÉCNICO EM AGROPECUARIA", d.rt.formacao.toUpperCase()],
    ["técnico em agropecuária", d.rt.formacao.toLowerCase()],
    ["Técnico(a) em Agropecuária", d.rt.formacao],
    [EX.conselhoNumero, d.rt.conselhoNumero],
    [EX.conselhoNumeroSemTraco, d.rt.conselhoNumero.replace(/-/g, "")],
    [EX.conselhoSigla, d.rt.conselhoSigla],
    [EX.rtCpf, d.rt.cpf],
    [EX.identidade, d.rt.identidade],
    // endereço / via / datas
    [EX.endereco, d.endereco],
    [EX.via, d.viaDominio ?? EX.via],
    [EX.dataExtenso, dataPorExtenso(d.dataStr)],
    [EX.data, d.dataStr],
    // município — variações usadas nos modelos (maiúsculas e título)
    ["ARACI - ESTADO DA BAHIA", `${muniUp} - ESTADO DA ${"BAHIA" === ufExt ? "BAHIA" : ufExt}`],
    ["ARACI – BAHIA", `${muniUp} – ${ufExt}`],
    ["ARACI- BA", `${muniUp}- ${d.uf}`],
    ["ARACI – BA", `${muniUp} – ${d.uf}`],
    ["ARACI - BA", `${muniUp} - ${d.uf}`],
    ["ARACI-BA", `${muniUp}-${d.uf}`],
    ["ARACI/BA", `${muniUp}/${d.uf}`],
    ["Araci - BA", `${d.municipio} - ${d.uf}`],
    ["Araci-BA", `${d.municipio}-${d.uf}`],
    ["Araci", d.municipio],
    ["ARACI", muniUp],
  ];
  return pares;
}

function calcTarefas(areaHaStr: string): string {
  const ha = parseFloat(areaHaStr.replace(/\./g, "").replace(",", "."));
  return fmtBR((ha * 10000) / 4356, 2); // tarefa baiana = 4.356 m²
}

// ---------------------------------------------------------------------------
// helpers de tabela de vértices
// ---------------------------------------------------------------------------
const EH_LINHA_VERTICE = (t: string) => /^[A-Z0-9]{2,4}-[MPV]-\d+\s*-?\d+°/.test(t.trim());
const EH_TBL_VERTICES = (t: string) => t.includes("Longitude") && t.includes("Azimute");

function linhaVertice7(l: LinhaSigef): string[] {
  return [l.codigo, l.lon, l.lat, l.alt, l.vante, l.azimute, l.dist];
}

// ---------------------------------------------------------------------------
// geração das 7 peças (entrada/saída: document.xml de cada modelo)
// ---------------------------------------------------------------------------

// Remove as assinaturas do 2º proprietário de exemplo quando o serviço tem um
// único requerente (a linha "Proprietário:/Requerente: NOME2", o "CPF nº:..."
// seguinte e a linha de sublinhado anterior).
export function removerBlocosSegundoRequerente(xml: string): string {
  const paras = xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? [];
  const remover = new Set<number>();
  paras.forEach((p, i) => {
    const t = textoDoTrecho(p).trim();
    if (t === `Proprietário: ${EX.nome2}` || t === `Requerente: ${EX.nome2}` || t === `Proprietária: ${EX.nome2}`) {
      remover.add(i);
      const ant = textoDoTrecho(paras[i - 1] ?? "").replace(/\s+/g, "");
      if (/^_+$/.test(ant)) remover.add(i - 1);
      const seg = textoDoTrecho(paras[i + 1] ?? "").trim();
      if (seg === `CPF nº:${EX.cpf2}`) remover.add(i + 1);
    }
  });
  let out = xml;
  for (const i of [...remover].sort((a, b) => b - a)) out = out.replace(paras[i], "");
  return out;
}

export function gerarPecasXml(tpl: Record<string, string>, d: DadosPecas): Record<string, string | null> {
  const mapa = mapaComum(d);
  const out: Record<string, string | null> = {};
  if (d.requerentes.length === 1) {
    tpl = Object.fromEntries(Object.entries(tpl).map(([k, v]) => [k, removerBlocosSegundoRequerente(v)]));
  }

  // ---- 1. MEMORIAL DESCRITIVO (corpo reescrito com azimutes/distâncias do SIGEF)
  {
    let xml = tpl["1"];
    const corpo = corpoMemorialSigef(d);
    xml = xml.replace(/<w:p[ >][\s\S]*?<\/w:p>/g, (par) => {
      if (!textoDoTrecho(par).includes("Inicia-se a descrição")) return par;
      let primeiro = true;
      return par.replace(RE_WT_REESCRITA, (all, abre: string) => {
        const tag = abre.replace(/ xml:space="preserve"/, "") + ' xml:space="preserve"';
        if (primeiro) { primeiro = false; return `${tag}>${enc(corpo)}</w:t>`; }
        return `${tag}></w:t>`;
      });
    });
    out["1"] = substituirEmParagrafos(xml, mapa);
  }

  // ---- 2. MEMORIAL TABULAR (tabela completa com confrontações do banco)
  {
    let xml = tpl["2"];
    const linhas = d.sigef.linhas.map((l) => [...linhaVertice7(l), d.confrontacaoDe(l.codigo)]);
    xml = mapearTabelas(xml, EH_TBL_VERTICES, (tbl) => reconstruirTabela(tbl, EH_LINHA_VERTICE, linhas));
    out["2"] = substituirEmParagrafos(xml, mapa);
  }

  // ---- 3. CARTAS DE ANUÊNCIA (uma carta por trecho com pessoas)
  out["3"] = gerarCartas(tpl["3"], d, mapa);

  // ---- 4/5. DECLARAÇÕES (tabela NOME COMPLETO | IMÓVEL — só confrontantes-pessoa)
  for (const n of ["4", "5"]) {
    let xml = tpl[n];
    const linhas = d.trechos
      .filter((t) => !t.ehVia && t.pessoas.length > 0)
      .map((t) => [t.pessoas.map((p) => p.nome).join("\\ "), t.imovelLabel || "—"]);
    xml = mapearTabelas(
      xml,
      (t) => t.includes("NOME COMPLETO") && t.includes("IMÓVEL"),
      (tbl) => reconstruirTabela(tbl, (t) => !t.includes("NOME COMPLETO") && t.trim().length > 0, linhas),
    );
    out[n] = substituirEmParagrafos(xml, mapa);
  }

  // ---- 6. REQUERIMENTO (área da matrícula + área encontrada por extenso)
  {
    const paresDoc6: [string, string][] = [];
    if (d.areaMatriculaHa) {
      const v = d.areaMatriculaHa.replace(/\./g, "").replace(",", ".");
      const fmt = fmtBR(parseFloat(v), /,/.test(d.areaMatriculaHa) ? 4 : 0);
      paresDoc6.push(["86 ha (oitenta e seis hectares)", `${fmt} ha (${areaPorExtenso(fmt)})`]);
    }
    paresDoc6.push(["84,066 ha (oitenta e quatro hectares e seis ares e sessenta centiares)",
      `${d.areaHa} ha (${areaPorExtenso(d.areaHa)})`]);
    out["6"] = substituirEmParagrafos(tpl["6"], [...paresDoc6, ...mapa]);
  }

  // ---- 7. DECLARAÇÃO FAIXA DE DOMÍNIO (um bloco por via; null se não há via)
  out["7"] = gerarDeclaracoesVia(tpl["7"], d, mapa, EX.via);

  return out;
}

// ---------------------------------------------------------------------------
// declaração de faixa de domínio: só é gerada quando o imóvel confronta com
// estrada, corredor ou rio — um bloco (declaração completa) por via, cada um
// com a tabela dos vértices daquele trecho. Sem via → retorna null (peça é
// omitida pelo chamador).
// ---------------------------------------------------------------------------
export function gerarDeclaracoesVia(
  xml: string,
  d: DadosPecas,
  mapa: [string, string][],
  exVia: string,
): string | null {
  const vias = d.trechos.filter((t) => t.ehVia && t.linhas.length > 0);
  if (vias.length === 0) return null;
  const bodyM = xml.match(/<w:body>([\s\S]*?)(<w:sectPr[\s\S]*?<\/w:sectPr>)?<\/w:body>/);
  if (!bodyM) throw new Error("Declaração de faixa: body não encontrado");
  const paras = bodyM[1].match(/<w:p[ >][\s\S]*?<\/w:p>|<w:tbl>[\s\S]*?<\/w:tbl>/g) ?? [];
  // blocos começam no cabeçalho "ILMO..."; modelos sem esse título são um bloco único
  const inicios: number[] = [];
  paras.forEach((p, i) => { if (textoDoTrecho(p).trim().startsWith("ILMO")) inicios.push(i); });
  const blocos: string[][] = inicios.length
    ? inicios.map((ini, k) => paras.slice(ini, k + 1 < inicios.length ? inicios[k + 1] : paras.length))
    : [paras];
  const prot = blocos[0];
  const saida: string[] = [];
  for (const v of vias) {
    const rotulo = (v.imovelLabel || v.descritivo).trim();
    let bloco = prot.join("");
    bloco = mapearTabelas(bloco, EH_TBL_VERTICES, (tbl) =>
      reconstruirTabela(tbl, EH_LINHA_VERTICE, v.linhas.map(linhaVertice7)));
    bloco = substituirEmParagrafos(bloco, [
      [`faixa de domínio do ${exVia}`, `faixa de domínio ${artigoVia(rotulo)} ${rotulo}`],
      [`faixa de domínio da ${exVia}`, `faixa de domínio ${artigoVia(rotulo)} ${rotulo}`],
      [`faixa de dominio do ${exVia}`, `faixa de domínio ${artigoVia(rotulo)} ${rotulo}`],
      [`faixa de dominio da ${exVia}`, `faixa de domínio ${artigoVia(rotulo)} ${rotulo}`],
      [exVia, rotulo],
      ...mapa,
    ]);
    saida.push(bloco);
  }
  const prefixo = inicios.length ? paras.slice(0, inicios[0]).join("") : "";
  return xml.replace(bodyM[0], `<w:body>${prefixo}${saida.join("")}${bodyM[2] ?? ""}</w:body>`);
}

// ---------------------------------------------------------------------------
// Junção PDF × banco: cada linha do PDF pertence ao trecho iniciado mais
// recentemente (mapa: código do vértice que INICIA cada trecho → dados).
// ---------------------------------------------------------------------------
export function montarTrechosPecas(
  linhas: LinhaSigef[],
  inicios: Map<string, { descritivo: string; tipoLimite: string }>,
): { trechos: TrechoPecas[]; confrontacaoDe: (codigo: string) => string } {
  const trechos: TrechoPecas[] = [];
  const porCodigo = new Map<string, string>();
  let atual: TrechoPecas | null = null;
  // a 1ª linha pode não iniciar trecho (dá a volta): usa o último início do anel
  const ultimoInicio = [...inicios.entries()].pop();
  for (const l of linhas) {
    const ini = inicios.get(l.codigo);
    if (ini || !atual) {
      const info = ini ?? (ultimoInicio ? ultimoInicio[1] : { descritivo: l.confrontacao, tipoLimite: "LA1" });
      const jaExiste = ini ? trechos.find((t) => t.descritivo === info.descritivo && t.tipoLimite === info.tipoLimite && t.linhas.length === 0) : undefined;
      const parsed = parseDescritivo(info.descritivo);
      atual = jaExiste ?? {
        descritivo: info.descritivo,
        tipoLimite: info.tipoLimite,
        pessoas: parsed.pessoas,
        imovelLabel: parsed.imovelLabel,
        posse: parsed.posse,
        ehVia: parsed.ehVia,
        linhas: [],
      };
      if (!trechos.includes(atual)) trechos.push(atual);
    }
    atual.linhas.push(l);
    porCodigo.set(l.codigo, atual.descritivo);
  }
  return {
    trechos,
    confrontacaoDe: (codigo: string) => porCodigo.get(codigo) ?? "",
  };
}

// corpo do memorial (peça 1) no estilo do modelo, com valores SGL do SIGEF
function corpoMemorialSigef(d: DadosPecas): string {
  const ls = d.sigef.linhas;
  const alt2 = (alt: string) => fmtBR(parseFloat(alt.replace(",", ".")), 2);
  const trechoDe = new Map<string, TrechoPecas>();
  for (const t of d.trechos) for (const l of t.linhas) trechoDe.set(l.codigo, t);
  let s = `            Inicia-se a descrição deste perímetro no vértice ${ls[0].codigo}, ` +
    `georreferenciado no Sistema Geodésico Brasileiro, DATUM - SIRGAS2000, MC-${d.mcAbs}°W, ` +
    `de coordenadas Longitude:${ls[0].lon}, Latitude:${ls[0].lat} de altitude ${alt2(ls[0].alt)}m; `;
  let confAtual: string | null = null;
  for (let i = 0; i < ls.length; i++) {
    const l = ls[i];
    const conf = d.confrontacaoDe(l.codigo);
    if (conf && conf !== confAtual) {
      confAtual = conf;
      const t = trechoDe.get(l.codigo);
      if (t?.ehVia) {
        const rotulo = (t.imovelLabel || t.descritivo).trim();
        s += `deste segue confrontando com a faixa de domínio ${artigoVia(rotulo)} ${rotulo}, com azimute de `;
      } else {
        s += `deste segue confrontando com a propriedade de ${conf}, com azimute de `;
      }
    } else {
      s += "deste segue, com azimute de ";
    }
    s += `${l.azimute} por uma distância de ${l.dist}m até o vértice ${l.vante}`;
    if (i === ls.length - 1) {
      s += `, ponto inicial da descrição deste perímetro de ${d.perimetro} m.`;
    } else {
      const p = ls[i + 1];
      s += `, de coordenadas Longitude:${p.lon}, Latitude:${p.lat} de altitude ${alt2(p.alt)}m; `;
    }
  }
  return s;
}

// ---------------------------------------------------------------------------
// cartas de anuência: clona a carta-protótipo (1 ou 2 pessoas) por trecho
// ---------------------------------------------------------------------------
const CARTA_EX = {
  // carta 1 (2 pessoas): CARLOS + DIVALDO / FAZENDA TERRA NOVA (MATR...)
  p2: {
    nome1: "CARLOS MATOS DE LIMA", cpf1: "397.521.865-72",
    nome2: "DIVALDO JOSE MATOS DE LIMA", cpf2: "180.246.295-34",
    imovel: "FAZENDA TERRA NOVA (MATR.4.403/CNS.00.803-7)",
  },
  // carta 2 (1 pessoa): RUDSON / FAZENDA LAMEIRO (POSSE)
  p1: {
    nome1: "RUDSON PINTO FERREIRA", cpf1: "791.234.145-53",
    imovel: "FAZENDA LAMEIRO (POSSE)",
  },
};

function gerarCartas(xml: string, d: DadosPecas, mapa: [string, string][]): string {
  // delimita o corpo e divide em blocos por título "CARTA DE ANUÊNCIA"
  const bodyM = xml.match(/<w:body>([\s\S]*?)(<w:sectPr[\s\S]*?<\/w:sectPr>)?<\/w:body>/);
  if (!bodyM) throw new Error("Cartas: body não encontrado");
  const body = bodyM[1];
  const sect = bodyM[2] ?? "";
  const paras = body.match(/<w:p[ >][\s\S]*?<\/w:p>|<w:tbl>[\s\S]*?<\/w:tbl>/g) ?? [];
  const inicios: number[] = [];
  paras.forEach((p, i) => { if (textoDoTrecho(p).trim() === "CARTA DE ANUÊNCIA") inicios.push(i); });
  if (inicios.length === 0) throw new Error("Cartas: título não encontrado");
  const blocos: string[][] = inicios.map((ini, k) =>
    paras.slice(ini, k + 1 < inicios.length ? inicios[k + 1] : paras.length));
  // protótipos: bloco com 2 pessoas (contém DIVALDO) e bloco com 1 pessoa
  const prot2 = blocos.find((b) => b.join("").includes("DIVALDO"));
  const prot1 = blocos.find((b) => !b.join("").includes("DIVALDO"));

  const cartas: string[] = [];
  for (const t of d.trechos) {
    if (t.ehVia || t.pessoas.length === 0) continue;
    const duas = t.pessoas.length >= 2;
    const prot = (duas ? prot2 : prot1) ?? prot1 ?? prot2;
    if (!prot) continue;
    let bloco = prot.join("");
    const ex = duas ? CARTA_EX.p2 : CARTA_EX.p1;
    const pares: [string, string][] = [
      [ex.imovel, t.imovelLabel || t.pessoas.map((p) => p.nome).join(" e ")],
      [ex.nome1, t.pessoas[0].nome],
      [ex.cpf1, t.pessoas[0].cpf ?? "—"],
    ];
    if (duas) {
      const resto = t.pessoas.slice(1);
      pares.push(
        [CARTA_EX.p2.nome2, resto.map((p) => p.nome).join(" e ")],
        [CARTA_EX.p2.cpf2, resto.map((p) => p.cpf ?? "—").join(" e ")],
      );
    }
    // tabela da carta: segmentos do trecho
    bloco = mapearTabelas(bloco, EH_TBL_VERTICES, (tbl) =>
      reconstruirTabela(tbl, EH_LINHA_VERTICE, t.linhas.map(linhaVertice7)));
    bloco = substituirEmParagrafos(bloco, [...pares, ...mapa]);
    cartas.push(bloco);
  }
  if (cartas.length === 0) {
    // sem confrontantes-pessoa: mantém 1 carta protótipo apenas com dados gerais
    cartas.push(substituirEmParagrafos((prot1 ?? prot2 ?? []).join(""), mapa));
  }
  const prefixo = paras.slice(0, inicios[0]).join("");
  const novoBody = prefixo + cartas.join("") + sect;
  return xml.replace(bodyM[0], `<w:body>${novoBody}</w:body>`);
}

// ---------------------------------------------------------------------------
// PEÇAS DE POSSE: 4 modelos próprios (caso de exemplo: ANTONIO / FAZENDA SÃO
// DOMINGOS). O imóvel não tem matrícula ("Matrícula: POSSE" no cabeçalho), o
// requerente assina como Posseiro(a) e há campo de RG no cabeçalho.
// ---------------------------------------------------------------------------
const EXP = {
  nome: "ANTONIO DA SILVA COSTA",
  cpf: "005.097.695-86",
  rg: "12.567.664-61",
  fazenda: "FAZENDA SÃO DOMINGOS",
  areaTarefas: "0,1082 ha/0,24 TAREFAS",
  perimetro: "158,650",
  sncr: "950.033.008.028-6",
  trt: "BR20251208584",
  data: "17/12/2025",
  dataExtenso: "17 de Dezembro de 2025",
  via: "ESTRADA VICINAL",
  endereco: "Estrada de São Domingos,n° 100, Zona Rural, Pedra Ferreira, CEP: 44149-999, Feira de Santana, Bahia",
  carta: { nome: "ROQUE FERREIRA DE SÁ", cpf: "087.471.135-53" },
};

function rotPosse(r: Requerente): string { return r.genero === "F" ? "Posseira" : "Posseiro"; }

export function mapaPosse(d: DadosPecas): [string, string][] {
  const r1 = d.requerentes[0];
  const o = r1.genero === "F" ? "a" : "o";
  const muniUp = d.municipio.toUpperCase();
  const ufExt = UF_EXTENSO[d.uf.toUpperCase()] ?? d.uf;
  return [
    // compostos com gênero — antes dos isolados
    [`Posseiro: ${EXP.nome}`, `${rotPosse(r1)}: ${r1.nome}`],
    [`Eu, Posseiro ${EXP.nome}, CPF nº:${EXP.cpf}, possuidor do imóvel`,
      `Eu, ${rotPosse(r1)} ${r1.nome}, CPF nº:${r1.cpf}, possuidor${r1.genero === "F" ? "a" : ""} do imóvel`],
    [`${EXP.nome}, brasileiro, maior, capaz, inscrito no CPF nº: ${EXP.cpf}`,
      `${r1.nome}, brasileir${o}, maior, capaz, ${inscrito(r1)} no CPF nº: ${r1.cpf}`],
    [`${EXP.nome}, brasileiro, maior, capaz, inscrito no CPF nº:${EXP.cpf}`,
      `${r1.nome}, brasileir${o}, maior, capaz, ${inscrito(r1)} no CPF nº:${r1.cpf}`],
    ["legítimo posseiro do imóvel", `legítim${o} posseir${o} do imóvel`],
    [EXP.nome, r1.nome],
    [EXP.cpf, r1.cpf],
    [EXP.rg, d.rg ?? ""],
    // imóvel / números
    [EXP.fazenda, d.denominacao.toUpperCase()],
    [EXP.areaTarefas, `${d.areaHa} ha/${calcTarefas(d.areaHa)} TAREFAS`],
    [`${EXP.perimetro} m`, `${d.perimetro} m`],
    [EXP.perimetro, d.perimetro],
    [EXP.sncr, d.sncrFmt],
    [EXP.trt, d.trt],
    ["39° WGr", `${d.mcAbs}° WGr`],
    // RT (mesmo profissional de exemplo dos modelos de matrícula)
    [EX.rtNome, d.rt.nome.toUpperCase()],
    ["TÉCNICO EM AGROPECUARIA", d.rt.formacao.toUpperCase()],
    ["técnico em agropecuária", d.rt.formacao.toLowerCase()],
    [EX.conselhoNumero, d.rt.conselhoNumero],
    [EX.conselhoNumeroSemTraco, d.rt.conselhoNumero.replace(/-/g, "")],
    [EX.conselhoSigla, d.rt.conselhoSigla],
    [EX.rtCpf, d.rt.cpf],
    [EX.identidade, d.rt.identidade],
    // endereço / datas / município
    [EXP.endereco, d.endereco],
    [EXP.dataExtenso, dataPorExtenso(d.dataStr)],
    [EXP.data, d.dataStr],
    ["FEIRA DE SANTANA-BA", `${muniUp}-${d.uf}`],
    ["FEIRA DE SANTANA - BA", `${muniUp} - ${d.uf}`],
    ["FEIRA DE SANTANA – BAHIA", `${muniUp} – ${ufExt}`],
    ["FEIRA DE SANTANA– BAHIA", `${muniUp}– ${ufExt}`],
    ["Feira de Santana, Bahia", `${d.municipio}, ${ufExt.charAt(0)}${ufExt.slice(1).toLowerCase()}`],
    ["FEIRA DE SANTANA", muniUp],
  ];
}

// cartas de anuência de posse: um bloco (1 confrontante) por trecho-pessoa
function gerarCartasPosse(xml: string, d: DadosPecas, mapa: [string, string][]): string {
  const bodyM = xml.match(/<w:body>([\s\S]*?)(<w:sectPr[\s\S]*?<\/w:sectPr>)?<\/w:body>/);
  if (!bodyM) throw new Error("Cartas: body não encontrado");
  const paras = bodyM[1].match(/<w:p[ >][\s\S]*?<\/w:p>|<w:tbl>[\s\S]*?<\/w:tbl>/g) ?? [];
  const inicios: number[] = [];
  paras.forEach((p, i) => { if (textoDoTrecho(p).trim() === "CARTA DE ANUÊNCIA") inicios.push(i); });
  if (inicios.length === 0) throw new Error("Cartas: título não encontrado");
  const prot = paras.slice(inicios[0], inicios.length > 1 ? inicios[1] : paras.length);

  const cartas: string[] = [];
  for (const t of d.trechos) {
    if (t.ehVia || t.pessoas.length === 0) continue;
    let bloco = prot.join("");
    bloco = mapearTabelas(bloco, EH_TBL_VERTICES, (tbl) =>
      reconstruirTabela(tbl, EH_LINHA_VERTICE, t.linhas.map(linhaVertice7)));
    bloco = substituirEmParagrafos(bloco, [
      [EXP.carta.nome, t.pessoas.map((p) => p.nome).join(" e ")],
      [EXP.carta.cpf, t.pessoas.map((p) => p.cpf ?? "—").join(" e ")],
      ...mapa,
    ]);
    cartas.push(bloco);
  }
  if (cartas.length === 0) cartas.push(substituirEmParagrafos(prot.join(""), mapa));
  const prefixo = paras.slice(0, inicios[0]).join("");
  return xml.replace(bodyM[0], `<w:body>${prefixo}${cartas.join("")}${bodyM[2] ?? ""}</w:body>`);
}

// Gera as 4 peças de posse. Chaves de tpl/saída: "1" memorial, "2" tabular,
// "3" cartas, "7" declaração de faixa de domínio (null quando não há via).
export function gerarPecasPosseXml(tpl: Record<string, string>, d: DadosPecas): Record<string, string | null> {
  const mapa = mapaPosse(d);
  const out: Record<string, string | null> = {};

  // ---- 1. MEMORIAL DESCRITIVO
  {
    let xml = tpl["1"];
    const corpo = corpoMemorialSigef(d);
    xml = xml.replace(/<w:p[ >][\s\S]*?<\/w:p>/g, (par) => {
      if (!textoDoTrecho(par).includes("Inicia-se a descrição")) return par;
      let primeiro = true;
      return par.replace(RE_WT_REESCRITA, (all, abre: string) => {
        const tag = abre.replace(/ xml:space="preserve"/, "") + ' xml:space="preserve"';
        if (primeiro) { primeiro = false; return `${tag}>${enc(corpo)}</w:t>`; }
        return `${tag}></w:t>`;
      });
    });
    out["1"] = substituirEmParagrafos(xml, mapa);
  }

  // ---- 2. MEMORIAL TABULAR
  {
    let xml = tpl["2"];
    const linhas = d.sigef.linhas.map((l) => [...linhaVertice7(l), d.confrontacaoDe(l.codigo)]);
    xml = mapearTabelas(xml, EH_TBL_VERTICES, (tbl) => reconstruirTabela(tbl, EH_LINHA_VERTICE, linhas));
    out["2"] = substituirEmParagrafos(xml, mapa);
  }

  // ---- 3. CARTAS DE ANUÊNCIA
  out["3"] = gerarCartasPosse(tpl["3"], d, mapa);

  // ---- 7. DECLARAÇÃO FAIXA DE DOMÍNIO (só com estrada/corredor/rio)
  out["7"] = gerarDeclaracoesVia(tpl["7"], d, mapa, EXP.via);

  return out;
}
