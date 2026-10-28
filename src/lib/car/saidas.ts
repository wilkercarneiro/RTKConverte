// Arquivos de saída do CAR: um shapefile por camada, cada um no seu zip (é
// assim que o SICAR pede o envio), mais um zip com todos e um KML de conferência.
import JSZip from "jszip";
import { gravarShapefile, juntarNoZip } from "./shapefile.ts";
import type { ArquivosShp, PoligonoGeo } from "./shapefile.ts";
import { paraGeo } from "./motor.ts";
import type { ProjetoCar, ResultadoCar } from "./motor.ts";

export type CamadaCar = "imovel" | "reserva" | "produtiva" | "app";

export const CAMADAS: { id: CamadaCar; arquivo: string; titulo: string; nomeDbf: string; cor: string }[] = [
  { id: "imovel", arquivo: "AREA_IMOVEL", titulo: "Área total do imóvel", nomeDbf: "IMOVEL", cor: "#F5C542" },
  { id: "reserva", arquivo: "RESERVA_LEGAL", titulo: "Reserva legal", nomeDbf: "RESERVA", cor: "#2E9E5B" },
  { id: "produtiva", arquivo: "AREA_PRODUTIVA", titulo: "Área produtiva", nomeDbf: "PRODUTIVA", cor: "#E8A33D" },
  { id: "app", arquivo: "APP", titulo: "Área de preservação permanente", nomeDbf: "APP", cor: "#3B8BD9" },
];

/** Os polígonos (em grau) de cada camada. O imóvel sai EXATAMENTE como veio no KML. */
export function poligonosDaCamada(pr: ProjetoCar, res: ResultadoCar, c: CamadaCar): PoligonoGeo[] {
  if (c === "imovel") return [{ ext: pr.perimetro, furos: [] }];
  const pols = c === "reserva" ? res.reserva : c === "app" ? res.app : res.produtiva;
  return paraGeo(res.plano, pols, pr.perimetro);
}

export function shapefileDaCamada(pr: ProjetoCar, res: ResultadoCar, c: CamadaCar): ArquivosShp | null {
  const pols = poligonosDaCamada(pr, res, c);
  if (!pols.length) return null;
  const def = CAMADAS.find((x) => x.id === c)!;
  return gravarShapefile([{ poligonos: pols, nome: def.nomeDbf }]);
}

/** Nome de arquivo sem acento nem caractere que o Windows recusa. */
export const nomeArquivo = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").toUpperCase() || "CAR";

export async function zipDaCamada(pr: ProjetoCar, res: ResultadoCar, c: CamadaCar): Promise<Blob> {
  const a = shapefileDaCamada(pr, res, c);
  if (!a) throw new Error("Essa camada está vazia.");
  const zip = new JSZip();
  juntarNoZip(zip, CAMADAS.find((x) => x.id === c)!.arquivo, a);
  return zip.generateAsync({ type: "blob" });
}

/** Tudo num zip só: uma pasta por camada (camada vazia fica de fora) + o KML. */
export async function zipCompleto(pr: ProjetoCar, res: ResultadoCar): Promise<Blob> {
  const zip = new JSZip();
  for (const c of CAMADAS) {
    const a = shapefileDaCamada(pr, res, c.id);
    if (a) juntarNoZip(zip, c.arquivo, a, c.arquivo);
  }
  zip.file(`${nomeArquivo(pr.nome)}_CAR.kml`, gerarKmlCar(pr, res));
  return zip.generateAsync({ type: "blob" });
}

/** KML com as camadas coloridas, para conferir no Google Earth antes de enviar. */
export function gerarKmlCar(pr: ProjetoCar, res: ResultadoCar): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  // cor KML é aabbggrr
  const kmlCor = (hex: string, a: string) => a + hex.slice(5, 7) + hex.slice(3, 5) + hex.slice(1, 3);
  const anel = (a: [number, number][]) => [...a, a[0]].map(([x, y]) => `${x.toFixed(12)},${y.toFixed(12)},0`).join(" ");
  const estilos = CAMADAS.map((c) => `<Style id="${c.id}"><LineStyle><color>${kmlCor(c.cor, "ff")}</color><width>2</width></LineStyle><PolyStyle><color>${kmlCor(c.cor, c.id === "imovel" ? "00" : "66")}</color></PolyStyle></Style>`).join("");
  const marcas = CAMADAS.flatMap((c) => poligonosDaCamada(pr, res, c.id).map((p, i, todos) =>
    `<Placemark><name>${esc(c.titulo)}${todos.length > 1 ? ` ${i + 1}` : ""}</name><styleUrl>#${c.id}</styleUrl><Polygon>`
    + `<outerBoundaryIs><LinearRing><coordinates>${anel(p.ext)}</coordinates></LinearRing></outerBoundaryIs>`
    + p.furos.map((f) => `<innerBoundaryIs><LinearRing><coordinates>${anel(f)}</coordinates></LinearRing></innerBoundaryIs>`).join("")
    + `</Polygon></Placemark>`)).join("\n");
  const rios = pr.rios.filter((r) => r.linha.length >= 2).map((r) =>
    `<Placemark><name>${esc(r.nome)} (APP ${r.faixa} m)</name><Style><LineStyle><color>ffd98b3b</color><width>3</width></LineStyle></Style><LineString><coordinates>${r.linha.map(([x, y]) => `${x.toFixed(12)},${y.toFixed(12)},0`).join(" ")}</coordinates></LineString></Placemark>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${esc(pr.nome)} — CAR</name>${estilos}
${marcas}
${rios}
</Document></kml>
`;
}

export function baixar(conteudo: Blob | string, nome: string, tipo = "application/octet-stream"): void {
  const blob = typeof conteudo === "string" ? new Blob([conteudo], { type: tipo }) : conteudo;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = nome;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
