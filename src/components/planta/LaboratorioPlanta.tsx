// Laboratório do editor de planta (só no `npm run dev`, rota #/lab/planta):
// gera no navegador, com o MESMO planta.ts das edge functions, a planta do anel
// real da FAZENDA SALGADA VELHA (a fixture dos testes) e abre o visualizador.
// Serve para desenvolver o editor sem login, sem banco e sem publicar função.
import { useState } from "react";
import proj4 from "proj4";
import { montarServico } from "../../../supabase/functions/_shared/servico.ts";
import { geometriaDoCalculo } from "../../../supabase/functions/_shared/planta_dados.ts";
import { gerarPlantaPdf, type Folha } from "../../../supabase/functions/_shared/planta.ts";
// @ts-expect-error fixture em JS dos testes, sem declaração de tipos
import { dadosPlantaDe, entrada } from "../../../tests/fixtures/salgada_velha.mjs";
import { abrirPlanta } from "./VisualizadorPlanta";
import { Dica } from "../ui";

/** Uma "imagem de satélite" sintética, para a planta de situação não sair vazia. */
async function satelite(): Promise<Uint8Array> {
  const c = document.createElement("canvas");
  c.width = 640; c.height = 440;
  const g = c.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, 640, 440);
  grad.addColorStop(0, "#5d7a3a"); grad.addColorStop(0.5, "#8a9a5b"); grad.addColorStop(1, "#4f6b34");
  g.fillStyle = grad; g.fillRect(0, 0, 640, 440);
  g.strokeStyle = "#d9c9a3"; g.lineWidth = 6; g.beginPath(); g.moveTo(0, 300); g.bezierCurveTo(200, 260, 420, 380, 640, 320); g.stroke();
  g.strokeStyle = "#ffeb3b"; g.lineWidth = 3; g.strokeRect(250, 150, 140, 110);
  const b = await new Promise<Blob>((ok) => c.toBlob((x) => ok(x!), "image/jpeg", 0.85));
  return new Uint8Array(await b.arrayBuffer());
}

export function LaboratorioPlanta() {
  const [folha, setFolha] = useState<Folha>("A1");
  const [erro, setErro] = useState<string | null>(null);

  async function abrir() {
    setErro(null);
    try {
      const g = geometriaDoCalculo(montarServico(entrada(), (f: string, t: string, xy: [number, number]) => proj4(f, t, xy)));
      // vizinhos com nome, matrícula e CPF, como no serviço real
      const trechos = g.trechos.map((t, i) => t.isEstrada ? t : {
        ...t, descritivo: `(MATR.${1200 + i}/CNS.00.810-2) FAZENDA ${["BOA ESPERANÇA", "SÃO JOSÉ", "LAGOA DO MATO", "RIACHO SECO"][i % 4]}\\JOSÉ DA SILVA ${i + 1}\\CPF:000.000.00${i}-00`,
      });
      const img = { bytes: await satelite(), tipo: "jpg" as const };
      const dados = dadosPlantaDe({ ...g, trechos }, { folha, satelite: img, logo: img, conferencia: folha === "A4" });
      const bytes = await gerarPlantaPdf(dados, undefined, { editavel: true });
      abrirPlanta({ bytes, nome: `Planta ${folha} - FAZENDA SALGADA VELHA`, titulo: `Planta ${folha} · FAZENDA SALGADA VELHA (laboratório)` });
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div style={{ padding: 40, display: "grid", gap: 16, maxWidth: 560 }}>
      <h2 style={{ margin: 0 }}>Laboratório · editor de planta<Dica>Gera a planta da fixture SALGADA VELHA no navegador e abre o visualizador com o editor.</Dica></h2>
      <div className="acoes-linha" style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <select value={folha} onChange={(e) => setFolha(e.target.value as Folha)}>
          <option value="A1">A1</option><option value="A3">A3</option><option value="A4">A4 (conferência)</option>
        </select>
        <button className="principal" onClick={abrir}>Gerar e abrir a planta</button>
      </div>
      {erro && <div className="erro">{erro}</div>}
    </div>
  );
}
