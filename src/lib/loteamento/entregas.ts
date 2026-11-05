// Os arquivos de entrega do loteamento (planta, memoriais, quadro, KML, DXF,
// locação e os projetos de infraestrutura). Desde a auditoria de 04/11/2026
// eles saem do SERVIDOR (função `entregar`), que monta o projeto e o perímetro
// a partir do banco e confere o contorno do imóvel antes (0039): o crédito do
// loteamento vale para a gleba do serviço. A tela só pede e baixa.
import { fmt } from "./calculo.ts";
import type { Perimetro, Resultado } from "./calculo.ts";
import type { Projeto } from "./modelo.ts";
import { FORMATOS, LOCACAO_PADRAO, arquivoLocacao, gerarDxf, gerarKml, memorialDoLote, nomesDosPontos, pontosDeLocacao, quadroDeLotesCsv } from "./saidas.ts";
import type { FormatoLocacao, OpcoesLocacao, PontoLocacao } from "./saidas.ts";
import { gerarPlantaPdf } from "./planta.ts";
import type { DadosCarimbo, Folha } from "./planta.ts";
import { gerarDocx } from "./docx.ts";
import type { SecaoDocx } from "./docx.ts";
import { fmtAzimute } from "../../../supabase/functions/_shared/geo.ts";
import { dist } from "./geom.ts";
import { calcularInfra } from "./infra/index.ts";
import { pontosDasRedes } from "./infra/saidas.ts";
import { dxfRedes, memorialInfra, zipPlanilhas } from "./infra/saidas.ts";
import { gerarPlantasInfra } from "./infra/planta.ts";
import { MAX_ITENS_POR_PEDIDO, itensLoteALote, pacoteLoteALote } from "./loteALote.ts";

export type SaidaLoteamento =
  | "planta" | "memorial" | "memoriais" | "quadro" | "kml" | "dxf" | "locacao"
  | "infra-pranchas" | "infra-memorial" | "infra-planilhas" | "infra-dxf"
  /** lote a lote (loteALote.ts): a pasta de um lote / um zip com até 60 lotes e áreas públicas */
  | "lote" | "lotes";

export const SAIDAS_LOTEAMENTO: SaidaLoteamento[] = [
  "planta", "memorial", "memoriais", "quadro", "kml", "dxf", "locacao",
  "infra-pranchas", "infra-memorial", "infra-planilhas", "infra-dxf",
  "lote", "lotes",
];

export interface PedidoLoteamento {
  saida: SaidaLoteamento;
  folha?: Folha;
  formato?: FormatoLocacao;
  op?: OpcoesLocacao;
  /** PVs, postes, hidrantes e reservatório também vão para a coletora */
  locarRedes?: boolean;
  /** lote a lote: ids dos lotes e das áreas públicas (o servidor confere com `conferirItens`) */
  ids?: string[];
}

/** O que os documentos leem do serviço. */
export interface ServicoLoteamento {
  municipio?: string | null; uf?: string | null; detentor_nome?: string | null; detentor_cpf?: string | null;
  denominacao?: string | null; matricula?: string | null; fuso_utm?: number | null;
}

export interface Arquivo { dados: Uint8Array; nome: string; tipo: string }

export const nomeArquivo = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "").toUpperCase() || "LOTEAMENTO";

const texto = (s: string) => new TextEncoder().encode(s);
const bytesDe = async (b: Blob | Uint8Array): Promise<Uint8Array> => (b instanceof Uint8Array ? b : new Uint8Array(await b.arrayBuffer()));

/** Pontos do arquivo de locação (a tela usa para a prévia e a contagem). */
export function pontosParaLocacao(res: Resultado, perimetro: Perimetro, projeto: Projeto, op: OpcoesLocacao = LOCACAO_PADRAO, locarRedes = false): PontoLocacao[] {
  const base0 = pontosDeLocacao(res, perimetro, op);
  if (!locarRedes) return base0;
  try { return [...base0, ...pontosDasRedes(res, calcularInfra(res, projeto))]; } catch { return base0; }
}

/**
 * "01 a 12" — ou, no loteamento importado com a numeração da planta aprovada
 * (lote 12 sem o 11, quadra que começa no 5), os trechos: "05 a 09, 11 e 12".
 */
