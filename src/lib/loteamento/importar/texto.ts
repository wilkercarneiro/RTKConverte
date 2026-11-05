// O que o nome diz: camada do DXF, pasta e nome do Placemark do KML,
// propriedade do GeoJSON e os textos do desenho (número do lote, nome da
// quadra, nome da rua). Sem diferenciar maiúsculas nem acentos: "Área Verde",
// "AREA_VERDE" e "av" são a mesma coisa.

/** O que um polígono (ou linha) do arquivo é no loteamento. "?" = a camada não diz. */
export type Classe =
  | "lote" | "quadra" | "verde" | "lazer" | "institucional" | "app" | "remanescente"
  | "viario" | "eixo" | "contorno" | "nada" | "?";

/** minúsculas, sem acento, só letras e números separados por espaço */
export function normalizar(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

const tokens = (s: string) => normalizar(s).split(" ").filter(Boolean);

const LOTE = ["lote", "lotes", "lt", "lts", "lot", "lots"];
const QUADRA = ["quadra", "quadras", "qd", "qds", "qda", "q"];
const VERDE = ["verde", "verdes", "av", "avs", "arborizacao"];
const LAZER = ["lazer", "praca", "pracas", "sl", "al", "recreacao", "recreio"];
const INSTITUCIONAL = ["institucional", "institucionais", "ai", "equipamento", "equipamentos", "comunitario", "comunitarios", "epc", "ec", "eu"];
const APP = ["app", "apps", "preservacao"];
const REMANESCENTE = ["remanescente", "remanescentes"];
const VIARIO = ["rua", "ruas", "via", "vias", "viario", "arruamento", "avenida", "pista", "leito", "logradouro", "logradouros", "calcada", "calcadas", "passeio", "passeios", "alinhamento", "alinhamentos"];
const EIXO = ["eixo", "eixos", "centerline", "centerlines"];
const CONTORNO = ["perimetro", "gleba", "limite", "limites", "divisa", "divisas", "poligonal", "contorno", "imovel"];
/** camadas de desenho que não são terreno: cota, ponto, texto solto, carimbo, curva de nível… */
const NADA = [
  "cota", "cotas", "dim", "dimensao", "dimensoes", "medida", "medidas", "ponto", "pontos", "vertice", "vertices", "marco", "marcos",
  "grid", "malha", "quadricula", "carimbo", "selo", "legenda", "moldura", "norte", "nivel", "curva", "curvas", "hachura", "hatch",
  "defpoints", "edificacao", "edificacoes", "construcao", "construcoes", "cerca", "cercas", "arvore", "arvores", "poste", "postes",
  "texto", "textos", "txt", "coordenada", "coordenadas", "linha", "central", "rede", "redes", "agua", "esgoto", "drenagem", "energia",
];

/**
 * Classe pelo nome da camada (ou da pasta / da propriedade). A ordem conta:
 * "RUA_EIXO" é eixo, "AREA_VERDE" é verde, "TEXTO_LOTE" é texto (nada como
 * polígono), "QUADRA" é quadra mesmo que a pasta diga "Quadra A (12 lotes)".
 */
export function classeDoNome(nome: string): Classe {
  const t = tokens(nome);
  const tem = (ws: string[]) => t.some((w) => ws.includes(w));
  if (!t.length) return "?";
  if (tem(EIXO)) return "eixo";
  if (tem(REMANESCENTE)) return "remanescente";
  if (tem(APP) || (t.includes("permanente") && t.includes("preservacao"))) return "app";
  if (tem(INSTITUCIONAL)) return "institucional";
  if (tem(LAZER)) return "lazer";
  if (tem(VERDE)) return "verde";
  if (tem(NADA)) return "nada";
  if (tem(QUADRA) && !tem(LOTE)) return "quadra";
  if (tem(LOTE)) return "lote";
  if (tem(VIARIO)) return "viario";
  if (tem(CONTORNO)) return "contorno";
  return "?";
}

/** O papel de um TEXTO pela camada dele: número de lote, nome de quadra, de rua, de área ou ruído (cota, ponto). */
export type PapelTexto = "lote" | "quadra" | "rua" | "area" | "nada" | "?";

export function papelDoTexto(camada: string): PapelTexto {
  const t = tokens(camada);
  const tem = (ws: string[]) => t.some((w) => ws.includes(w));
  if (tem(["cota", "cotas", "dim", "dimensao", "dimensoes", "medida", "medidas", "ponto", "pontos", "vertice", "vertices", "marco", "marcos", "coordenada", "coordenadas", "azimute", "rumo", "distancia", "carimbo", "legenda", "nivel"])) return "nada";
  if (tem(["rua", "ruas", "via", "vias", "viario", "logradouro", "logradouros", "avenida"])) return "rua";
  if (tem(LOTE)) return "lote";
  if (tem(QUADRA)) return "quadra";
  if (tem([...VERDE, ...LAZER, ...INSTITUCIONAL, ...APP, "area", "areas"])) return "area";
  return "?";
}

/** Número com casa decimal (área, cota): não é número de lote. */
const temDecimal = (s: string) => /\d[.,]\d/.test(s);

/**
 * Número (e às vezes a quadra) de um rótulo de lote: "12", "L-12", "LT 12",
 * "Lote nº 12", "Q-A L-12", "QD 01 LT 12", "QUADRA A LOTE 12" e o id do
 * próprio sistema ("A-12", só quando `curto` vale: no DXF o "A-12" é nome de
 * ponto). Área ("250,00 m²") e cota ("10,00") não são número de lote.
 */
export function numeroDoLote(s: string, curto = false): { numero: number; quadra?: string } | null {
  const linhas = s.split(/\n/).map((x) => x.trim()).filter(Boolean);
  for (const linha0 of linhas) {
    const linha = linha0.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
    let m = /^(?:QUADRA|QD|Q)[\s.:\-]*([A-Z]{1,2}\d{0,2}|\d{1,3}[A-Z]?)\s*[,;/\-–\s]\s*(?:LOTE|LT|L)[\s.:\-ºª°N]*(\d{1,4})$/.exec(linha);
    if (m) return { quadra: m[1], numero: Number(m[2]) };
    m = /^(?:LOTE|LT|L)[\s.:\-ºª°N]*(\d{1,4})(?:\s*[,;/\-–\s]\s*(?:QUADRA|QD|Q)[\s.:\-]*([A-Z]{1,2}\d{0,2}|\d{1,3}[A-Z]?))?$/.exec(linha);
    if (m) return { numero: Number(m[1]), ...(m[2] ? { quadra: m[2] } : {}) };
    if (temDecimal(linha)) continue;
    m = /^0*(\d{1,4})$/.exec(linha);
    if (m) return { numero: Number(m[1]) };
    if (curto) {
      m = /^([A-Z]{1,2}|\d{1,3})\s*[-–]\s*0*(\d{1,4})$/.exec(linha);
      if (m) return { quadra: m[1], numero: Number(m[2]) };
    }
  }
  return null;
}

/** Nome da quadra num rótulo: "QUADRA A", "QD-01", "Q.A", "Quadra A (12 lotes)" ou só "A" / "01" (`solto`). */
export function nomeDaQuadra(s: string, solto = false): string | null {
  const linha = s.split(/\n/)[0].normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
  let m = /^(?:QUADRA|QD|Q)[\s.:\-]*([A-Z]{1,2}\d{0,2}|\d{1,3}[A-Z]?)(?:\s*\(.*\))?$/.exec(linha);
  if (m) return m[1];
  if (solto && !temDecimal(linha)) {
    m = /^([A-Z]{1,2}|\d{1,3}[A-Z]?)$/.exec(linha);
    if (m) return m[1];
  }
  return null;
}

// a abreviação só vale com ponto: "AV 01" sem ponto é a área verde 01
const PREFIXOS_RUA = /^(?:(?:RUA|AVENIDA|ALAMEDA|TRAVESSA|ESTRADA|VIA|RODOVIA|VIELA|BECO|LARGO|ACESSO|SERVIDAO)\b|(?:R|AV|AL|TV|TRAV|EST|ROD)\.)/i;

/** Nome de rua: o texto começa como logradouro. Tira a largura do fim ("RUA 01 (12,00 m)", "- 12,00m"). */
export function nomeDaRua(s: string, papel: PapelTexto = "?"): string | null {
  const linha = s.split(/\n/)[0].replace(/\s+/g, " ").trim();
  if (!linha || linha.length > 80) return null;
  const limpo = linha
    .replace(/\s*[(\[]\s*(?:L\s*=\s*)?\d+(?:[.,]\d+)?\s*m?\s*[)\]]\s*$/i, "")
    .replace(/\s*[-–]\s*(?:L\s*=\s*)?\d+(?:[.,]\d+)?\s*m\s*$/i, "")
    .replace(/\s*L\s*=\s*\d+(?:[.,]\d+)?\s*m?\s*$/i, "")
    .trim();
  const sem = limpo.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
  if (PREFIXOS_RUA.test(sem)) return limpo;
  // na camada de nomes de rua vale qualquer nome (mas não número solto nem medida)
  if (papel === "rua" && /[A-Za-zÀ-ú]{3,}/.test(limpo) && !temDecimal(limpo)) return limpo;
  return null;
}

/** Nome de área pública num texto ("ÁREA VERDE 01 - 1.234,56 m²" → classe e nome sem a área). */
export function nomeDaArea(s: string): { classe: Classe; nome: string } | null {
  const linha = s.split(/\n/)[0].replace(/\s+/g, " ").trim();
  if (!linha || linha.length > 80) return null;
  const nome = linha.replace(/\s*[-–:]?\s*\d{1,3}(?:\.\d{3})*(?:,\d+)?\s*m[²2]\s*$/i, "").trim();
  const n = normalizar(nome);
  const t = n.split(" ");
  let classe: Classe | null = null;
  if (/^(area )?verde\b/.test(n) || t[0] === "av") classe = "verde";
  else if (/^(area de |sistema de )?lazer\b/.test(n) || /^praca\b/.test(n) || t[0] === "sl") classe = "lazer";
  else if (/^(area )?institucional\b/.test(n) || /^equipamento/.test(n) || t[0] === "ai" || t[0] === "epc") classe = "institucional";
  else if (/^app\b/.test(n) || /preservacao permanente/.test(n)) classe = "app";
  else if (/remanescente/.test(n)) classe = "remanescente";
  return classe ? { classe, nome } : null;
}
