// Importar um loteamento PRONTO (já dividido no CAD, no QGIS ou no Google
// Earth): DXF, KML/KMZ ou GeoJSON → o projeto do sistema, com prévia, resumo e
// avisos antes de aplicar (passo Perguntas, "Já tem o loteamento pronto?").
//
//   lerArquivoLoteamento: bytes do arquivo → feições em UTM do fuso do serviço
//   montarLoteamento (montar.ts): feições → projeto (quadras com os lotes do
//   arquivo, áreas públicas, viário com corpo próprio) + resultado + avisos
//
// O projeto importado mora no mesmo `loteamentos.projeto` (jsonb) e o servidor
// o recalcula igual — os arquivos de entrega continuam saindo do banco.
import proj4mod from "proj4";
import { GEO_DEF, utmDef } from "../../../../supabase/functions/_shared/geo.ts";
import type { Pt } from "../geom.ts";
import type { Perimetro } from "../calculo.ts";
import type { Projeto } from "../modelo.ts";
import { lerDxf } from "./dxf.ts";
import { kmlDoKmz, lerKmlLoteamento } from "./kml.ts";
import type { FeicaoKml } from "./kml.ts";
import { lerGeoJson } from "./geojson.ts";
import { classeDoNome, nomeDaArea, nomeDaQuadra, normalizar, numeroDoLote, papelDoTexto } from "./texto.ts";
import type { Classe } from "./texto.ts";
import { montarLoteamento } from "./montar.ts";
import type { DesenhoImportado, Feicao, Importacao } from "./montar.ts";

export type { DesenhoImportado, Feicao, Importacao, ResumoImportacao } from "./montar.ts";
export { montarLoteamento, parametrosDosLotes } from "./montar.ts";
export { lerDxf } from "./dxf.ts";
export { lerKmlLoteamento } from "./kml.ts";
export { lerGeoJson } from "./geojson.ts";

const proj = proj4mod as unknown as (from: string, to: string, c: [number, number]) => [number, number];

/** Extensões que a importação aceita (o seletor de arquivo da tela usa). */
export const EXTENSOES_IMPORTACAO = ".dxf,.kml,.kmz,.geojson,.json";

/** Texto do arquivo: UTF-8; se não for (DXF antigo em ANSI), Windows-1252. */
export function decodificar(bytes: Uint8Array): string {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { return new TextDecoder("windows-1252").decode(bytes); }
}

const ESTILOS: Record<string, Classe> = {
  lote: "lote", esquina: "lote", verde: "verde", institucional: "institucional", app: "app", lazer: "lazer",
  perimetro: "contorno", eixo: "eixo", rua: "viario",
};

function feicaoDoKml(f: FeicaoKml, paraUtm: (p: [number, number]) => Pt): Feicao | null {
  const pts = f.pts.map(paraUtm).filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (!pts.length) return null;
  const origem = [...f.pastas, f.nome ?? ""].filter(Boolean).join(" / ") || "KML";
  if (f.geo === "ponto") {
    return f.nome ? { geo: "texto", pts, classe: "nada", origem, texto: f.nome, papel: classeDoNome(f.pastas.join(" ")) === "lote" ? "lote" : "?", curto: true, altura: 1 } : null;
  }
  // classe: o estilo (o KML do sistema), o nome do Placemark, a pasta (de dentro para fora)
  let classe: Classe = (f.estilo && ESTILOS[normalizar(f.estilo).replace(/ /g, "")]) || "?";
  const area = f.nome ? nomeDaArea(f.nome) : null;
  const lote = f.nome ? numeroDoLote(f.nome, true) : null;
  const qNome = f.nome ? nomeDaQuadra(f.nome) : null;
  if (classe === "?") {
    if (area) classe = area.classe;
    else if (qNome && f.geo === "poligono") classe = "quadra";
    else if (f.nome) { const c = classeDoNome(f.nome); if (c !== "?" && c !== "nada") classe = c; }
  }
  let quadraPasta: string | undefined;
  for (const p of [...f.pastas].reverse()) {
    const q = nomeDaQuadra(p);
    if (q && !quadraPasta) quadraPasta = q;
    if (classe === "?") { const c = classeDoNome(p); if (c !== "?" && c !== "nada") classe = c; }
  }
  // polígono dentro da pasta "Quadra A" que não diz ser a quadra é lote dela
  if (classe === "quadra" && quadraPasta && !qNome) classe = "lote";
  if (classe === "?" && lote && f.geo === "poligono") classe = "lote";
  if (f.geo === "linha" && classe === "?" && f.nome && /^(rua|avenida|av\.|alameda|travessa|estrada|via)\b/i.test(f.nome)) classe = "eixo";
  return {
    geo: f.geo === "linha" ? "linha" : "poligono", pts, classe, origem,
    ...(f.nome ? { texto: f.nome, nome: area?.nome ?? f.nome } : {}),
    ...(classe === "lote" && lote ? { numero: lote.numero, ...(lote.quadra || quadraPasta ? { quadra: lote.quadra ?? quadraPasta } : {}) } : {}),
    ...(classe === "lote" && !lote && quadraPasta ? { quadra: quadraPasta } : {}),
    ...(classe === "quadra" && qNome ? { quadra: qNome } : {}),
  };
}

