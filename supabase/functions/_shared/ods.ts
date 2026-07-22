// Patcher do content.xml da planilha oficial SIGEF (PLANTA.ODS).
// Altera APENAS células de dados das abas `identificacao` e `perimetro_1`;
// todas as demais abas, estilos, validações, formulários e proteções são
// preservados byte a byte (o zip é remontado pelo chamador mantendo os
// demais arquivos intactos e o mimetype sem compressão).
import { xmlEscape } from "./docx.ts";

export interface DadosIdentificacao {
  natureza: string;
  tipoPessoa: string;      // "Física" | "Jurídica"
  nome: string;
  cpf: string;
  denominacao: string;
  situacao: string;
  naturezaArea: string;
  sncr: string;
  cns: string;
  matricula: string;
  municipioUf: string;     // "Araci-BA"
}

export interface LinhaVertice {
  codigo: string;
  lonFmt: string;          // "39 5 04,737 W"
  latFmt: string;          // "11 23 44,344 S"
  sigmaPos: number;
  h: number;
  sigmaH: number;
  metodo: string;          // PG6 | PA1 | ...
  tipoLimite: string;      // LA1..LN6
  cns: string | null;
  matricula: string | null;
  descritivo: string;
}

export interface DadosPerimetro {
  denominacaoParcela: string;
  parcelaNumero: string;
  lado: string;            // "Externo" | ...
  mcAbs: number;           // graus absolutos, ex.: 39
  hemisferio: string;      // "Sul" | "Norte"
  linhas: LinhaVertice[];
}

// número float no padrão ODF: office:value com ponto, texto com vírgula
function floatText(v: number): { value: string; text: string } {
  const value = String(v);
  return { value, text: value.replace(".", ",") };
}

// ---------------------------------------------------------------------------
// Manipulação de baixo nível
// ---------------------------------------------------------------------------

interface TableSlice { before: string; slice: string; after: string }

function getTable(xml: string, name: string): TableSlice {
  const open = new RegExp(`<table:table\\s[^>]*table:name="${name}"[^>]*>`);
  const m = xml.match(open);
  if (!m || m.index === undefined) throw new Error(`Aba "${name}" não encontrada no template ODS`);
  const start = m.index;
  const next = xml.indexOf("<table:table ", start + 10);
  const end = next < 0 ? xml.lastIndexOf("</table:table>") + "</table:table>".length : next;
  return { before: xml.slice(0, start), slice: xml.slice(start, end), after: xml.slice(end) };
}

function splitRows(slice: string): { head: string; rows: string[]; tail: string } {
  const first = slice.indexOf("<table:table-row");
  const head = slice.slice(0, first);
  let rest = slice.slice(first);
  const tailIdx = rest.lastIndexOf("</table:table-row>") + "</table:table-row>".length;
  const tail = rest.slice(tailIdx);
  rest = rest.slice(0, tailIdx);
  const rows = rest.split(/(?=<table:table-row)/g);
  return { head, rows, tail };
}

const CELL_RE = /<table:(?:covered-)?table-cell[^>]*(?:\/>|>[\s\S]*?<\/table:(?:covered-)?table-cell>)/g;

function splitCells(row: string): { open: string; cells: string[] } {
  const openEnd = row.indexOf(">") + 1;
  const open = row.slice(0, openEnd);
  const cells = row.slice(openEnd).match(CELL_RE) ?? [];
  return { open, cells };
}

