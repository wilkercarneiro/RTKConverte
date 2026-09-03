// Planta do CSV de exportação do SIGEF de uma parcela vizinha: o polígono
// certificado com os vértices clicáveis. O operador marca quais deles são a
// divisa com o imóvel que está sendo levantado; o parse-txt une os marcados ao
// TXT (ver _shared/certificados.ts).
//
// Só exibição: a projeção é local (fuso do centroide do CSV) e serve para
// desenhar. Quem calcula o que vai ao banco é o servidor.
import { useMemo } from "react";
import proj4mod from "proj4";
import { GEO_DEF, utmDef } from "../../supabase/functions/_shared/geo.ts";
import { lonLatDoVerticeSigef } from "../../supabase/functions/_shared/certificados.ts";
import type { VerticeSigef } from "../../supabase/functions/_shared/certificados.ts";
import { PlantaSelecao } from "./PlantaSelecao";
import type { PontoSelecao } from "./PlantaSelecao";

const proj = proj4mod as unknown as (from: string, to: string, c: [number, number]) => [number, number];
const fmt = (v: number, dec: number) => v.toFixed(dec).replace(".", ",");

const COLUNAS = ["Nº", "Código", "Tipo", "Método", "σ (m)", "h (m)", "Latitude", "Longitude"];

export function PlantaCertificada({ vertices, selecionados, onChange }: {
  vertices: VerticeSigef[];
  /** códigos dos vértices escolhidos */
  selecionados: Set<string>;
  onChange: (s: Set<string>) => void;
}) {
  const pontos = useMemo<PontoSelecao[]>(() => {
    const lonMed = vertices.reduce((s, v) => s + v.lon, 0) / (vertices.length || 1);
    const zone = Math.min(25, Math.max(18, Math.floor((lonMed + 180) / 6) + 1));
    const ud = utmDef(zone);
    return vertices.map((v) => {
      const [lon, lat] = lonLatDoVerticeSigef(v);
      const [x, y] = proj(GEO_DEF, ud, [lon, lat]);
      return {
        id: v.codigo, x, y, rotulo: String(v.indice), tipo: v.tipo,
        titulo: `${v.codigo} · ${v.tipo} · ${v.metodo} · h ${fmt(v.h, 2)} m\n${v.latGms} / ${v.lonGms}`,
        celulas: [
          String(v.indice), v.codigo, <span className={`chip ${v.tipo}`}>{v.tipo}</span>, v.metodo,
          fmt(Math.max(v.sigmaX, v.sigmaY), 3), fmt(v.h, 2), v.latGms, v.lonGms,
        ],
      };
    });
  }, [vertices]);

  return (
    <PlantaSelecao
      pontos={pontos} colunas={COLUNAS} selecionados={selecionados} onChange={onChange}
      ariaLabel="Planta da parcela certificada — clique nos vértices da divisa comum"
      dica={<>Clique no primeiro vértice da divisa comum e depois no último: todos os que estão entre eles ficam marcados, pelo caminho mais curto do anel do vizinho. <b>Shift + clique</b> força o caminho na ordem da numeração; clicar num marcado desmarca só ele.</>}
    />
  );
}
