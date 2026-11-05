// Imagem da assinatura do RESPONSÁVEL TÉCNICO nos documentos gerados.
//
// É uma IMAGEM da assinatura (PNG com fundo transparente, enviada em
// Configurações → Responsáveis), não assinatura digital ICP-Brasil: não tem
// valor de certificado, só poupa assinar à mão as vias impressas.
//
// Onde mora: templates/escritorios/{escritório}/assinaturas/rt-{id do RT}.png
// (a pasta do escritório no bucket `templates`, a mesma dos modelos — as
// políticas de Storage da 0020 já dão a cada escritório só a pasta dele).
// Entra quando existe a imagem E o RT está com `assinar_com_imagem` ligado
// (padrão: ligado; coluna da migração 0043).
//
// DOCX (memorial, tabular, peças): `aplicarAssinaturaRt` mexe só no
// word/document.xml já pronto e na mídia do pacote:
//   1. marcador {{ASSINATURA_RT}} no modelo da empresa → a imagem entra ali
//      (sem imagem, o marcador some);
//   2. sem marcador: o parágrafo de assinatura do RT é o que traz SÓ o nome
//      dele (ou "Responsável Técnico: NOME", ou "NOME - CREA …"); a imagem
//      ocupa o parágrafo vazio logo acima (o espaço de assinar dos modelos), ou
//      entra acima da linha "____" quando houver uma;
//   3. nada reconhecível: o documento sai como sempre saiu.
//
// Módulo SEM dependência de execução (só tipos): no ar, o gerar-pecas tem um
// _shared próprio, e este arquivo precisa ir junto dele.
import type JSZip from "jszip";

export interface AssinaturaRt {
  bytes: Uint8Array;
  tipo: "png";
}

export const MARCADOR_ASSINATURA = "{{ASSINATURA_RT}}";
const RID = "rIdAssinaturaRt";
const MIDIA = "media/assinatura-rt.png";
const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_V = "urn:schemas-microsoft-com:vml";
const NS_O = "urn:schemas-microsoft-com:office:office";
const NS_PKG = "http://schemas.openxmlformats.org/package/2006/relationships";
/** Altura da assinatura no papel (pt) e largura máxima: cabe no espaço de assinar. */
const ALTURA_PT = 36, LARGURA_MAX_PT = 170;

/** Caminho da imagem no bucket `templates`. */
export function caminhoAssinaturaRt(escritorioId: string, rtId: string): string {
  return `escritorios/${escritorioId}/assinaturas/rt-${rtId}.png`;
}

interface Baixavel {
  storage: { from: (b: string) => { download: (n: string) => Promise<{ error: unknown; data: Blob | null }> } };
}

/** A assinatura do RT do serviço, ou null (sem RT, sem imagem, ou desligada). */
export async function carregarAssinaturaRt(
  supa: unknown,
  escritorioId: string | null | undefined,
  rt: { id?: string | null; assinar_com_imagem?: boolean | null } | null | undefined,
): Promise<AssinaturaRt | null> {
  if (!escritorioId || !rt?.id || rt.assinar_com_imagem === false) return null;
  try {
    const dl = await (supa as Baixavel).storage.from("templates").download(caminhoAssinaturaRt(escritorioId, rt.id));
    if (dl.error || !dl.data) return null;
    const bytes = new Uint8Array(await dl.data.arrayBuffer());
    return ehPng(bytes) ? { bytes, tipo: "png" } : null;
  } catch {
    return null;
  }
}

export function ehPng(b: Uint8Array): boolean {
  return b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
}

function dimensoesPng(b: Uint8Array): { w: number; h: number } {
  const u32 = (o: number) => (b[o] << 24 | b[o + 1] << 16 | b[o + 2] << 8 | b[o + 3]) >>> 0;
  const w = u32(16), h = u32(20);
  return w > 0 && h > 0 ? { w, h } : { w: 3, h: 1 };
}

/** Tamanho no papel (pt), na proporção da imagem. */
export function medidasAssinatura(a: AssinaturaRt): { w: number; h: number } {
  const { w, h } = dimensoesPng(a.bytes);
  let hp = ALTURA_PT, wp = (w / h) * hp;
  if (wp > LARGURA_MAX_PT) { wp = LARGURA_MAX_PT; hp = (h / w) * wp; }
  return { w: Math.round(wp * 10) / 10, h: Math.round(hp * 10) / 10 };
}

