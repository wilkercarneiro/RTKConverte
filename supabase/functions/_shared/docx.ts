// Geração do Memorial DOCX por templating XML direto (jszip no chamador).
// Retorna o mapa de arquivos do pacote OOXML; o chamador injeta word/document.xml
// no template (memorial-template.docx do Storage) ou monta o pacote completo.
import { cabecalhoMemorial, corpoMemorial } from "./memorial.ts";
import type { DadosMemorial, Run } from "./memorial.ts";

export function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function run(r: Run): string {
  const props = r.bold ? "<w:rPr><w:b/></w:rPr>" : "";
  return `<w:r>${props}<w:t xml:space="preserve">${xmlEscape(r.text)}</w:t></w:r>`;
}

function par(runs: Run[], opts: { align?: "center" | "right" | "both"; spaceAfter?: number } = {}): string {
  const jc = opts.align ? `<w:jc w:val="${opts.align}"/>` : "";
  const spacing = `<w:spacing w:after="${opts.spaceAfter ?? 120}" w:line="276" w:lineRule="auto"/>`;
  return `<w:p><w:pPr>${spacing}${jc}</w:pPr>${runs.map(run).join("")}</w:p>`;
}

const LINHA_ASSINATURA = "_".repeat(60);

/**
 * Logo impressa ATRÁS do texto, em todas as páginas — o memorial sai timbrado
 * sem depender de um .docx modelo mantido à mão no Storage.
 *
 * Vive num cabeçalho porque é assim que o OOXML repete um elemento em todas as
 * páginas: o corpo do documento só desenha o que cabe no fluxo.
 *
 * A marcação é VML (`w:pict`), não DrawingML. É a que o próprio Word grava em
 * "Design → Marca d'água → Imagem", e por isso é a que todo leitor renderiza —
 * Word, LibreOffice, Google Docs, WPS. A primeira versão usava DrawingML com
 * `alphaModFix`, que é XML válido mas cujo esmaecimento nem todo leitor honra:
 * o arquivo abria sem timbre nenhum. O par `gain`/`blacklevel` do `v:imagedata`
 * é o desbotamento oficial do Word e não depende de suporte a transparência.
 */
export interface MarcaDagua {
  bytes: Uint8Array;
  tipo: "png" | "jpg";
}

/** rId do cabeçalho da marca d'água dentro de word/_rels/document.xml.rels. */
const RID_MARCA = "rId9";
/**
 * Desbotamento padrão de marca d'água do Word, em unidades fixed-point (`f`).
 * gain 19661f ≈ 0,3 de contraste e blacklevel 22938f ≈ +0,35 de brilho: é o par
 * que o Word grava ao marcar "Desbotar", e o que deixa o texto legível por cima.
 */
const GAIN_MARCA = "19661f";
const BLACKLEVEL_MARCA = "22938f";
/** Lado máximo do timbre, em EMU (1 cm = 360000). Cabe na mancha de um A4 retrato. */
const LADO_MARCA_EMU = 12 * 360000;
/** EMU por ponto tipográfico — o VML posiciona em pt, o DrawingML em EMU. */
const EMU_POR_PT = 12700;

/**
 * Largura e altura em pixels de um PNG ou JPEG.
 *
 * O OOXML exige as duas medidas em EMU no próprio XML: sem elas o Word estica a
 * imagem para a caixa que encontrar e a logo sai deformada. Ler o cabeçalho do
 * arquivo é mais barato do que carregar um decodificador de imagem inteiro.
 */
export function dimensoesImagem(bytes: Uint8Array, tipo: "png" | "jpg"): { w: number; h: number } | null {
  const u32 = (o: number) => (bytes[o] << 24 | bytes[o + 1] << 16 | bytes[o + 2] << 8 | bytes[o + 3]) >>> 0;
  const u16 = (o: number) => bytes[o] << 8 | bytes[o + 1];
  if (tipo === "png") {
    // IHDR é sempre o primeiro chunk: assinatura (8) + tamanho (4) + tipo (4)
    if (bytes.length < 24) return null;
    return { w: u32(16), h: u32(20) };
  }
  // JPEG: percorre os marcadores até um SOF (0xC0–0xCF, exceto DHT/JPG/DAC)
  let i = 2;
  while (i + 3 < bytes.length) {
    if (bytes[i] !== 0xff) { i++; continue; }
    const m = bytes[i + 1];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      return i + 8 < bytes.length ? { h: u16(i + 5), w: u16(i + 7) } : null;
    }
    i += 2 + u16(i + 2);
  }
  return null;
}

