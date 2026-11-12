// Os imóveis vizinhos do CAR, para a sobreposição (src/lib/car/sobreposicao.ts):
//   - os CAR declarados no SICAR (GeoServer público, direto do navegador — o
//     mesmo da Consultar imóvel, src/lib/consulta/car.ts);
//   - as parcelas certificadas do SIGEF (base do sistema, atualizada pelo INCRA
//     na hora quando dá — o mesmo do serviço GEO e da Consulta).
// É o que o SEIA/CEFIR e o próprio SICAR conferem ao receber o CAR.
import { carNaCaixa, ufsCandidatas } from "../consulta/car.ts";
import { caixaComMargem } from "../consulta/geometria.ts";
import type { Caixa } from "../consulta/geometria.ts";
import { consultarSigef, sincronizarSigef } from "../sigef";
import type { FeatureParcela } from "../sigef";
import type { LonLat } from "./kml.ts";
import type { VizinhoCar } from "./sobreposicao.ts";

export interface VizinhosDoCar {
  vizinhos: VizinhoCar[];
  /** a caixa consultada (o perímetro que sair dela pede consulta nova) */
  caixa: Caixa;
  /** bases que não responderam: sem elas não dá para dizer que está livre */
  falhas: string[];
  /** alguma base devolveu só parte dos imóveis da caixa */
  cortada: boolean;
  quando: string;
}

/** Quem traz os vizinhos (o laboratório troca por respostas gravadas). */
export type FonteVizinhos = (perimetro: LonLat[], uf: string | null) => Promise<VizinhosDoCar>;

/** Margem da caixa consultada: o perímetro pode andar um pouco sem consultar de novo. */
export const MARGEM_CAIXA_M = 300;

function poligonosDoGeo(g: FeatureParcela["geometry"] | null | undefined): LonLat[][][] {
  if (!g) return [];
  const pol = (c: number[][][]) => c.map((a) => a.map((p) => [Number(p[0]), Number(p[1])] as LonLat));
  if (g.type === "Polygon") return [pol(g.coordinates as number[][][])];
  if (g.type === "MultiPolygon") return (g.coordinates as number[][][][]).map(pol);
  return [];
}

export const vizinhosReais: FonteVizinhos = async (perimetro, uf) => {
  const aneis = [perimetro];
  const caixa = caixaComMargem(aneis, MARGEM_CAIXA_M);
  const [o, s, l, n] = caixa;
  const ufs = [...new Set([uf, ...[[o, s], [l, s], [l, n], [o, n], [(o + l) / 2, (s + n) / 2]].flatMap(([x, y]) => ufsCandidatas(x, y))]
    .filter((u): u is string => !!u && /^[A-Z]{2}$/.test(u)))];
  const falhas: string[] = [];
  let cortada = false;
  const vizinhos: VizinhoCar[] = [];

  const car = Promise.allSettled(ufs.map((u) => carNaCaixa(caixa, u, { max: 200 }))).then((rs) => {
    rs.forEach((r, i) => {
      if (r.status === "rejected") { falhas.push(`CAR de ${ufs[i]} (SICAR): ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`); return; }
      cortada ||= r.value.cortada;
      for (const im of r.value.imoveis) {
        if (!im.codigo) continue;
        vizinhos.push({ fonte: "car", codigo: im.codigo, rotulo: `CAR ${im.codigo}`, situacao: im.situacao, poligonos: im.poligonos });
      }
    });
  });

  const sigef = (async () => {
    try {
      // traz do INCRA o que houver em volta (sem a UF, fica a base do sistema)
      if (uf) await sincronizarSigef(aneis, uf).catch(() => null);
      const r = await consultarSigef(aneis, { raioM: MARGEM_CAIXA_M });
      for (const f of r.parcelas.features) {
        const p = f.properties;
        if (!p?.codigo) continue;
        const nome = p.nome?.trim();
        vizinhos.push({
          fonte: "sigef", codigo: p.codigo, rotulo: `SIGEF ${nome || p.codigo.slice(0, 8)}`,
          situacao: p.situacao ?? "Certificada", poligonos: poligonosDoGeo(f.geometry),
        });
      }
    } catch (e) {
      falhas.push(`SIGEF: ${e instanceof Error ? e.message : String(e)}`);
    }
  })();

  await Promise.all([car, sigef]);
  return { vizinhos, caixa, falhas, cortada, quando: new Date().toISOString() };
};

/** O perímetro ainda está dentro da caixa já consultada? */
export function dentroDaCaixa(perimetro: LonLat[], caixa: Caixa): boolean {
  return perimetro.every(([x, y]) => x >= caixa[0] && x <= caixa[2] && y >= caixa[1] && y <= caixa[3]);
}