// ------------------------------------------------------------ parágrafos
const dec = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const RE_WT = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
export const textoDoParagrafo = (p: string) => dec([...p.matchAll(RE_WT)].map((m) => m[1]).join(""));

/** Parágrafos-folha (sem parágrafo dentro: caixas de texto ficam de fora). */
export function paragrafos(xml: string): { ini: number; fim: number; xml: string }[] {
  const re = /<w:p(?=[\s>/])[^>]*?(\/?)>|<\/w:p>/g;
  const pilha: { ini: number; filho: boolean }[] = [];
  const out: { ini: number; fim: number; xml: string }[] = [];
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    if (m[0] === "</w:p>") {
      const a = pilha.pop();
      if (!a) continue;
      if (!a.filho) out.push({ ini: a.ini, fim: m.index + 6, xml: xml.slice(a.ini, m.index + 6) });
      if (pilha.length) pilha[pilha.length - 1].filho = true;
    } else if (m[1] === "/") {
      out.push({ ini: m.index, fim: m.index + m[0].length, xml: m[0] });
      if (pilha.length) pilha[pilha.length - 1].filho = true;
    } else {
      pilha.push({ ini: m.index, filho: false });
    }
  }
  return out.sort((a, b) => a.ini - b.ini);
}

const normal = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toUpperCase();
const RE_ROTULO = /^(RESPONSAVEL TECNICO|TECNICO RESPONSAVEL|RT)\s*:?\s*/;

/** O parágrafo é a linha de assinatura do RT (só o nome, com rótulo ou registro)? */
export function ehLinhaDoRt(texto: string, nomeRt: string): boolean {
  const nome = normal(nomeRt);
  if (nome.length < 5) return false;
  const t = normal(texto).replace(RE_ROTULO, "").replace(/^_{3,}\s*/, "");
  if (t === nome) return true;
  // "NOME - CREA : … - TRT: …" (memorial montado em código), "NOME, CFTA …"
  return t.length <= 160 && t.startsWith(nome) && /^\s*[-–,]\s/.test(t.slice(nome.length) + " ");
}

const vazio = (p: string) => !textoDoParagrafo(p).trim() && !/<w:(drawing|pict|object|br\b[^>]*w:type="page")/.test(p);
const ehTracejado = (p: string) => /_{5,}\s*$/.test(textoDoParagrafo(p).trim()) && textoDoParagrafo(p).trim().length < 120;

function pPrDe(p: string): string {
  const m = p.match(/<w:pPr>[\s\S]*?<\/w:pPr>/);
  if (!m) return "";
  // o parágrafo da imagem não herda numeração, quebra de página nem bordas
  return m[0].replace(/<w:numPr>[\s\S]*?<\/w:numPr>/, "").replace(/<w:pageBreakBefore[^>]*\/>/, "")
    .replace(/<w:pBdr>[\s\S]*?<\/w:pBdr>/, "").replace(/<w:spacing\b[^>]*\/>/, "").replace(/<w:rPr>[\s\S]*?<\/w:rPr>/, "");
}

function runImagem(a: AssinaturaRt, comShapetype: boolean): string {
  const { w, h } = medidasAssinatura(a);
  const st = comShapetype
    ? `<v:shapetype id="_x0000_t75" coordsize="21600,21600" o:spt="75" o:preferrelative="t" path="m@4@5l@4@11@9@11@9@5xe" filled="f" stroked="f"><v:stroke joinstyle="miter"/><v:formulas><v:f eqn="if lineDrawn pixelLineWidth 0"/><v:f eqn="sum @0 1 0"/><v:f eqn="sum 0 0 @1"/><v:f eqn="prod @2 1 2"/><v:f eqn="prod @3 21600 pixelWidth"/><v:f eqn="prod @3 21600 pixelHeight"/><v:f eqn="sum @0 0 1"/><v:f eqn="prod @6 1 2"/><v:f eqn="prod @7 21600 pixelWidth"/><v:f eqn="sum @8 21600 0"/><v:f eqn="prod @7 21600 pixelHeight"/><v:f eqn="sum @10 21600 0"/></v:formulas><v:path o:extrusionok="f" gradientshapeok="t" o:connecttype="rect"/><o:lock v:ext="edit" aspectratio="t"/></v:shapetype>`
    : "";
  return `<w:r><w:pict>${st}<v:shape id="AssinaturaRt" type="#_x0000_t75" style="width:${w}pt;height:${h}pt"><v:imagedata r:id="${RID}" o:title="assinatura"/></v:shape></w:pict></w:r>`;
}