/** Medidas do timbre em EMU, respeitando a proporção original da logo. */
function medidasMarca(m: MarcaDagua): { cx: number; cy: number } {
  const dim = dimensoesImagem(m.bytes, m.tipo);
  // sem cabeçalho legível a logo entra quadrada: melhor um timbre levemente
  // esticado do que nenhum timbre
  if (!dim || !dim.w || !dim.h) return { cx: LADO_MARCA_EMU, cy: LADO_MARCA_EMU };
  const escala = LADO_MARCA_EMU / Math.max(dim.w, dim.h);
  return { cx: Math.round(dim.w * escala), cy: Math.round(dim.h * escala) };
}

const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_V = "urn:schemas-microsoft-com:vml";
const NS_O = "urn:schemas-microsoft-com:office:office";

/**
 * word/header1.xml: só a logo, centrada na PÁGINA e atrás do texto.
 *
 * `mso-position-*-relative:margin` com `margin-left/top:0` e alinhamento central
 * é a receita do Word: sem ela a figura ancora no parágrafo do cabeçalho e sobe
 * para o topo da folha em vez de ficar no meio.
 */
function headerMarcaXml(m: MarcaDagua): string {
  const { cx, cy } = medidasMarca(m);
  const wPt = (cx / EMU_POR_PT).toFixed(1);
  const hPt = (cy / EMU_POR_PT).toFixed(1);
  const estilo = [
    "position:absolute", "margin-left:0", "margin-top:0",
    `width:${wPt}pt`, `height:${hPt}pt`, "z-index:-251658752",
    "mso-position-horizontal:center", "mso-position-horizontal-relative:margin",
    "mso-position-vertical:center", "mso-position-vertical-relative:margin",
  ].join(";");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="${NS_R}" xmlns:v="${NS_V}" xmlns:o="${NS_O}">
<w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:pict>
<v:shapetype id="_x0000_t75" coordsize="21600,21600" o:spt="75" o:preferrelative="t" path="m@4@5l@4@11@9@11@9@5xe" filled="f" stroked="f">
<v:stroke joinstyle="miter"/>
<v:formulas><v:f eqn="if lineDrawn pixelLineWidth 0"/><v:f eqn="sum @0 1 0"/><v:f eqn="sum 0 0 @1"/><v:f eqn="prod @2 1 2"/><v:f eqn="prod @3 21600 pixelWidth"/><v:f eqn="prod @3 21600 pixelHeight"/><v:f eqn="sum @0 0 1"/><v:f eqn="prod @6 1 2"/><v:f eqn="prod @7 21600 pixelWidth"/><v:f eqn="sum @8 21600 0"/><v:f eqn="prod @7 21600 pixelHeight"/><v:f eqn="sum @10 21600 0"/></v:formulas>
<v:path o:extrusionok="f" gradientshapeok="t" o:connecttype="rect"/>
<o:lock v:ext="edit" aspectratio="t"/>
</v:shapetype>
<v:shape id="MarcaDaguaLogo" o:spid="_x0000_s2049" type="#_x0000_t75" style="${estilo}" o:allowincell="f">
<v:imagedata r:id="rId1" o:title="logo" gain="${GAIN_MARCA}" blacklevel="${BLACKLEVEL_MARCA}"/>
</v:shape>
</w:pict></w:r></w:p>
</w:hdr>`;
}

/**
 * Timbre herdado de um modelo .docx: a abertura de `<w:document>` (com todos os
 * namespaces que o modelo declara) e o `<w:sectPr>` (que aponta para cabeçalho,
 * rodapé e margens).
 *
 * É assim que o Memorial Descritivo GEO ganha o MESMO timbre das outras peças
 * sem ter a arte da empresa escrita em código: o modelo mora no Storage, ao lado
 * dos das peças, e aqui só se troca o corpo.
 */
export interface TimbreModelo { abertura: string; sectPr: string }

/** Lê o timbre do `word/document.xml` de um modelo. `null` se não der para usar. */
export function extrairTimbre(documentXml: string): TimbreModelo | null {
  const abertura = documentXml.match(/<w:document[^>]*>/)?.[0];
  const sectPr = documentXml.match(/<w:sectPr[\s\S]*?<\/w:sectPr>/)?.[0];
  // sectPr sem referência de cabeçalho é modelo sem timbre: não vale a pena
  // herdar, e o esqueleto interno dá um documento melhor
  if (!abertura || !sectPr || !/<w:(header|footer)Reference/.test(sectPr)) return null;
  return { abertura, sectPr };
}

export function buildDocumentXml(d: DadosMemorial, marcaDagua = false, timbre?: TimbreModelo | null): string {
  const partes: string[] = [];
  // 1. Título
  partes.push(par([{ text: "M E M O R I A L   D E S C R I T I V O  (GEO)", bold: true }], { align: "center", spaceAfter: 240 }));
  // 2. Cabeçalho de campos
  for (const c of cabecalhoMemorial(d)) {
    partes.push(par([{ text: c.rotulo, bold: true }, { text: c.valor, bold: false }], { spaceAfter: 0 }));
  }
  partes.push(par([], { spaceAfter: 120 }));
  // 3. Corpo — parágrafo único justificado
  partes.push(par(corpoMemorial(d), { align: "both", spaceAfter: 240 }));
  // 4. Data e assinaturas
  partes.push(par([{ text: `${d.municipio}, ${d.dataStr}`, bold: false }], { align: "right", spaceAfter: 360 }));
  partes.push(par([
    { text: `Responsável Técnico: ${LINHA_ASSINATURA}`, bold: false },
  ], { spaceAfter: 0 }));
  partes.push(par([
    { text: `${d.rtNome}  -  CREA : ${d.rtCrea} -  - TRT: ${d.rtTrt}`, bold: false },
  ], { spaceAfter: 360 }));
  partes.push(par([
    { text: `Proprietário(a): ${LINHA_ASSINATURA}`, bold: false },
  ], { spaceAfter: 0 }));
  partes.push(par([
    { text: `${d.proprietario} CPF nº: ${d.cpfProprietario}`, bold: false },
  ], { spaceAfter: 360 }));
  for (const desc of d.confrontantesDescritivos) {
    partes.push(par([{ text: `Confrontante: ${LINHA_ASSINATURA}`, bold: false }], { spaceAfter: 0 }));
    partes.push(par([{ text: desc, bold: false }], { spaceAfter: 360 }));
  }

  // Com modelo, a seção é a DELE — cabeçalho, rodapé e margens vêm prontos e
  // idênticos aos das outras peças. Sem modelo, monta-se a seção mínima aqui, e
  // a referência ao cabeçalho só entra quando há marca d'água: um
  // headerReference apontando para parte ausente invalida o pacote inteiro.
  if (timbre) {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
${timbre.abertura}<w:body>${partes.join("")}
${timbre.sectPr}</w:body></w:document>`;
  }
  const hdr = marcaDagua ? `<w:headerReference w:type="default" r:id="${RID_MARCA}"/>` : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="${NS_R}">
