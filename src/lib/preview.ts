// Preview NÃO-OFICIAL (apenas exibição): reutiliza o mesmo motor puro das Edge
// Functions para recalcular fuso/área/perímetro/1º parágrafo ao editar dados.
// Os valores oficiais dos documentos são sempre calculados server-side.
import proj4mod from "proj4";
import {
  calcularAreaHa, calcularPerimetroM, calcularSegmentos, calcularVertices,
  fmtBR, fmtGmsMemorial, parseGmsPlanilha, rotacionarRing, codigoVertice,
} from "../../supabase/functions/_shared/geo.ts";
import type { Proj4 } from "../../supabase/functions/_shared/geo.ts";
import type { Credenciado, Trecho, Vertice } from "./types";

const proj4: Proj4 = (from, to, coords) => (proj4mod as unknown as Proj4)(from, to, coords);

export interface PreviewCalc {
  areaHa: string;
  perimetroM: string;
  qtdM: number;
  qtdP: number;
  qtdV: number;
  primeiroParagrafo: string;
  erro: string | null;
}

export function calcularPreviewLocal(
  fuso: number,
  vertices: Vertice[],
  trechos: Trecho[],
  verticeInicial: number,
  credenciado: Credenciado | null,
): PreviewCalc {
  try {
    const vs = [...vertices].sort((a, b) => a.ordem - b.ordem);
    const calc = calcularVertices(
      vs.map((v) => ({
        numTxt: v.num_txt,
        latGms: parseGmsPlanilha(v.lat_gms),
        lonGms: parseGmsPlanilha(v.lon_gms),
        h: Number(v.h), sigmaPos: Number(v.sigma_pos), sigmaH: Number(v.sigma_h),
        inserido: v.inserido_manual,
      })),
      fuso, proj4,
    );
    const comOrdem = calc.map((c, i) => ({ ...c, ordem: vs[i].ordem, tipo: vs[i].tipo, codigo: vs[i].codigo }));
    const temInicial = comOrdem.some((v) => v.ordem === verticeInicial);
    const ring = rotacionarRing(comOrdem, temInicial ? verticeInicial : comOrdem[0].ordem);
    const segs = calcularSegmentos(ring);
    const areaHa = calcularAreaHa(ring);
    const perimetroM = calcularPerimetroM(segs);

    const qtd = { M: 0, P: 0, V: 0 };
    for (const v of vs) qtd[v.tipo]++;

    // código sugerido do vértice inicial (preview — a alocação oficial ocorre na geração)
    const v0 = ring[0];
    const codigo0 = v0.codigo ?? (credenciado
      ? codigoVertice(credenciado.prefixo_vertice, ring[0].tipo as "M" | "P" | "V",
          ring[0].tipo === "M" ? credenciado.contador_m : ring[0].tipo === "P" ? credenciado.contador_p : credenciado.contador_v)
      : "????-M-0000");
    const trechoInicial = trechos.find((t) => t.vertice_inicio_ordem === ring[0].ordem);
    const mcAbs = Math.abs(6 * fuso - 183);
    const desc = trechoInicial?.descritivo || trechoInicial?.apelido_txt || "(defina o trecho do vértice inicial)";
    const seg0 = segs[0];
    const primeiroParagrafo =
      `Inicia-se a descrição deste perímetro no vértice ${codigo0}, georreferenciado no ` +
      `Sistema Geodésico Brasileiro, DATUM - SIRGAS2000, MC-${mcAbs}°W, de coordenadas ` +
      `${fmtGmsMemorial(v0.latGms, "lat")} e ${fmtGmsMemorial(v0.lonGms, "lon")} de altitude ` +
      `${fmtBR(v0.h, 2)} m; deste segue confrontando com a propriedade de ${desc}, com azimute de ` +
      `${seg0.azimuteFmt} por uma distância de ${seg0.distFmt}m até o vértice seguinte, ...`;

    return {
      areaHa: fmtBR(areaHa, 4),
      perimetroM: fmtBR(perimetroM, 2),
      qtdM: qtd.M, qtdP: qtd.P, qtdV: qtd.V,
      primeiroParagrafo,
      erro: null,
    };
  } catch (e) {
    return { areaHa: "—", perimetroM: "—", qtdM: 0, qtdP: 0, qtdV: 0, primeiroParagrafo: "", erro: e instanceof Error ? e.message : String(e) };
  }
}