function paragrafoImagem(pPrBase: string, run: string, recuoTwips = 0): string {
  let pPr = pPrBase || "<w:pPr></w:pPr>";
  pPr = pPr.replace("</w:pPr>", `<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/></w:pPr>`);
  if (recuoTwips > 0) {
    // soma ao recuo que o parágrafo já tem: a imagem fica sobre o NOME, não sobre o rótulo
    const atual = Number(/<w:ind\b[^>]*\bw:(?:left|start)="(-?\d+)"/.exec(pPr)?.[1] ?? 0);
    pPr = pPr.replace(/<w:ind\b[^>]*\/>/, "").replace(/<w:jc\b[^>]*\/>/, "")
      .replace("</w:pPr>", `<w:ind w:left="${atual + recuoTwips}"/></w:pPr>`);
  }
  // a ordem dos filhos de pPr importa para o Word: spacing/ind/jc depois de tabs
  return `<w:p>${ordenarPPr(pPr)}${run}</w:p>`;
}

/** Ordem do esquema (CT_PPrBase) para os filhos que este módulo mexe. */
function ordenarPPr(pPr: string): string {
  const corpo = pPr.replace(/^<w:pPr>/, "").replace(/<\/w:pPr>$/, "");
  const filhos = corpo.match(/<w:(\w+)\b[^>]*\/>|<w:(\w+)\b[^>]*>[\s\S]*?<\/w:\2>/g) ?? [];
  const ORDEM = ["pStyle", "keepNext", "keepLines", "pageBreakBefore", "framePr", "widowControl", "numPr", "suppressLineNumbers", "pBdr", "shd", "tabs", "suppressAutoHyphens", "kinsoku", "wordWrap", "overflowPunct", "topLinePunct", "autoSpaceDE", "autoSpaceDN", "bidi", "adjustRightInd", "snapToGrid", "spacing", "ind", "contextualSpacing", "mirrorIndents", "suppressOverlap", "jc", "textDirection", "textAlignment", "textboxTightWrap", "outlineLvl", "divId", "cnfStyle", "rPr", "sectPr", "pPrChange"];
  const nome = (f: string) => /<w:(\w+)/.exec(f)![1];
  const pos = (f: string) => { const i = ORDEM.indexOf(nome(f)); return i < 0 ? 99 : i; };
  return `<w:pPr>${[...filhos].sort((a, b) => pos(a) - pos(b)).join("")}</w:pPr>`;
}

/**
 * Coloca a assinatura no document.xml. Devolve o XML novo e quantas vezes ela
 * entrou (0 = documento intocado, exceto pela remoção do marcador).
 */