/** Propriedade pelo nome, sem diferenciar maiúscula, acento ou separador. */
function prop(props: Record<string, unknown>, nomes: string[]): unknown {
  for (const [k, v] of Object.entries(props)) if (nomes.includes(normalizar(k).replace(/ /g, "_")) && v !== null && v !== undefined && v !== "") return v;
  return undefined;
}

/**
 * Lê o arquivo e devolve as feições em UTM (SIRGAS 2000, fuso do serviço). O
 * DXF vem como está (o CAD não diz o sistema); KML é lon/lat; GeoJSON é lon/lat
 * ou o UTM que o "crs" disser.
 */
export async function lerArquivoLoteamento(nome: string, bytes: Uint8Array, fuso: number): Promise<DesenhoImportado> {
  const ext = (/\.([a-z0-9]+)$/i.exec(nome)?.[1] ?? "").toLowerCase();
  const ud = utmDef(fuso);
  const deLonLat = (p: [number, number]): Pt => { try { return proj(GEO_DEF, ud, p); } catch { return [NaN, NaN]; } };
  const avisos: string[] = [];
  if (ext === "dxf") {
    const d = lerDxf(decodificar(bytes));
    const feicoes: Feicao[] = [];
    for (const p of d.polilinhas) {
      const classe = classeDoNome(p.camada);
      // eixo fechado (rua em anel) continua linha: volta ao primeiro ponto
      if (p.fechada && p.pts.length >= 3 && classe !== "eixo") feicoes.push({ geo: "poligono", pts: p.pts, classe, origem: p.camada });
      else feicoes.push({ geo: "linha", pts: p.fechada ? [...p.pts, p.pts[0]] : p.pts, classe, origem: p.camada });
    }
    for (const t of d.textos) feicoes.push({ geo: "texto", pts: [t.p], classe: "nada", origem: t.camada, texto: t.texto, papel: papelDoTexto(t.camada), altura: t.altura, rot: t.rot });
    const ign = Object.entries(d.ignorados).filter(([t]) => t !== "CIRCLE" && t !== "DIMENSION");
    if (ign.length) avisos.push(`Ficaram de fora do DXF: ${ign.map(([t, n]) => `${n} ${t}`).join(", ")} (blocos, hachuras e splines não são lidos — explode os blocos no CAD se os lotes estiverem dentro deles).`);
    // linhas soltas (lotes desenhados com LINE, sem polilinha fechada): ainda não são costuradas
    const soltas = feicoes.filter((f) => f.geo === "linha" && (f.classe === "lote" || f.classe === "quadra")).length;
    if (soltas) avisos.push(`${soltas} linha(s) aberta(s) nas camadas de lote/quadra não formam polígono e ficaram de fora — no CAD, feche os lotes como polilinhas (comando BOUNDARY/PEDIT).`);
    return { arquivo: nome, formato: "DXF", feicoes, avisos, projetado: true };
  }
  if (ext === "kml" || ext === "kmz") {
    const texto = ext === "kmz" ? await kmlDoKmz(bytes) : decodificar(bytes);
    const feicoes = lerKmlLoteamento(texto).map((f) => feicaoDoKml(f, deLonLat)).filter((f): f is Feicao => !!f);
    return { arquivo: nome, formato: ext === "kmz" ? "KMZ" : "KML", feicoes, avisos, projetado: false };
  }
  if (ext === "geojson" || ext === "json") {
    const g = lerGeoJson(decodificar(bytes));
    const conv = g.sistema === "lonlat" ? deLonLat
      : g.sistema.fuso && g.sistema.fuso !== fuso
        ? ((de: string) => (p: [number, number]): Pt => { try { return proj(GEO_DEF, ud, proj(de, GEO_DEF, p)); } catch { return [NaN, NaN]; } })(utmDef(g.sistema.fuso))
        : (p: [number, number]): Pt => [p[0], p[1]];
    if (g.sistema !== "lonlat" && g.sistema.fuso && g.sistema.fuso !== fuso) avisos.push(`O GeoJSON está no fuso ${g.sistema.fuso} e foi convertido para o fuso ${fuso} do serviço.`);
    const feicoes: Feicao[] = [];
    for (const f of g.feicoes) {
      const pts = f.pts.map(conv).filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
      if (!pts.length) continue;
      const tipo = prop(f.props, ["tipo", "type", "classe", "class", "categoria", "category", "camada", "layer", "uso", "destinacao", "natureza", "feicao", "feature"]);
      const nomeP = prop(f.props, ["nome", "name", "rotulo", "label", "titulo", "denominacao", "descricao", "description"]);
      const numP = prop(f.props, ["lote", "numero", "num", "nr", "n_lote", "lote_num", "numero_lote", "num_lote", "lot", "lot_number", "number"]);
      const qP = prop(f.props, ["quadra", "qd", "quadra_id", "num_quadra", "block", "bloco"]);
      const numero = numP === undefined ? undefined : typeof numP === "number" ? numP : numeroDoLote(String(numP), true)?.numero;
      const quadra = qP === undefined ? undefined : nomeDaQuadra(String(qP), true) ?? String(qP);
      const nomeTxt = nomeP === undefined ? undefined : String(nomeP);
      if (f.geo === "ponto") {
        if (nomeTxt || numero !== undefined) feicoes.push({ geo: "texto", pts, classe: "nada", origem: "GeoJSON", texto: nomeTxt ?? String(numero), papel: numero !== undefined ? "lote" : "?", curto: true, altura: 1 });
        continue;
      }
      let classe: Classe = tipo !== undefined ? classeDoNome(String(tipo)) : "?";
      if (classe === "nada") classe = "?";
      const area = nomeTxt ? nomeDaArea(nomeTxt) : null;
      if (classe === "?" && area) classe = area.classe;
      if (classe === "?" && numero !== undefined && f.geo === "poligono") classe = "lote";
      if (classe === "?" && quadra && f.geo === "poligono") classe = "quadra";
      const doNome = classe === "lote" && numero === undefined && nomeTxt ? numeroDoLote(nomeTxt, true) : null;
      feicoes.push({
        geo: f.geo === "linha" ? "linha" : "poligono", pts, classe, origem: tipo !== undefined ? String(tipo) : "GeoJSON",
        ...(nomeTxt ? { texto: nomeTxt, nome: area?.nome ?? nomeTxt } : {}),
        ...(classe === "lote" && (numero !== undefined || doNome) ? { numero: numero ?? doNome!.numero } : {}),
        ...(quadra ?? doNome?.quadra ? { quadra: quadra ?? doNome!.quadra } : {}),
      });
    }
    return { arquivo: nome, formato: "GeoJSON", feicoes, avisos, projetado: g.sistema !== "lonlat" };
  }
  if (ext === "dwg") throw new Error("DWG não dá para ler direto: no CAD, salve como DXF (ASCII) e importe o DXF.");
  throw new Error("Formato não reconhecido. Importe um DXF, KML, KMZ ou GeoJSON.");
}