export function numeracaoDaQuadra(nums: number[]): string {
  const ns = [...new Set(nums)].sort((a, b) => a - b);
  if (!ns.length) return "—";
  const p2 = (n: number) => String(n).padStart(2, "0");
  const faixas: string[] = [];
  for (let i = 0; i < ns.length;) {
    let j = i;
    while (j + 1 < ns.length && ns[j + 1] === ns[j] + 1) j++;
    faixas.push(j === i ? p2(ns[i]) : j === i + 1 ? `${p2(ns[i])}, ${p2(ns[j])}` : `${p2(ns[i])} a ${p2(ns[j])}`);
    i = j + 1;
  }
  return faixas.length > 1 ? `${faixas.slice(0, -1).join(", ")} e ${faixas[faixas.length - 1]}` : faixas[0];
}

function secoesMemorialGeral(projeto: Projeto, res: Resultado, perimetro: Perimetro, servico: ServicoLoteamento, c: DadosCarimbo): SecaoDocx[] {
  const fuso = servico.fuso_utm ?? 24;
  const q = res.quadro;
  const pct = (v: number) => `${fmt((100 * v) / q.gleba)}%`;
  const p = projeto.params;
  const perimetroM = res.ladosGleba.reduce((s, l) => s + dist(l.a, l.b), 0);
  return [
    {
      titulo: "MEMORIAL DESCRITIVO DO LOTEAMENTO",
      subtitulo: projeto.nome.toUpperCase(),
      paragrafos: [
        `1. IDENTIFICAÇÃO. Loteamento ${projeto.nome}, implantado em gleba${servico.denominacao ? ` denominada ${servico.denominacao}` : ""}${servico.matricula ? `, objeto da matrícula nº ${servico.matricula}` : ""}${servico.municipio ? `, no município de ${servico.municipio}${servico.uf ? `/${servico.uf}` : ""}` : ""}${servico.detentor_nome ? `, de propriedade de ${servico.detentor_nome}${servico.detentor_cpf ? ` (CPF/CNPJ ${servico.detentor_cpf})` : ""}` : ""}, com área total de ${fmt(q.gleba)} m² (${fmt(q.gleba / 1e4, 4)} ha) e perímetro de ${fmt(perimetroM)} m.`,
        `2. DESCRIÇÃO SUCINTA. O loteamento é composto de ${res.quadras.length} quadras e ${q.lotes.qtd} lotes, com lote padrão de ${fmt(p.frente)} m de frente por ${fmt(p.profundidade)} m de profundidade (${fmt(p.frente * p.profundidade)} m²), sistema viário com ${res.ruas.length} vias e ${res.publicas.length} áreas públicas, conforme o quadro de áreas abaixo.`,
      ],
      tabela: [
        ["Especificação", "Área (m²)", "%"],
        [`Lotes (${q.lotes.qtd})`, fmt(q.lotes.area), pct(q.lotes.area)],
        ["Sistema viário", fmt(q.viario), pct(q.viario)],
        ["Áreas verdes", fmt(q.verde + q.lazer), pct(q.verde + q.lazer)],
        ["Área institucional", fmt(q.institucional), pct(q.institucional)],
        ...(q.app > 0 ? [["APP / faixa non aedificandi", fmt(q.app), pct(q.app)]] : []),
        ...(q.sobras > 0 ? [["Remanescente", fmt(q.sobras), pct(q.sobras)]] : []),
        ["Total da gleba", fmt(q.gleba), "100,00%"],
      ],
    },
    {
      titulo: "3. CONDIÇÕES URBANÍSTICAS E RESTRIÇÕES",
      paragrafos: [
        `Lotes entre ${fmt(p.areaMin)} e ${fmt(p.areaMax)} m², com frente de ${fmt(p.frenteMin)} a ${fmt(p.frenteMax)} m e profundidade de ${fmt(p.profundidadeMin)} a ${fmt(p.profundidadeMax)} m (mínimos conforme a Lei Federal 6.766/79, art. 4º, II, observada a legislação municipal).`,
        `Vias com largura total de ${fmt(p.ruaLargura)} m, sendo ${fmt(p.ruaPista)} m de pista de rolamento e ${fmt(Math.max(0, (p.ruaLargura - p.ruaPista) / 2))} m de passeio de cada lado. ${p.esquina === "raio" ? `Esquinas concordadas em curva de raio ${fmt(p.esquinaValor)} m no alinhamento predial.` : p.esquina === "chanfro" ? `Esquinas chanfradas em ${fmt(p.esquinaValor)} m em cada alinhamento.` : ""}`,
        `Quadras com comprimento máximo de ${fmt(p.quadraCompMax, 0)} m.`,
        ...(q.app > 0 ? ["As faixas de preservação permanente e non aedificandi indicadas na planta não integram os lotes."] : []),
      ],
    },
    {
      titulo: "4. QUADRAS",
      paragrafos: [],
      tabela: [["Quadra", "Lotes", "Numeração", "Área dos lotes (m²)"], ...res.quadras.map((qq) => [qq.nome, String(qq.lotes.length), numeracaoDaQuadra(qq.lotes.map((l) => l.numero)), fmt(qq.lotes.reduce((s, l) => s + l.area, 0))])],
    },
    {
      titulo: "5. SISTEMA VIÁRIO",
      paragrafos: [],
      tabela: [["Via", "Largura (m)", "Extensão (m)", "Área (m²)"], ...res.ruas.map((r) => [r.nome, fmt(r.largura), fmt(r.comprimento, 1), fmt(r.area)])],
    },
    {
      titulo: "6. ÁREAS PÚBLICAS",
      paragrafos: ["Passam a integrar o domínio do Município, desde a data de registro do loteamento, as vias, as áreas verdes e as áreas destinadas a equipamentos comunitários abaixo (Lei 6.766/79, art. 22)."],
      tabela: [["Área", "m²", "% da gleba"], ...res.publicas.map((a) => [a.nome, fmt(a.area), pct(a.area)])],
    },
    {
      titulo: "7. PERÍMETRO DA GLEBA",
      paragrafos: res.ladosGleba.map((l, i) => {
        const az = (Math.atan2(l.b[0] - l.a[0], l.b[1] - l.a[1]) * 180) / Math.PI;
        const conf = l.tipo === "via" ? (l.nome || "estrada existente") : (perimetro.confrontantes[i] ?? "—");
        const de = perimetro.nomes?.[i] ?? `P${i + 1}`, ate = perimetro.nomes?.[(i + 1) % res.ladosGleba.length] ?? `P${((i + 1) % res.ladosGleba.length) + 1}`;
        return `Do vértice ${de} ao ${ate}: azimute ${fmtAzimute((az + 360) % 360)}, ${fmt(dist(l.a, l.b))} m, confrontando com ${conf}.`;
      }),
    },
    {
      titulo: "8. RESPONSABILIDADE TÉCNICA",
      paragrafos: [
        `${c.rt || "Responsável técnico"}${c.rtRegistro ? ` — ${c.rtRegistro}` : ""}${c.trt ? ` — ART/TRT ${c.trt}` : ""}.`,
        `Coordenadas no SGR SIRGAS 2000, projeção UTM fuso ${fuso}S; ${res.plano.terreno ? `distâncias e áreas no plano topográfico (fator de escala combinado k = ${res.plano.k.toFixed(8)})` : "distâncias e áreas no plano UTM"}.`,
        `${servico.municipio || ""}${servico.uf ? `/${servico.uf}` : ""}, ${new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric", timeZone: "America/Bahia" })}.`,
      ],
    },
  ];
}

