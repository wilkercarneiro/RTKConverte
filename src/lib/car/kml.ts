// Leitura do KML de entrada do CAR.
//
// O KML que chega é o da área total do imóvel, exportado do CAD ou do Google
// Earth. O CAD costuma gravar o perímetro como LineString FECHADA (último ponto
// = primeiro), não como Polygon — os dois valem. Linha ABERTA no mesmo arquivo
// é tratada como rio já traçado (vira APP com a faixa padrão, ajustável).
//
// Sem DOMParser de propósito: o mesmo código roda no navegador e nos testes
// do node, e o KML que importa aqui é sempre plano (Placemark → geometria).

export type LonLat = [number, number];

export interface LinhaKml { nome: string; linha: LonLat[] }

export interface KmlLido {
  /** nome do documento (ou do placemark do perímetro) */
  nome: string | null;
  /** anel aberto (sem repetir o primeiro ponto), na ordem do arquivo */
  perimetro: LonLat[];
  rios: LinhaKml[];
  avisos: string[];
}

/** Dois pontos iguais em grau: 1e-8° ≈ 1 mm. */
const IGUAL = 1e-8;

const tirarTags = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, "").trim();

function nomeDe(bloco: string): string | null {
  const m = /<name>([\s\S]*?)<\/name>/i.exec(bloco);
  const n = m ? tirarTags(m[1]) : "";
  return n || null;
}

function coordenadas(texto: string): LonLat[] {
  const out: LonLat[] = [];
  for (const tupla of tirarTags(texto).split(/\s+/)) {
    if (!tupla) continue;
    const [lon, lat] = tupla.split(",").map(Number);
    if (Number.isFinite(lon) && Number.isFinite(lat)) out.push([lon, lat]);
  }
  // pontos repetidos em sequência (o CAD às vezes grava o mesmo vértice duas vezes)
  return out.filter((p, i) => i === 0 || Math.abs(p[0] - out[i - 1][0]) > IGUAL || Math.abs(p[1] - out[i - 1][1]) > IGUAL);
}

const fechada = (l: LonLat[]) =>
  l.length >= 4 && Math.abs(l[0][0] - l[l.length - 1][0]) <= IGUAL && Math.abs(l[0][1] - l[l.length - 1][1]) <= IGUAL;

/** Área em grau² (só para escolher o maior anel). */
function areaGrau(anel: LonLat[]): number {
  let s = 0;
  for (let i = 0; i < anel.length; i++) {
    const a = anel[i], b = anel[(i + 1) % anel.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(s / 2);
}

export function lerKml(texto: string): KmlLido {
  const semComentario = texto.replace(/<!--[\s\S]*?-->/g, "");
  const doc = /<Document[^>]*>([\s\S]*)<\/Document>/i.exec(semComentario)?.[1] ?? semComentario;
  const nomeDoc = nomeDe(doc.replace(/<Placemark[\s\S]*?<\/Placemark>/gi, "").replace(/<Folder[\s\S]*?<\/Folder>/gi, ""));

  const aneis: { nome: string | null; anel: LonLat[] }[] = [];
  const linhas: LinhaKml[] = [];
  const placemarks = semComentario.match(/<Placemark[\s\S]*?<\/Placemark>/gi) ?? [];
  for (const pm of placemarks) {
    const nome = nomeDe(pm);
    // Polygon: só o contorno externo (furo em imóvel de CAR não existe na entrada)
    for (const pol of pm.match(/<Polygon[\s\S]*?<\/Polygon>/gi) ?? []) {
      const ext = /<outerBoundaryIs>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/i.exec(pol);
      if (ext) aneis.push({ nome, anel: coordenadas(ext[1]) });
    }
    const semPoligono = pm.replace(/<Polygon[\s\S]*?<\/Polygon>/gi, "");
    for (const m of semPoligono.matchAll(/<(LineString|LinearRing)[^>]*>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/gi)) {
      const pts = coordenadas(m[2]);
      if (m[1].toLowerCase() === "linearring" || fechada(pts)) aneis.push({ nome, anel: pts });
      else if (pts.length >= 2) linhas.push({ nome: nome ?? `Rio ${linhas.length + 1}`, linha: pts });
    }
  }

  const avisos: string[] = [];
  const validos = aneis
    .map((a) => ({ ...a, anel: fechada(a.anel) ? a.anel.slice(0, -1) : a.anel }))
    .filter((a) => a.anel.length >= 3);
  if (!validos.length) {
    throw new Error(linhas.length
      ? "O KML só tem linhas abertas. O perímetro do imóvel precisa ser um polígono (ou uma linha fechada, com o último ponto igual ao primeiro)."
      : "Não achei nenhum polígono no KML. Exporte a área total do imóvel como polígono ou linha fechada.");
  }
  validos.sort((a, b) => areaGrau(b.anel) - areaGrau(a.anel));
  const principal = validos[0];
  if (validos.length > 1) {
    avisos.push(`O KML tem ${validos.length} polígonos; usei o maior${principal.nome ? ` (${principal.nome})` : ""} como área total do imóvel e ignorei os outros.`);
  }
  if (linhas.length) avisos.push(`${linhas.length} linha(s) aberta(s) entraram como rio — confira a faixa de APP de cada uma.`);
  return { nome: nomeDoc ?? principal.nome, perimetro: principal.anel, rios: linhas, avisos };
}
