// Laboratório local do CAR (só no `npm run dev`, rota #/lab/car): a tela
// inteira com o KML real de exemplo (tests/fixtures/car/PLANTA.kml), sem login
// e sem banco — o projeto fica no navegador.
import type { Servico } from "../../lib/types";
import { lerKml } from "../../lib/car/kml.ts";
import { projetoNovo } from "../../lib/car/motor.ts";
import type { ProjetoCar } from "../../lib/car/motor.ts";
import kml from "../../../tests/fixtures/car/PLANTA.kml?raw";
import { definicaoDe } from "../../lib/modalidades";
import { rotaParaHash, voltarDoNovo } from "../../lib/rota";
import { Car } from "./Car";
import { CarNovo } from "./CarNovo";

const servico = {
  id: "lab-car", tipo: "geo", modalidade: "car", tem_glebas: false, status: "rascunho",
  nome_arquivo_txt: "PLANTA.kml", denominacao: "FAZENDA DEMO", uf: "BA",
} as unknown as Servico;

const CHAVE = "vertice.lab.car";

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
  return (
    <Car servico={servico} onVoltar={() => { location.hash = "#/"; }}
      armazenamento={{
        carregar: async () => {
          try {
            const salvo = JSON.parse(localStorage.getItem(CHAVE) ?? "null") as Partial<ProjetoCar> | null;
            if (salvo) return salvo;
          } catch { /* sem armazenamento */ }
          const k = lerKml(kml);
          return projetoNovo("FAZENDA DEMO", k.perimetro, k.rios);
        },
        salvar: async (_id, p) => { try { localStorage.setItem(CHAVE, JSON.stringify(p)); } catch { /* sem armazenamento */ } },
      }} />
  );
}
