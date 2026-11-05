// GPX 1.1 para o GPS de navegação (Garmin e afins).
//
// Cada vértice vira um waypoint com nome e altitude (é o que o GPS lista e
// deixa "ir até"); cada polígono vira uma trilha FECHADA (o último ponto repete
// o primeiro, para o GPS desenhar a divisa inteira) e cada linha, uma trilha.
// Furo de polígono entra como outro segmento da mesma trilha. SIRGAS 2000 e
// WGS 84 coincidem na precisão de um GPS de mão: não há conversão a fazer.
import { pontosDasCamadas } from "./coordenadas.ts";
import type { CamadaPronta } from "./coordenadas.ts";
import type { XY } from "./tipos.ts";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const g9 = (v: number) => v.toFixed(9);
const ele = (h: number | null | undefined) => (typeof h === "number" ? `<ele>${h.toFixed(3)}</ele>` : "");

function segmento(geo: XY[], alt: (number | null)[], fechado: boolean): string {
  const idx = geo.map((_, i) => i);
  if (fechado && geo.length) idx.push(0);
  return `<trkseg>${idx.map((i) => `<trkpt lat="${g9(geo[i][1])}" lon="${g9(geo[i][0])}">${ele(alt[i])}</trkpt>`).join("")}</trkseg>`;
}

export function gerarGpxArea(camadas: CamadaPronta[], nome: string): string {
  // GPX 1.1: metadata, depois todos os wpt, depois as trilhas (a ordem é do esquema)
  const wpts = pontosDasCamadas(camadas).map((p) =>
    `<wpt lat="${g9(p.geo[1])}" lon="${g9(p.geo[0])}">${ele(p.alt)}<name>${esc(p.nome)}</name><desc>${esc(p.camada)}</desc><sym>Flag, Blue</sym></wpt>`);
  const trilhas = camadas.flatMap((c) => c.feicoes.filter((f) => f.tipo !== "ponto").map((f) => {
    const segs = f.tipo === "poligono"
      ? [segmento(f.geo, f.alt, true), ...f.furosGeo.map((h) => segmento(h, [], true))]
      : [segmento(f.geo, f.alt, false)];
    return `<trk><name>${esc(f.nome)}</name><desc>${esc(c.nome)}</desc>${segs.join("")}</trk>`;
  }));
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="Vertces" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">',
    `<metadata><name>${esc(nome)}</name><desc>Coordenadas SIRGAS 2000. Gerado pelo Vertces.</desc></metadata>`,
    ...wpts,
    ...trilhas,
    "</gpx>",
    "",
  ].join("\n");
}
