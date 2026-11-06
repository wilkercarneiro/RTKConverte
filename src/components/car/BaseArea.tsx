// Em que área o CAR fala: o agrimensor escolhe entre a UTM (a mesma do Campo,
// da Consulta e do SIGEF) e a de projeção de área igual (Albers, o cálculo de
// sempre do módulo). As porcentagens são as mesmas nas duas; mudam os hectares
// do quadro, dos shapefiles e a meta da vegetação cedida.
import { useMemo } from "react";
import { areasDasBases, fmtHa } from "../../lib/car/motor.ts";
import type { BaseAreaCar } from "../../lib/car/motor.ts";
import type { LonLat } from "../../lib/car/kml.ts";
import { Dica } from "../ui";

function diferenca(m2: number): string {
  const a = Math.abs(m2);
  return a >= 10_000 ? fmtHa(a) : `${a.toLocaleString("pt-BR", { maximumFractionDigits: a < 10 ? 1 : 0 })} m²`;
}

export function EscolhaBaseArea({ perimetro, valor, onMudar, compacta = false }: {
  perimetro: LonLat[];
  valor: BaseAreaCar;
  onMudar: (b: BaseAreaCar) => void;
  /** no painel do projeto: rótulos curtos */
  compacta?: boolean;
}) {
  const areas = useMemo(() => areasDasBases(perimetro), [perimetro]);
  const d = areas.utm - areas.albers;
  const opcoes: { id: BaseAreaCar; titulo: string; sub: string }[] = [
    { id: "utm", titulo: compacta ? "UTM" : "UTM (a do SIGEF)", sub: compacta ? "a do SIGEF e do Campo" : "a mesma do Campo, da Consulta e do SIGEF" },
    { id: "albers", titulo: compacta ? "Área igual" : "Projeção de área igual", sub: compacta ? "Albers no imóvel" : "Albers colada no imóvel" },
  ];
  return (
    <fieldset className={`car-base${compacta ? " compacta" : ""}`}>
      <legend>
        Área usada no CAR
        <Dica>
          As duas medem o mesmo perímetro, mas cada projeção chega a um número diferente
          {Math.abs(d) >= 0.5 ? ` (aqui, ${diferenca(d)} de diferença)` : ""}. A UTM no fuso do lugar é a que o SIGEF imprime
          e, em geral, a que vem declarada no SICAR. A de área igual (Albers) não depende de fuso. As porcentagens de reserva
          legal e APP são as mesmas nas duas; mudam os hectares do quadro, dos shapefiles e a meta da vegetação cedida.
          Dá para trocar depois, no projeto.
        </Dica>
      </legend>
      <div className="car-base-opcoes" role="radiogroup" aria-label="Área usada no CAR">
        {opcoes.map((o) => (
          <button key={o.id} type="button" role="radio" aria-checked={valor === o.id}
            className={`car-base-opcao${valor === o.id ? " ativa" : ""}`} onClick={() => onMudar(o.id)}>
            <span className="car-base-titulo">{o.titulo}</span>
            <b>{fmtHa(areas[o.id])}</b>
            <small>{o.sub}</small>
          </button>
        ))}
      </div>
    </fieldset>
  );
}
