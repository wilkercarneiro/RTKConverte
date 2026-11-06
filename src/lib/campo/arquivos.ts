// "Baixar ▾" da medição: as camadas no formato da Exportar a área
// (src/lib/exportar), gerado aqui mesmo no aparelho — a medição não é serviço
// (não há imóvel a fixar nem crédito a gastar) e no campo pode não haver rede.
//
// Camadas: AREA (o contorno, quando fechado) ou TRAJETO (a linha, se ainda
// aberto) e VERTICES (P1, P2… com a precisão de cada um).
import { exportarArea } from "../exportar/index.ts";
import type { ArquivoArea, Camada, FormatoArea } from "../exportar/index.ts";
import { fusoDaMedicao } from "./geometria.ts";
import type { Medicao } from "./tipos.ts";

const hora = (t: number) => {
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

export function camadasDaMedicao(m: Medicao): Camada[] {
  const geo = m.vertices.map((v) => [v.lon, v.lat] as [number, number]);
  const alt = m.vertices.map((v) => (v.alt != null && Number.isFinite(v.alt) ? v.alt : null));
  const camadas: Camada[] = [];
  if (m.fechada && geo.length >= 3) {
    camadas.push({ nome: "AREA", cor: "#178552", feicoes: [{ nome: m.nome, tipo: "poligono", geo, alt, props: { origem: "GPS do celular", vertices: geo.length } }] });
  } else if (geo.length >= 2) {
    camadas.push({ nome: "TRAJETO", cor: "#178552", feicoes: [{ nome: m.nome, tipo: "linha", geo, alt }] });
  }
  camadas.push({
    nome: "VERTICES",
    feicoes: m.vertices.map((v, i) => ({
      nome: `P${i + 1}`, tipo: "ponto" as const, geo: [[v.lon, v.lat] as [number, number]], alt: [alt[i]],
      props: {
        precisao_m: v.precisao == null ? null : Math.round(v.precisao * 10) / 10,
        modo: v.modo === "mao" ? "desenhado" : v.modo === "ponto" ? "ponto marcado" : "caminhando",
        hora: hora(v.t),
      },
    })),
  });
  return camadas;
}

export function arquivoDaMedicao(m: Medicao, formato: FormatoArea): Promise<ArquivoArea> {
  if (!m.vertices.length) return Promise.reject(new Error("A medição ainda não tem vértices."));
  return exportarArea(camadasDaMedicao(m), formato, { fuso: fusoDaMedicao(m.vertices), nome: m.nome });
}
