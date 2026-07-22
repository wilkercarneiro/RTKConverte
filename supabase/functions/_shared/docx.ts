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

export function buildDocumentXml(d: DadosMemorial): string {
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

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>${partes.join("")}
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1418" w:header="709" w:footer="709" w:gutter="0"/></w:sectPr>
</w:body></w:document>`;
}

// Pacote OOXML mínimo (usado para gerar o memorial-template.docx e como
// fallback caso o template não esteja no Storage).
export function buildDocxSkeleton(): Map<string, string> {
  const files = new Map<string, string>();
  files.set("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`);
  files.set("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);
  files.set("word/_rels/document.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`);
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