/** Gera um arquivo de entrega. Quem chama já conferiu acesso, crédito e contorno. */
export async function arquivoDoLoteamento(
  pedido: PedidoLoteamento, projeto: Projeto, res: Resultado, perimetro: Perimetro, servico: ServicoLoteamento, carimbo: DadosCarimbo,
): Promise<Arquivo> {
  const base = nomeArquivo(projeto.nome);
  const fuso = servico.fuso_utm ?? 24;
  const folha: Folha = pedido.folha && ["A0", "A1", "A2", "A3"].includes(pedido.folha) ? pedido.folha : "A1";
  const dadosLote = { loteamento: projeto.nome, municipio: servico.municipio ?? "", uf: servico.uf ?? "", proprietario: servico.detentor_nome ?? "", fuso };
  switch (pedido.saida) {
    case "planta":
      return { dados: await gerarPlantaPdf(res, projeto, perimetro, carimbo, folha), nome: `PLANTA_LOTEAMENTO_${base}_${folha}.pdf`, tipo: "application/pdf" };
    case "memorial": {
      const blob = await gerarDocx(secoesMemorialGeral(projeto, res, perimetro, servico, carimbo), `${projeto.nome} — memorial descritivo do loteamento`);
      return { dados: await bytesDe(blob), nome: `MEMORIAL_DO_LOTEAMENTO_${base}.docx`, tipo: blob.type };
    }
    case "memoriais": {
      const nomes = nomesDosPontos(pontosDeLocacao(res, perimetro, LOCACAO_PADRAO));
      const secoes: SecaoDocx[] = [];
      for (const q of res.quadras) for (const l of [...q.lotes].sort((a, b) => a.numero - b.numero)) {
        const m = memorialDoLote(l, res, nomes, dadosLote);
        secoes.push({ titulo: "MEMORIAL DESCRITIVO", subtitulo: m.titulo, paragrafos: m.paragrafos, quebraAntes: secoes.length > 0 });
      }
      const blob = await gerarDocx(secoes, `${projeto.nome} — memoriais descritivos dos lotes`);
      return { dados: await bytesDe(blob), nome: `MEMORIAIS_DOS_LOTES_${base}.docx`, tipo: blob.type };
    }
    case "quadro":
      return { dados: texto(quadroDeLotesCsv(res, projeto)), nome: `QUADRO_DE_LOTES_${base}.csv`, tipo: "text/csv;charset=utf-8" };
    case "kml":
      return { dados: texto(gerarKml(res, fuso, projeto.nome)), nome: `${base}.kml`, tipo: "application/vnd.google-earth.kml+xml" };
    case "dxf": {
      const pontos = pontosParaLocacao(res, perimetro, projeto, pedido.op ?? LOCACAO_PADRAO, !!pedido.locarRedes);
      return { dados: texto(gerarDxf(res, pontos)), nome: `PROJETO_${base}.dxf`, tipo: "application/dxf" };
    }
    case "locacao": {
      const formato: FormatoLocacao = FORMATOS.some((f) => f.id === pedido.formato) ? pedido.formato! : "csv-nome-e-n";
      const pontos = pontosParaLocacao(res, perimetro, projeto, pedido.op ?? LOCACAO_PADRAO, !!pedido.locarRedes);
      const sufixo = `SIRGAS2000_UTM${fuso}S`;
      if (formato === "dxf") return { dados: texto(gerarDxf(res, pontos)), nome: `LOCACAO_${base}_${sufixo}.dxf`, tipo: "application/dxf" };
      const f = FORMATOS.find((x) => x.id === formato)!;
      return { dados: texto(arquivoLocacao(pontos, formato)), nome: `LOCACAO_${base}_${sufixo}.${f.ext}`, tipo: "text/plain;charset=utf-8" };
    }
    case "infra-pranchas": {
      const r = calcularInfra(res, projeto);
      return { dados: await gerarPlantasInfra(res, projeto, r, carimbo, folha), nome: `PROJETOS_DE_INFRAESTRUTURA_${base}_${folha}.pdf`, tipo: "application/pdf" };
    }
    case "infra-memorial": {
      const r = calcularInfra(res, projeto);
      const secoes = memorialInfra(res, projeto, r, { municipio: servico.municipio ?? "", uf: servico.uf ?? "", rt: carimbo.rt, rtRegistro: carimbo.rtRegistro, trt: carimbo.trt });
      const blob = await gerarDocx(secoes, `${projeto.nome} — projetos de infraestrutura`);
      return { dados: await bytesDe(blob), nome: `MEMORIAL_INFRAESTRUTURA_${base}.docx`, tipo: blob.type };
    }
    case "infra-planilhas": {
      const r = calcularInfra(res, projeto);
      return { dados: await bytesDe(await zipPlanilhas(res, r, base)), nome: `PLANILHAS_INFRAESTRUTURA_${base}.zip`, tipo: "application/zip" };
    }
    case "infra-dxf": {
      const r = calcularInfra(res, projeto);
      return { dados: texto(dxfRedes(res, r)), nome: `REDES_${base}.dxf`, tipo: "application/dxf" };
    }
    case "lote":
    case "lotes": {
      // sem ids (chamada direta do módulo): o primeiro lote / os primeiros 60
      const todos = itensLoteALote(res);
      const pedidos = new Set(pedido.ids ?? []);
      const escolhidos = pedidos.size ? todos.filter((x) => pedidos.has(x.id)) : todos;
      const itens = escolhidos.slice(0, pedido.saida === "lote" ? 1 : MAX_ITENS_POR_PEDIDO);
      if (!itens.length) throw new Error("Nenhum lote para gerar.");
      const dados = await pacoteLoteALote({ itens, formato: pedido.formato }, projeto, res, perimetro, servico, carimbo);
      const nome = itens.length === 1 ? `${itens[0].arquivo}_${base}.zip` : `LOTES_${base}.zip`;
      return { dados, nome, tipo: "application/zip" };
    }
  }
  throw new Error("Arquivo de loteamento desconhecido.");
}