/** Lê e monta. */
export async function importarLoteamento(arquivo: { nome: string; bytes: Uint8Array }, base: Projeto, perimetro: Perimetro, fuso: number): Promise<Importacao> {
  const d = await lerArquivoLoteamento(arquivo.nome, arquivo.bytes, fuso);
  return montarLoteamento(d, base, perimetro, fuso);
}

/** O que a tela chama: importa num Web Worker; se o navegador não deixar, aqui mesmo. */
export function importarEmSegundoPlano(arquivo: { nome: string; bytes: Uint8Array }, base: Projeto, perimetro: Perimetro, fuso: number): Promise<Importacao> {
  return new Promise((resolve, reject) => {
    let w: Worker;
    const aqui = () => { importarLoteamento(arquivo, base, perimetro, fuso).then(resolve, reject); };
    try {
      w = new Worker(new URL("./importar.worker.ts", import.meta.url), { type: "module" });
    } catch { aqui(); return; }
    w.onmessage = (e: MessageEvent<{ ok: boolean; imp?: Importacao; erro?: string }>) => {
      w.terminate();
      if (e.data.ok && e.data.imp) resolve(e.data.imp); else reject(new Error(e.data.erro ?? "A importação falhou."));
    };
    w.onerror = () => { w.terminate(); aqui(); };
    w.postMessage({ nome: arquivo.nome, bytes: arquivo.bytes, base, perimetro, fuso });
  });
}