export function inserirAssinaturaNoXml(xml: string, assinatura: AssinaturaRt | null, nomeRt: string): { xml: string; inseridas: number } {
  const ps = paragrafos(xml);
  const trocas: { ini: number; fim: number; novo: string }[] = [];
  let primeira = !xml.includes('id="_x0000_t75"');
  const run = () => { const r = runImagem(assinatura!, primeira); primeira = false; return r; };

  // 1. marcador do modelo
  const comMarcador = ps.filter((p) => textoDoParagrafo(p.xml).includes(MARCADOR_ASSINATURA));
  if (comMarcador.length) {
    for (const p of comMarcador) {
      const so = textoDoParagrafo(p.xml).trim() === MARCADOR_ASSINATURA;
      let novo: string;
      if (!assinatura) {
        novo = p.xml.replace(RE_WT, (m) => m.split(MARCADOR_ASSINATURA).join(""));
      } else if (so) {
        novo = paragrafoImagem(pPrDe(p.xml), run());
      } else {
        // marcador no meio do texto: a imagem entra no lugar dele, no run em que está
        novo = p.xml.replace(/<w:r\b[^>]*>(?:(?!<\/w:r>)[\s\S])*?\{\{ASSINATURA_RT\}\}[\s\S]*?<\/w:r>/, (r) => r.split(MARCADOR_ASSINATURA).join("") + run());
        novo = novo.replace(RE_WT, (m) => m.split(MARCADOR_ASSINATURA).join(""));
      }
      trocas.push({ ini: p.ini, fim: p.fim, novo });
    }
    return { xml: aplicar(xml, trocas), inseridas: assinatura ? comMarcador.length : 0 };
  }
  if (!assinatura) return { xml, inseridas: 0 };

  // 2. linha de assinatura do RT
  let n = 0;
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i];
    if (!ehLinhaDoRt(textoDoParagrafo(p.xml), nomeRt)) continue;
    const ant = ps[i - 1];
    // o anterior só conta se for vizinho de fato (sem tabela/quebra entre eles)
    const colado = ant && /^\s*$/.test(xml.slice(ant.fim, p.ini).replace(/<w:bookmark(Start|End)\b[^>]*\/>/g, ""));
    // "Responsável Técnico: NOME": a imagem vai sobre o nome, depois do rótulo
    const rotuloNome = RE_ROTULO.exec(normal(textoDoParagrafo(p.xml)))?.[0].length ?? 0;
    if (colado && ehTracejado(ant.xml)) {
      const t = textoDoParagrafo(ant.xml);
      const rotulo = t.slice(0, t.indexOf("_")).length;
      trocas.push({ ini: ant.ini, fim: ant.ini, novo: paragrafoImagem(pPrDe(ant.xml), run(), rotulo ? Math.round(rotulo * 105) : 0) });
    } else if (colado && vazio(ant.xml)) {
      // o modelo deixa linhas em branco para assinar: a imagem ocupa a de baixo
      trocas.push({ ini: ant.ini, fim: ant.fim, novo: paragrafoImagem(pPrDe(p.xml) || pPrDe(ant.xml), run(), Math.round(rotuloNome * 105)) });
    } else {
      trocas.push({ ini: p.ini, fim: p.ini, novo: paragrafoImagem(pPrDe(p.xml), run(), Math.round(rotuloNome * 105)) });
    }
    n++;
  }
  return { xml: aplicar(xml, trocas), inseridas: n };
}

function aplicar(xml: string, trocas: { ini: number; fim: number; novo: string }[]): string {
  let out = xml;
  for (const t of [...trocas].sort((a, b) => b.ini - a.ini)) out = out.slice(0, t.ini) + t.novo + out.slice(t.fim);
  return out;
}

/**
 * Aplica no pacote. Sem `assinatura` só limpa o marcador. Devolve quantas
 * assinaturas entraram.
 */
export async function aplicarAssinaturaRt(zip: JSZip, assinatura: AssinaturaRt | null, nomeRt: string): Promise<number> {
  const docPath = "word/document.xml";
  const f = zip.file(docPath);
  if (!f) return 0;
  const original = await f.async("string");
  const { xml, inseridas } = inserirAssinaturaNoXml(original, assinatura, nomeRt);
  if (xml === original) return 0;
  let doc = xml;
  if (inseridas && assinatura) {
    // namespaces do VML no documento (o modelo pode não declarar)
    const abre = /<w:document\b[^>]*>/.exec(doc)![0];
    let nova = abre;
    if (!/xmlns:r="/.test(abre)) nova = nova.replace(/>$/, ` xmlns:r="${NS_R}">`);
    if (!/xmlns:v="/.test(abre)) nova = nova.replace(/>$/, ` xmlns:v="${NS_V}">`);
    if (!/xmlns:o="/.test(abre)) nova = nova.replace(/>$/, ` xmlns:o="${NS_O}">`);
    doc = doc.replace(abre, nova);
    const relsPath = "word/_rels/document.xml.rels";
    let rels = zip.file(relsPath) ? await zip.file(relsPath)!.async("string")
      : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${NS_PKG}"></Relationships>`;
    if (!rels.includes(`Id="${RID}"`)) {
      rels = rels.replace("</Relationships>", `<Relationship Id="${RID}" Type="${NS_R}/image" Target="${MIDIA}"/></Relationships>`);
    }
    zip.file(relsPath, rels);
    zip.file(`word/${MIDIA}`, assinatura.bytes);
    const ctPath = "[Content_Types].xml";
    const ct = zip.file(ctPath) ? await zip.file(ctPath)!.async("string") : null;
    if (ct && !/<Default[^>]+Extension="png"/i.test(ct)) {
      zip.file(ctPath, ct.replace("</Types>", `<Default Extension="png" ContentType="image/png"/></Types>`));
    }
  }
  zip.file(docPath, doc);
  return inseridas;
}
