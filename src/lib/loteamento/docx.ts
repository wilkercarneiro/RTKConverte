// DOCX mínimo, montado no navegador: memorial do loteamento e memoriais dos
// lotes. Sem modelo do escritório de propósito — o memorial de lote é texto
// corrido que o operador revisa e cola no timbre que o cartório pede; o que
// importa aqui é que medidas, confrontações e nomes de vértice saiam certos.
import JSZip from "jszip";

export interface SecaoDocx {
  titulo: string;
  subtitulo?: string;
  paragrafos: string[];
  /** tabela simples (primeira linha = cabeçalho) */
  tabela?: string[][];
  quebraAntes?: boolean;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function par(texto: string, o: { negrito?: boolean; tam?: number; centro?: boolean; quebraAntes?: boolean; antes?: number; depois?: number } = {}): string {
  const ppr = [
    o.quebraAntes ? "<w:pageBreakBefore/>" : "",
    `<w:spacing w:before="${o.antes ?? 0}" w:after="${o.depois ?? 120}" w:line="300" w:lineRule="auto"/>`,
    o.centro ? '<w:jc w:val="center"/>' : '<w:jc w:val="both"/>',
  ].join("");
  const rpr = `<w:rPr>${o.negrito ? "<w:b/>" : ""}<w:sz w:val="${(o.tam ?? 11) * 2}"/></w:rPr>`;
  return `<w:p><w:pPr>${ppr}</w:pPr><w:r>${rpr}<w:t xml:space="preserve">${esc(texto)}</w:t></w:r></w:p>`;
}

function tabela(linhas: string[][]): string {
  const borda = '<w:tblBorders><w:top w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/><w:insideH w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/></w:tblBorders>';
  const linhasXml = linhas.map((l, i) => `<w:tr>${l.map((c) => `<w:tc><w:p><w:pPr><w:spacing w:after="0"/></w:pPr><w:r><w:rPr>${i === 0 ? "<w:b/>" : ""}<w:sz w:val="18"/></w:rPr><w:t xml:space="preserve">${esc(c)}</w:t></w:r></w:p></w:tc>`).join("")}</w:tr>`).join("");
  return `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/>${borda}</w:tblPr>${linhasXml}</w:tbl>${par("")}`;
}

export async function gerarDocx(secoes: SecaoDocx[], rodape: string): Promise<Blob> {
  const corpo = secoes.map((s) => [
    par(s.titulo, { negrito: true, tam: 13, centro: true, quebraAntes: s.quebraAntes, depois: s.subtitulo ? 40 : 200 }),
    s.subtitulo ? par(s.subtitulo, { centro: true, tam: 10, depois: 200 }) : "",
    ...s.paragrafos.map((p) => par(p)),
    s.tabela ? tabela(s.tabela) : "",
  ].join("")).join("");
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${corpo}<w:sectPr><w:footerReference w:type="default" r:id="rIdRodape"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1418" w:right="1134" w:bottom="1134" w:left="1701" w:header="709" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const footer = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:t xml:space="preserve">${esc(rodape)}</w:t></w:r></w:p></w:ftr>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:sz w:val="22"/><w:lang w:val="pt-BR"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>`;
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file("word/_rels/document.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdEstilos" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdRodape" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>`);
  zip.file("word/document.xml", doc);
  zip.file("word/styles.xml", styles);
  zip.file("word/footer1.xml", footer);
  return zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
}
