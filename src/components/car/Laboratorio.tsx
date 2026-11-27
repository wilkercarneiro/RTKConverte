// Laboratório local do CAR (só no `npm run dev`, rota #/lab/car): a tela
// inteira com o KML real de exemplo (tests/fixtures/car/PLANTA.kml), sem login
// e sem banco — o projeto fica no navegador.
import type { Servico } from "../../lib/types";
import { lerKml } from "../../lib/car/kml.ts";
import { projetoNovo } from "../../lib/car/motor.ts";
import type { ProjetoCar } from "../../lib/car/motor.ts";
import kml from "../../../tests/fixtures/car/PLANTA.kml?raw";
// #/lab/car/glebas: imóvel de 3 glebas (2 encostadas + 1 separada) — pedido de 27/11/2026
import kmlGlebas from "../../../tests/fixtures/car/TRES_GLEBAS.kml?raw";
// a resposta do SICAR em volta do PLANTA.kml (12/11/2026): invade dois vizinhos
import vizinhosPlanta from "../../../tests/fixtures/car/sicar_vizinhos_planta.json?raw";
import type { FonteVizinhos } from "../../lib/car/vizinhos.ts";
import { caixaComMargem } from "../../lib/consulta/geometria.ts";

/** Os vizinhos gravados, sem rede (?ao-vivo no hash consulta o SICAR de verdade). */
const vizinhosGravados: FonteVizinhos = async (perimetro) => ({
  vizinhos: JSON.parse(vizinhosPlanta), caixa: caixaComMargem([perimetro], 300), falhas: [], cortada: false, quando: new Date().toISOString(),
});
import { definicaoDe } from "../../lib/modalidades";
import { rotaParaHash, voltarDoNovo } from "../../lib/rota";
import { Car } from "./Car";
import { CarNovo } from "./CarNovo";
import { CascaLab } from "../CascaLab";

const servico = {
  id: "lab-car", tipo: "geo", modalidade: "car", tem_glebas: false, status: "rascunho",
  nome_arquivo_txt: "PLANTA.kml", denominacao: "FAZENDA DEMO", uf: "BA",
} as unknown as Servico;

const CHAVE = "vertice.lab.car";
const CHAVE_GLEBAS = "vertice.lab.car.glebas";

export function LaboratorioCar() {
  // #/lab/car/novo[/<cliente>]: a entrada do KML como o App monta (#/novo/car/<cliente>), sem criar nada
  if (location.hash.startsWith("#/lab/car/novo")) {
    const clienteId = location.hash.split("/")[4] || undefined;
    const v = voltarDoNovo({ clienteId });
    return (
      <CarNovo definicao={definicaoDe("car")} clienteId={clienteId} voltarPara={v.rotulo}
        onVoltar={() => { location.hash = rotaParaHash(v.rota); }} onCriado={() => {}} />
    );
  }
  const glebas = location.hash.startsWith("#/lab/car/glebas");
  const chave = glebas ? CHAVE_GLEBAS : CHAVE;
  return (
    <CascaLab><Car servico={glebas ? { ...servico, id: "lab-car-glebas", nome_arquivo_txt: "TRES_GLEBAS.kml", denominacao: "FAZENDA TRES GLEBAS" } : servico} onVoltar={() => { location.hash = "#/"; }}
      fonteVizinhos={location.hash.includes("ao-vivo") ? undefined : vizinhosGravados}
      armazenamento={{
        carregar: async () => {
          try {
            const salvo = JSON.parse(localStorage.getItem(chave) ?? "null") as Partial<ProjetoCar> | null;
            if (salvo) return salvo;
          } catch { /* sem armazenamento */ }
          if (glebas) {
            // como o CarNovo monta: as poligonais marcadas, a 1ª no perímetro e as outras nas glebas
            const k = lerKml(kmlGlebas);
            const [p1, ...outras] = (k.poligonos ?? []).filter((p) => p.incluir);
            return projetoNovo("FAZENDA TRES GLEBAS", p1.anel, k.rios, p1.nomes, outras.map((g) => ({ nome: g.nome, anel: g.anel })), p1.nome);
          }
          const k = lerKml(kml);
          return projetoNovo("FAZENDA DEMO", k.perimetro, k.rios);
        },
        salvar: async (_id, p) => { try { localStorage.setItem(chave, JSON.stringify(p)); } catch { /* sem armazenamento */ } },
      }} /></CascaLab>
  );
}