// Substitui o conteúdo de uma célula preservando estilo, validação e controles
// de formulário embutidos (draw:control).
function setCell(cellXml: string, value: string, opts: { float?: boolean } = {}): string {
  const openMatch = cellXml.match(/^<table:table-cell([^>]*?)\/?>/);
  if (!openMatch) throw new Error("Célula inválida: " + cellXml.slice(0, 80));
  let attrs = openMatch[1];
  // remove atributos de valor antigos
  attrs = attrs
    .replace(/\s+office:value-type="[^"]*"/g, "")
    .replace(/\s+office:value="[^"]*"/g, "")
    .replace(/\s+calcext:value-type="[^"]*"/g, "")
    .replace(/\s+table:number-columns-repeated="[^"]*"/g, "");
  // preserva draw:control / draw:frame embutidos
  const inner = cellXml.replace(/^<table:table-cell[^>]*\/?>/, "").replace(/<\/table:table-cell>$/, "");
  const controls = (inner.match(/<draw:[a-z-]+[\s\S]*?(?:\/>|<\/draw:[a-z-]+>)/g) ?? []).join("");
  let valueAttrs: string;
  let text: string;
  if (opts.float && value !== "") {
    const f = floatText(Number(value));
    valueAttrs = ` office:value-type="float" office:value="${f.value}" calcext:value-type="float"`;
    text = f.text;
  } else {
    valueAttrs = ` office:value-type="string" calcext:value-type="string"`;
    text = value;
  }
  if (value === "") return `<table:table-cell${attrs}>${controls}</table:table-cell>`;
  return `<table:table-cell${attrs}${valueAttrs}>${controls}<text:p>${xmlEscape(text)}</text:p></table:table-cell>`;
}

function patchRowCell(rows: string[], rowIdx: number, cellIdx: number, value: string, opts: { float?: boolean } = {}): void {
  const { open, cells } = splitCells(rows[rowIdx]);
  if (cellIdx >= cells.length) throw new Error(`Linha ${rowIdx}: célula ${cellIdx} inexistente`);
  cells[cellIdx] = setCell(cells[cellIdx], value, opts);
  rows[rowIdx] = open + cells.join("") + "</table:table-row>";
}

function findRowByLabel(rows: string[], label: string): number {
  const needle = `>${xmlEscape(label)}</text:p>`;
  const idx = rows.findIndex((r) => r.includes(needle));
  if (idx < 0) throw new Error(`Linha com rótulo "${label}" não encontrada`);
  return idx;
}

// ---------------------------------------------------------------------------
// Aba identificacao
// ---------------------------------------------------------------------------

function patchIdentificacao(xml: string, d: DadosIdentificacao): string {
  const t = getTable(xml, "identificacao");
  const { head, rows, tail } = splitRows(t.slice);
  patchRowCell(rows, findRowByLabel(rows, "Natureza do serviço:"), 1, d.natureza);
  patchRowCell(rows, findRowByLabel(rows, "Tipo pessoa:"), 1, d.tipoPessoa);
  patchRowCell(rows, findRowByLabel(rows, "Nome:"), 1, d.nome);
  patchRowCell(rows, findRowByLabel(rows, "CPF:"), 1, d.cpf);
  patchRowCell(rows, findRowByLabel(rows, "Denominação:"), 1, d.denominacao);
  patchRowCell(rows, findRowByLabel(rows, "Situação:"), 1, d.situacao);
  patchRowCell(rows, findRowByLabel(rows, "Natureza da área:"), 1, d.naturezaArea);
  patchRowCell(rows, findRowByLabel(rows, "Código do Imóvel(SNCR/INCRA):"), 1, d.sncr);
  patchRowCell(rows, findRowByLabel(rows, "Código do cartório (CNS):"), 1, d.cns);
  const isNum = /^\d+$/.test(d.matricula);
  patchRowCell(rows, findRowByLabel(rows, "Matrícula:"), 1, d.matricula, { float: isNum });
  const mun = findRowByLabel(rows, "Município(s):") + 1;
  patchRowCell(rows, mun, 0, d.municipioUf);
  patchRowCell(rows, mun, 1, d.municipioUf);
  return t.before + head + rows.join("") + tail + t.after;
}

// ---------------------------------------------------------------------------
// Aba perimetro_1
// ---------------------------------------------------------------------------

