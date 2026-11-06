// Laboratório da Consultar imóvel (só no `npm run dev`, #/lab/consulta): a tela
// de verdade com as respostas reais gravadas em Lençóis/BA (-12,40 / -41,20),
// sem login e sem internet (o mapa de fundo é a única coisa que vem da rede).
//
//   #/lab/consulta                          estado inicial (consultas recentes vazias até a 1ª consulta)
//   #/lab/consulta?q=-12.40,-41.20          consulta o ponto (acha o CAR e analisa)
//   #/lab/consulta?q=BA-2919306-4185CFD257C54A4788F5C145A504C5C8
//   #/lab/consulta?estado=carregando&q=…    a busca não termina (carregando)
//   #/lab/consulta?estado=analisando&q=…    a análise não termina (cartões carregando)
//   #/lab/consulta?estado=fora&q=…          SICAR/SoilGrids/INPE fora do ar
//   #/lab/consulta?estado=erro&q=BA-…       o SICAR não responde a busca pelo código
//   #/lab/consulta?q=-12.43,-41.25          ponto sem imóvel (nada encontrado)
//   #/lab/consulta?estado=historico-erro    as consultas recentes não carregam
//   sem-casca: a tela pura, sem o menu do sistema
import { useMemo } from "react";
import { rotaParaHash } from "../../lib/rota";
import { CascaLab } from "../CascaLab";
import { ConsultaImovel } from "./ConsultaImovel";
import { fontesDoLaboratorio } from "./fontesLab";
import type { EstadoLab } from "./fontesLab";

export function LaboratorioConsulta() {
  const q = new URLSearchParams(location.hash.split("?")[1] ?? "");
  const estado = (q.get("estado") ?? "normal") as EstadoLab;
  const fontes = useMemo(() => fontesDoLaboratorio(estado), [estado]);
  return (
    <CascaLab>
      <ConsultaImovel ir={(r) => { location.hash = rotaParaHash(r); }} fontes={fontes} inicial={q.get("q") ?? undefined} atualizarEndereco={false} />
    </CascaLab>
  );
}