<w:body>${partes.join("")}
<w:sectPr>${hdr}<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1418" w:header="709" w:footer="709" w:gutter="0"/></w:sectPr>
</w:body></w:document>`;
}

// Pacote OOXML mínimo (usado para gerar o memorial-template.docx e como
// fallback caso o template não esteja no Storage).
export function buildDocxSkeleton(marca?: MarcaDagua | null): Map<string, string | Uint8Array> {
  const files = new Map<string, string | Uint8Array>();
  const ext = marca?.tipo === "png" ? "png" : "jpeg";
  const midia = `media/logo-fundo.${ext}`;
  files.set("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
${marca ? `<Default Extension="${ext}" ContentType="image/${ext}"/>
<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>` : ""}
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`);
  files.set("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);
  files.set("word/_rels/document.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="${NS_R}/styles" Target="styles.xml"/>
${marca ? `<Relationship Id="${RID_MARCA}" Type="${NS_R}/header" Target="header1.xml"/>` : ""}
</Relationships>`);
  if (marca) {
    files.set("word/header1.xml", headerMarcaXml(marca));
    files.set("word/_rels/header1.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="${NS_R}/image" Target="${midia}"/>
</Relationships>`);
    files.set(`word/${midia}`, marca.bytes);
  }
  files.set("word/styles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/><w:sz w:val="24"/><w:szCs w:val="24"/><w:lang w:val="pt-BR"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="120"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
</w:styles>`);
  files.set("word/document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p/></w:body></w:document>`);
  return files;
}
