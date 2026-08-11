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
 * páginas: o corpo do documento só desenha o que cabe no fluxo. `behindDoc` +
 * `alphaModFix` são o que fazem dela um timbre e não uma figura por cima do
 * texto.
 */
export interface MarcaDagua {
  bytes: Uint8Array;
  tipo: "png" | "jpg";
}

/** rId do cabeçalho da marca d'água dentro de word/_rels/document.xml.rels. */
const RID_MARCA = "rId9";
/** Opacidade do timbre (100000 = opaco). Baixa o bastante para ler o texto por cima. */
const ALPHA_MARCA = 22000;
/** Lado máximo do timbre, em EMU (1 cm = 360000). Cabe na mancha de um A4 retrato. */
const LADO_MARCA_EMU = 12 * 360000;

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

const NS_WP = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
const NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const NS_PIC = "http://schemas.openxmlformats.org/drawingml/2006/picture";
const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

/** word/header1.xml: só a logo, ancorada ao centro da PÁGINA e atrás do texto. */
function headerMarcaXml(m: MarcaDagua): string {
  const { cx, cy } = medidasMarca(m);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="${NS_R}" xmlns:wp="${NS_WP}" xmlns:a="${NS_A}" xmlns:pic="${NS_PIC}">
<w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:drawing>
<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="0" behindDoc="1" locked="0" layoutInCell="1" allowOverlap="1">
<wp:simplePos x="0" y="0"/>
<wp:positionH relativeFrom="page"><wp:align>center</wp:align></wp:positionH>
<wp:positionV relativeFrom="page"><wp:align>center</wp:align></wp:positionV>
<wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/>
<wp:docPr id="1" name="Marca d'agua"/>
<a:graphic><a:graphicData uri="${NS_PIC}">
<pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="logo"/><pic:cNvPicPr/></pic:nvPicPr>
<pic:blipFill><a:blip r:embed="rId1"><a:alphaModFix amt="${ALPHA_MARCA}"/></a:blip><a:stretch><a:fillRect/></a:stretch></pic:blipFill>
<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>
</pic:pic></a:graphicData></a:graphic>
</wp:anchor></w:drawing></w:r></w:p>
</w:hdr>`;
}

export function buildDocumentXml(d: DadosMemorial, marcaDagua = false): string {
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

  // A referência ao cabeçalho só entra quando o timbre existe: um headerReference
  // apontando para uma parte ausente é pacote inválido, e o Word recusa o arquivo.
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