function verticeRowXml(l: LinhaVertice): string {
  const str = (style: string, v: string, valid?: string) =>
    v === ""
      ? `<table:table-cell table:style-name="${style}"${valid ? ` table:content-validation-name="${valid}"` : ""}/>`
      : `<table:table-cell table:style-name="${style}"${valid ? ` table:content-validation-name="${valid}"` : ""} office:value-type="string" calcext:value-type="string"><text:p>${xmlEscape(v)}</text:p></table:table-cell>`;
  const flt = (style: string, v: number) => {
    const f = floatText(v);
    return `<table:table-cell table:style-name="${style}" office:value-type="float" office:value="${f.value}" calcext:value-type="float"><text:p>${f.text}</text:p></table:table-cell>`;
  };
  const cnsMat = (l.cns || l.matricula)
    ? str("ce121", l.cns ?? "") + str("ce121", l.matricula ?? "")
    : `<table:table-cell table:style-name="ce121" table:number-columns-repeated="2"/>`;
  return `<table:table-row table:style-name="ro2">` +
    str("ce106", l.codigo) +
    str("ce117", l.lonFmt) +
    flt("ce88", l.sigmaPos) +
    str("ce117", l.latFmt) +
    flt("ce88", l.sigmaPos) +
    flt("ce88", l.h) +
    flt("ce88", l.sigmaH) +
    str("ce127", l.metodo, "val3") +
    str("ce121", l.tipoLimite, "val5") +
    cnsMat +
    str("ce139", l.descritivo) +
    `<table:table-cell table:style-name="ce26" table:number-columns-repeated="1011"/><table:table-cell/>` +
    `</table:table-row>`;
}

function patchPerimetro(xml: string, d: DadosPerimetro): string {
  const t = getTable(xml, "perimetro_1");
  const { head, rows, tail } = splitRows(t.slice);
  patchRowCell(rows, findRowByLabel(rows, "Denominação:"), 1, d.denominacaoParcela);
  patchRowCell(rows, findRowByLabel(rows, "Parcela número:"), 1, d.parcelaNumero);
  patchRowCell(rows, findRowByLabel(rows, "Lado:"), 1, d.lado);
  const coordRow = findRowByLabel(rows, "Tipo de Coordenada:");
  patchRowCell(rows, coordRow, 1, "Geográfica");
  patchRowCell(rows, coordRow, 3, String(d.mcAbs));
  patchRowCell(rows, coordRow, 5, d.hemisferio);

  // Linhas de vértices: substituem o bloco de dados após o cabeçalho "Vértice"
  const hdr = rows.findIndex((r) => r.includes(">Vértice</text:p>"));
  if (hdr < 0) throw new Error("Cabeçalho da tabela de vértices não encontrado");
  let dataEnd = hdr + 1;
  while (dataEnd < rows.length && /<table:table-cell table:style-name="ce106"[^>]*office:value-type="string"/.test(rows[dataEnd])) {
    dataEnd++;
  }
  const oldCount = dataEnd - (hdr + 1);
  const novas = d.linhas.map(verticeRowXml);
  const delta = novas.length - oldCount;
  const out = [...rows.slice(0, hdr + 1), ...novas, ...rows.slice(dataEnd)];
  // compensa o total de linhas da planilha ajustando a primeira linha repetida
  if (delta !== 0) {
    for (let i = hdr + 1 + novas.length; i < out.length; i++) {
      const m = out[i].match(/table:number-rows-repeated="(\d+)"/);
      if (m) {
        const rep = parseInt(m[1], 10);
        const novoRep = rep - delta;
        if (novoRep >= 1) {
          out[i] = out[i].replace(/table:number-rows-repeated="\d+"/, `table:number-rows-repeated="${novoRep}"`);
          break;
        }
      }
    }
  }
  return t.before + head + out.join("") + tail + t.after;
}

export function patchOdsContent(xml: string, ident: DadosIdentificacao, per: DadosPerimetro): string {
  return patchPerimetro(patchIdentificacao(xml, ident), per);
}
