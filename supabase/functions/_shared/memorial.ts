// Construção do texto do Memorial Descritivo GEO (padrão INCRA).
// Produz "runs" ({text, bold}) — a formatação física fica em docx.ts.
import { fmtBR, fmtGmsMemorial } from "./geo.ts";
import type { GMS, Segmento } from "./geo.ts";

export interface Run { text: string; bold: boolean }

export interface VerticeMemorial {
  codigo: string;
  latGms: GMS;
  lonGms: GMS;
  h: number;
  // descritivo do trecho que INICIA neste vértice (null se continua o trecho anterior)
  iniciaTrechoDescritivo: string | null;
}

export interface DadosMemorial {
  imovel: string;
  proprietario: string;
  cpfProprietario: string;
  municipio: string;
  uf: string;
  matricula: string;
  comarca: string;
  codigoCredenciamento: string;
  areaHa: number;
  perimetroM: number;
  mcAbs: number;            // graus absolutos do meridiano central real dos dados (ex.: 39)
  dataStr: string;          // "dd/mm/aaaa"
  rtNome: string;
  rtCrea: string;
  rtTrt: string;
  ring: VerticeMemorial[];  // ordenado a partir do vértice inicial
  segs: Segmento[];         // segs[i] = ring[i] → ring[(i+1)%n]
  confrontantesDescritivos: string[]; // ordem dos trechos, p/ linhas de assinatura
}

const b = (text: string): Run => ({ text, bold: true });
const t = (text: string): Run => ({ text, bold: false });

function coordRuns(v: VerticeMemorial): Run[] {
  return [
    t("de coordenadas "),
    b(fmtGmsMemorial(v.latGms, "lat")),
    t(" e "),
    b(fmtGmsMemorial(v.lonGms, "lon")),
    t(` de altitude ${fmtBR(v.h, 2)} m`),
  ];
}

// Corpo do memorial: parágrafo único, texto corrido.
// NOTA: os graus da longitude usam o MC REAL dos dados (não reproduzir o bug
// do legado que imprimia 45° com dados do fuso 24 / MC-39).
export function corpoMemorial(d: DadosMemorial): Run[] {
  const runs: Run[] = [];
  const n = d.ring.length;
  const v0 = d.ring[0];
  runs.push(
    t("Inicia-se a descrição deste perímetro no vértice "),
    b(v0.codigo),
    t(`, georreferenciado no Sistema Geodésico Brasileiro, DATUM - SIRGAS2000, MC-${d.mcAbs}°W, `),
    ...coordRuns(v0),
    t("; "),
  );
  for (let i = 0; i < n; i++) {
    const seg = d.segs[i];
    const prox = d.ring[(i + 1) % n];
    const desc = d.ring[i].iniciaTrechoDescritivo?.trim();
    if (desc) {
      runs.push(t(`deste segue confrontando com a propriedade de ${desc}, com azimute de `));
    } else {
      runs.push(t("deste segue, com azimute de "));
    }
    runs.push(t(`${seg.azimuteFmt} por uma distância de ${seg.distFmt}m até o vértice `), b(prox.codigo));
    if (i === n - 1) {
      runs.push(t(`, ponto inicial da descrição deste perímetro de ${fmtBR(d.perimetroM, 2)} m.`));
    } else {
      runs.push(t(", "), ...coordRuns(prox), t("; "));
    }
  }
  return runs;
}

export interface CampoCabecalho { rotulo: string; valor: string }

export function cabecalhoMemorial(d: DadosMemorial): CampoCabecalho[] {
  return [
    { rotulo: "Imóvel        : ", valor: d.imovel },
    { rotulo: "Proprietário  : ", valor: d.proprietario },
    { rotulo: "Município     : ", valor: `${d.municipio}  U.F: ${d.uf}  - BR` },
    { rotulo: "Matrícula     : ", valor: d.matricula },
    { rotulo: "Código Credenciamento : ", valor: d.codigoCredenciamento },
    { rotulo: "Comarca       : ", valor: d.comarca },
    { rotulo: "Área (ha)     : ", valor: fmtBR(d.areaHa, 4) },
    { rotulo: "Perímetro (m) : ", valor: fmtBR(d.perimetroM, 2) },
  ];
}
