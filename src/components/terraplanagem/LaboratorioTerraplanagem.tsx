// Laboratório (só no npm run dev, #/lab/terraplanagem): a tela com o
// levantamento de exemplo (tests/fixtures/terraplanagem, 298 pontos num
// terreno com declive), sem login, sem banco e sem internet — o projeto fica
// no navegador.
//   #/lab/terraplanagem            o projeto de exemplo (o que foi mexido continua)
//   #/lab/terraplanagem/novo       o exemplo do zero
//   #/lab/terraplanagem/retangulo  plataforma de galpão 50 × 30 m com caimento de 1%
//   #/lab/terraplanagem/incompleto plataforma de 900 × 30 m saindo do levantamento (resultado incompleto)
//   #/lab/terraplanagem/inicio     a tela de entrada (soltar arquivo, relevo público, recentes)
import { AppShell } from "../AppShell";
import { lerPontos } from "../../lib/terraplanagem/pontos.ts";
import { normalizarProjeto, projetoNovo } from "../../lib/terraplanagem/modelo.ts";
import type { ProjetoTerraplanagem } from "../../lib/terraplanagem/modelo.ts";
import { armazenamentoLocal } from "../../lib/terraplanagem/persistencia.ts";
import levantamento from "../../../tests/fixtures/terraplanagem/levantamento-declive.txt?raw";
import { Terraplanagem } from "./Terraplanagem";

const ID = "00000000-0000-4000-8000-00000000a7e5";

function exemplo(): ProjetoTerraplanagem {
  const l = lerPontos(levantamento);
  return { ...projetoNovo("Galpão Fazenda Boa Vista", l.pontos, { tipo: "arquivo", arquivo: "levantamento-declive.txt" }, 24, new Date("2026-11-06T10:00:00-03:00")), id: ID };
}

export function LaboratorioTerraplanagem() {
  const h = location.hash;
  let inicial: ProjetoTerraplanagem | null = null;
  if (h.includes("/inicio")) {
    // a lista de recentes mostra o exemplo
    if (!h.includes("vazio")) {
      const p = exemplo();
      void armazenamentoLocal.salvar(p, { id: p.id, nome: p.nome, atualizadoEm: p.atualizadoEm, nPontos: p.pontos.length, corte: 18993.4, aterro: 18993.4, cota: 308.274 });
    } else {
      try { for (const k of Object.keys(localStorage)) if (k.startsWith("vertces.terraplanagem.")) localStorage.removeItem(k); } catch { /* sem storage */ }
    }
  } else if (h.includes("/incompleto")) {
    // plataforma de 900 × 30 m que sai do levantamento: a tela não pode dizer "pronto"
    const p = exemplo();
    inicial = {
      ...p, nome: "Pátio comprido demais",
      plataforma: { ...p.plataforma, modo: "retangulo", retangulo: { centro: [487395, 8634205], largura: 30, comprimento: 900, giro: 62 } },
    };
  } else if (h.includes("/retangulo")) {
    const p = exemplo();
    inicial = {
      ...p, nome: "Galpão 50 × 30 m",
      plataforma: { ...p.plataforma, modo: "retangulo", retangulo: { centro: [487395, 8634205], largura: 30, comprimento: 50, giro: 62 } },
      cota: { ...p.cota, inclinacao: 1, direcao: 225 },
    };
  } else if (h.includes("/novo")) {
    inicial = exemplo();
  } else {
    let salvo: ProjetoTerraplanagem | null = null;
    try { salvo = normalizarProjeto(JSON.parse(localStorage.getItem(`vertces.terraplanagem.${ID}`) ?? "null")); } catch { /* sem storage */ }
    inicial = salvo ?? exemplo();
  }
  return (
    <AppShell rota={{ t: "terraplanagem" }} ir={() => {}} usuario={{ nome: "Laboratório", papel: "Dono" }}>
      <Terraplanagem ir={() => {}} armazenamento={armazenamentoLocal} inicial={inicial} emitente="Escritório de exemplo · Laboratório" />
    </AppShell>
  );
}
