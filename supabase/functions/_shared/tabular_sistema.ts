// Memorial Tabular dos DADOS DO SISTEMA, pelo modelo da peça 2.
//
// A gerar-documentos emite com `tabular: true` — é o que os documentos de cada
// área de uma divisão (desmembramento ou partilha) pedem: o mesmo .docx que as
// peças usam (2-memorial-tabular.docx), com a tabela de vértices, coordenadas,
// azimutes, distâncias e confrontações do cálculo do próprio sistema, o mesmo
// do memorial e da planilha desta geração. Não é o tabular certificado: esse
// sai nas peças técnicas, do PDF do SIGEF.
//
// gerarPecasXml lê tpl["1"], tpl["2"], … sem guarda, então o conjunto INTEIRO
// de modelos desce e só a peça 2 é entregue — o mesmo princípio do `apenas` da
// gerar-pecas, que mantém o gerador intocado. O modelo é o do escritório (ou o
// padrão, que recebe o timbre automático da empresa na gerar-documentos), pelo
// mesmo baixarModelo do memorial.
import JSZip from "jszip";
import { gerarPecasPosseXml, gerarPecasXml } from "./pecas.ts";
import { montarDadosPecasDoCalculo } from "./pecas_dados.ts";
import type { ContextoPecas } from "./pecas_dados.ts";
import { baixarModelo } from "./modelos.ts";
import type { EscritorioModelos } from "./modelos.ts";

/** [chave interna, arquivo] dos modelos das peças — as mesmas chaves da gerar-pecas. */
export const MODELOS_PECAS_MATRICULA: readonly (readonly [string, string])[] = [
  ["1", "1-memorial-descritivo"], ["2", "2-memorial-tabular"], ["3", "3-cartas-anuencia"],
  ["4", "4-declaracao-tecnico"], ["5", "5-declaracao-proprietario"], ["6", "6-requerimento"],
  ["7", "7-declaracao-faixa-dominio"],
];
export const MODELOS_PECAS_POSSE: readonly (readonly [string, string])[] = [
  ["1", "1-memorial-descritivo"], ["2", "2-memorial-tabular"], ["3", "3-cartas-anuencia"],
  ["7", "4-declaracao-faixa-dominio"],
];

export const pastaDasPecas = (posse: boolean): string => (posse ? "pecas-posse" : "pecas");
export const modelosDasPecas = (posse: boolean) => (posse ? MODELOS_PECAS_POSSE : MODELOS_PECAS_MATRICULA);

/** Caminho do arquivo do tabular em cada versão do histórico (ao lado do memorial e da planilha). */
export const ARQUIVO_TABULAR_SISTEMA = "memorial-tabular.docx";

/**
 * O Memorial Tabular (zip do DOCX) a partir dos BYTES dos modelos (chave →
 * .docx). Puro, sem Storage: o teste monta com os modelos de reference/.
 */
export async function montarTabularDocx(
  modelos: Record<string, Uint8Array | ArrayBuffer>, ctx: ContextoPecas, posse: boolean,
): Promise<JSZip> {
  const xml: Record<string, string> = {};
  for (const [num, bytes] of Object.entries(modelos)) {
    xml[num] = await (await JSZip.loadAsync(bytes)).file("word/document.xml")!.async("string");
  }
  const dados = montarDadosPecasDoCalculo(ctx);
  const xmls = posse ? gerarPecasPosseXml(xml, dados) : gerarPecasXml(xml, dados);
  if (!xmls["2"]) throw new Error("o modelo da peça 2 não montou o memorial tabular");
  // os BYTES do modelo, não o zip lido acima: o zip é recriado para a saída
  const zip = await JSZip.loadAsync(modelos["2"]);
  zip.file("word/document.xml", xmls["2"]);
  return zip;
}

/**
 * Baixa o conjunto de modelos das peças do escritório do serviço. `caminhos`
 * diz de onde cada um veio (o "2" decide o timbre automático); `falta` é o
 * primeiro que não existe — sem ele o tabular não sai.
 */
export async function baixarModelosDasPecas(
  supa: Parameters<typeof baixarModelo>[0], esc: EscritorioModelos, posse: boolean,
): Promise<{ bytes: Record<string, Uint8Array>; caminhos: Record<string, string> } | { falta: string }> {
  const pasta = pastaDasPecas(posse);
  const bytes: Record<string, Uint8Array> = {};
  const caminhos: Record<string, string> = {};
  for (const [num, arquivo] of modelosDasPecas(posse)) {
    const dl = await baixarModelo(supa, esc, `${pasta}/${arquivo}.docx`);
    if (!dl.data || !dl.caminho) return { falta: `${pasta}/${arquivo}.docx` };
    bytes[num] = new Uint8Array(await dl.data.arrayBuffer());
    caminhos[num] = dl.caminho;
  }
  return { bytes, caminhos };
}
