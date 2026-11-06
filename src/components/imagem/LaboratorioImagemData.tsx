// Laboratório (só no npm run dev): o mapa do painel SIGEF com o seletor de
// imagem por data, sem login.
//   #/lab/imagem                  acervo de verdade da Esri (precisa de internet)
//   #/lab/imagem/fixture          acervo de mentira, sem internet
//   #/lab/imagem/lento            de mentira e devagar (estado "carregando")
//   #/lab/imagem/metadados-fora   a lista sai, mas sem a data da foto
//   #/lab/imagem/vazio            lugar sem imagem antiga
//   #/lab/imagem/erro             acervo fora do ar
//   #/lab/imagem/sem-area         mapa sem imóvel (contrato com centro = null), Esri de verdade
import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import type { Map as MapaGl } from "maplibre-gl";
import { MapaInterativo } from "../MapaInterativo";
import type { PontoMapa } from "../MapaInterativo";
import { BotaoTelaCheia } from "../TelaCheia";
import { Abas, CabecalhoPagina } from "../ui";
import { limparCache, usarFonte } from "../../lib/imagem_data";
import { ANEL_LAB, fonteLaboratorio } from "./fonteLab";
import type { CenarioLab } from "./fonteLab";
import { SeletorImagemData } from "./SeletorImagemData";

type Cenario = "esri" | CenarioLab | "sem-area";

const ABAS: { chave: Cenario; rotulo: string }[] = [
  { chave: "esri", rotulo: "Esri de verdade" },
  { chave: "fixture", rotulo: "Sem internet" },
  { chave: "lento", rotulo: "Lento" },
  { chave: "metadados-fora", rotulo: "Sem data da foto" },
  { chave: "vazio", rotulo: "Sem histórico" },
  { chave: "erro", rotulo: "Fora do ar" },
  { chave: "sem-area", rotulo: "Sem imóvel" },
];

const lerCenario = (): Cenario => {
  const c = location.hash.replace(/^#\/lab\/imagem\/?/, "").split(/[/?]/)[0];
  return (ABAS.find((a) => a.chave === c)?.chave ?? "esri") as Cenario;
};

const PONTOS: PontoMapa[] = ANEL_LAB.map((p, i) => ({ lonlat: p, rotulo: `M-${String(i + 1).padStart(2, "0")}` }));

/** Mapa simples sem imóvel: o seletor procura no centro da vista. */
function MapaSemArea() {
  const ref = useRef<HTMLDivElement>(null);
  const [mapa, setMapa] = useState<MapaGl | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    const m = new maplibregl.Map({
      container: ref.current, center: [-51.905, -6.6048], zoom: 15, attributionControl: false,
      style: {
        version: 8,
        sources: { esri: { type: "raster", tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"], tileSize: 256, maxzoom: 19, attribution: "© Esri World Imagery" } },
        layers: [{ id: "satelite", type: "raster", source: "esri" }],
      },
    });
    m.addControl(new maplibregl.NavigationControl(), "top-right");
    m.addControl(new maplibregl.AttributionControl({ compact: false }), "bottom-right");
    setMapa(m);
    return () => { setMapa(null); m.remove(); };
  }, []);
  return (
    <>
      <div ref={ref} className="mapa-interativo" style={{ height: 520 }} />
      <SeletorImagemData mapa={mapa} centro={null} />
    </>
  );
}

export function LaboratorioImagemData() {
  const [cenario, setCenario] = useState<Cenario>(lerCenario);
  const [largura, setLargura] = useState(() => innerWidth);
  useEffect(() => {
    const f = () => setLargura(innerWidth);
    addEventListener("resize", f);
    return () => removeEventListener("resize", f);
  }, []);
  // a fonte precisa estar trocada ANTES de o mapa nascer
  const fonte = useMemo(() => {
    limparCache();
    const f = cenario === "esri" || cenario === "sem-area" ? null : fonteLaboratorio(cenario);
    usarFonte(f);
    return f;
  }, [cenario]);
  useEffect(() => () => usarFonte(null), []);

  function trocar(c: Cenario) {
    history.replaceState(null, "", `#/lab/imagem${c === "esri" ? "" : `/${c}`}`);
    setCenario(c);
  }

  return (
    <div className="pagina">
      <CabecalhoPagina olho="Laboratório · Ferramentas" titulo="Imagem por data"
        descricao="O mapa do imóvel com o seletor de imagem por data (acervo Esri World Imagery Wayback). Escolha uma data, compare duas, baixe a imagem com carimbo ou copie a fonte para o laudo." />
      <Abas abas={ABAS} ativa={cenario} onTrocar={trocar} rotulo="Cenário" />
      {cenario === "sem-area" ? (
        <MapaSemArea key="sem-area" />
      ) : (
        <div className="mapa-cert" data-tela-cheia="" key={`${cenario}-${fonte?.nome ?? "esri"}`}>
          <BotaoTelaCheia className="mapa-cert-tela-cheia" />
          <MapaInterativo aneis={[ANEL_LAB]} pontos={PONTOS} altura={largura < 700 ? 520 : 600} />
        </div>
      )}
    </div>
  );
}
