// Motor da DIVISÃO EM PARTES IGUAIS (partilha, herança).
//
// O imóvel é cortado por divisas RETAS e PARALELAS, cada uma posicionada para que
// a faixa entre ela e a anterior tenha exatamente a fração pedida da área. É o
// jeito que se divide terra em partilha: cerca reta, fácil de implantar, e cada
// herdeiro recebe a mesma área (ou a fração que lhe cabe).
//
// A posição de cada divisa sai por bissecção sobre a área cortada por um
// meio-plano (`areaAteCorte`, o mesmo do motor do loteamento, que vale para
// imóvel côncavo). A DIREÇÃO das divisas é o que se escolhe: o operador gira à
// mão ou deixa a busca automática, que prefere, nesta ordem,
//   1. toda parte com frente para a estrada (herdeiro sem acesso é briga certa);
//   2. divisas curtas (menos cerca e menos marco);
//   3. partes compactas (nada de tira estreita).
//
// Uma direção só vale se cada divisa cruzar o perímetro em exatamente DOIS
// pontos: num imóvel côncavo a reta pode entrar e sair duas vezes, e a "parte"
// viraria dois pedaços separados — que não é uma gleba.
//
// Tudo em metros no plano UTM do levantamento (E, N), como os vértices.
import { areaAssinada, areaAteCorte, dist, dot, lerp, sub, type Pt } from "./loteamento/geom.ts";

/** Um ponto do contorno de uma parte: vértice existente do perímetro ou ponto novo de divisa. */
export interface PontoParte {
  e: number;
  n: number;
  /** índice do vértice no anel do perímetro (entrada), quando é um vértice existente */
  vertice?: number;
  /** ponto novo: número da divisa (0-based) e a aresta do perímetro onde ele cai */
  novo?: { divisa: number; aresta: number; t: number };
}

export interface Divisa {
  /** os dois pontos onde a divisa encontra o perímetro */
  a: PontoParte;
  b: PontoParte;
  comprimentoM: number;
}

export interface ParteDivisao {
  anel: PontoParte[];
  areaM2: number;
  perimetroM: number;
  /** quanto do contorno da parte encosta em estrada (lado de faixa de domínio) */
  frenteEstradaM: number;
}

export interface ResultadoDivisao {
  ok: boolean;
  /** azimute das divisas, em graus [0, 180): 0 = divisas no sentido norte–sul */
  azimute: number;
  divisas: Divisa[];
  partes: ParteDivisao[];
  /** pontos novos no perímetro, em ordem de aresta — os marcos a implantar */
  novos: PontoParte[];
  motivo?: string;
  /** menor é melhor (só faz sentido entre resultados da mesma entrada) */
  custo: number;
  /** maior diferença entre a área de uma parte e a área pedida para ela (m²) */
  erroAreaM2: number;
}

export interface EntradaDivisao {
  /** perímetro na ordem dos vértices (E, N) */
  anel: Pt[];
  /** fração de cada parte (são normalizadas: [1,1,1] = três partes iguais) */
  fracoes: number[];
  /** lado i (do vértice i ao i+1) é estrada/faixa de domínio */
  estrada?: boolean[];
  /** numera as partes a partir do outro lado */
  inverter?: boolean;
  /**
   * Onde o servidor vai "ver" um ponto: o SIGEF arredonda cada coordenada a
   * 0,001" e todo cálculo publicado (área do memorial, da planilha, da planta)
   * sai do ponto arredondado. Com esta função o motor mede as partes como os
   * documentos vão medir, e escolhe a posição de cada divisa para que as áreas
   * IMPRESSAS sejam iguais — não só as do desenho. O `anel` deve vir no mesmo
   * plano (os vértices já publicados).
   */
  publicar?: (p: Pt) => Pt;
}

const EPS_VERTICE = 0.02; // divisa a menos de 2 cm de um vértice é empurrada para longe dele

/** Direção da divisa e a normal pela qual as faixas são medidas, para um azimute. */
function eixos(az: number): { d: Pt; u: Pt } {
  const r = (az * Math.PI) / 180;
  const d: Pt = [Math.sin(r), Math.cos(r)];      // ao longo da divisa
  return { d, u: [Math.cos(r), -Math.sin(r)] };  // perpendicular: avanço das faixas
}

/** Onde a reta dot(p − o, u) = s cruza o perímetro: aresta, posição e ponto. */
function cruzamentos(anel: Pt[], o: Pt, u: Pt, s: number): { aresta: number; t: number; p: Pt }[] {
  const out: { aresta: number; t: number; p: Pt }[] = [];
  for (let i = 0; i < anel.length; i++) {
    const a = anel[i], b = anel[(i + 1) % anel.length];
    const fa = dot(sub(a, o), u) - s, fb = dot(sub(b, o), u) - s;
    // regra semiaberta: um vértice exatamente sobre a reta conta uma vez só
    if ((fa < 0 && fb >= 0) || (fa >= 0 && fb < 0)) {
      const t = fa / (fa - fb);
      out.push({ aresta: i, t, p: lerp(a, b, t) });
    }
  }
  return out;
}

/** Posição s da divisa que deixa `alvo` m² do lado de baixo (bissecção). */
function posicaoPorArea(anel: Pt[], o: Pt, u: Pt, sMin: number, sMax: number, alvo: number): number {
  let lo = sMin, hi = sMax;
  for (let it = 0; it < 80; it++) {
    const m = (lo + hi) / 2;
    if (areaAteCorte(anel, o, u, m) < alvo) lo = m; else hi = m;
    if (hi - lo < 1e-7) break;
  }
  return (lo + hi) / 2;
}

/**
 * Divide o anel em partes de área proporcional às frações, com divisas
 * paralelas no azimute dado.
 */
export function dividir(ent: EntradaDivisao, azimute: number, opts: { compensar?: boolean } = {}): ResultadoDivisao {
  const anel = ent.anel;
  const nPartes = ent.fracoes.length;
  const az = Math.round((((azimute % 180) + 180) % 180) * 100) / 100;
  const vazio = (motivo: string): ResultadoDivisao => ({ ok: false, azimute: az, divisas: [], partes: [], novos: [], motivo, custo: Infinity, erroAreaM2: Infinity });
  if (anel.length < 3) return vazio("perímetro com menos de 3 vértices");
  if (nPartes < 2) return vazio("escolha pelo menos 2 partes");
  const somaF = ent.fracoes.reduce((s, f) => s + Math.max(0, f), 0);
  if (!(somaF > 0) || ent.fracoes.some((f) => !(f > 0))) return vazio("toda parte precisa de uma fração maior que zero");
  const fr = ent.fracoes.map((f) => f / somaF);
  const areaTotal = Math.abs(areaAssinada(anel));

  const o = anel[0];
  let { u } = eixos(az);
  // inverter = varrer do outro lado: a parte 1 nasce na outra ponta
  if (ent.inverter) u = [-u[0], -u[1]];
  const proj = anel.map((p) => dot(sub(p, o), u));
  const sMin = Math.min(...proj), sMax = Math.max(...proj);

  // ---- posição de cada divisa ----
  const ss: number[] = [];
  let acum = 0;
  for (let k = 0; k < nPartes - 1; k++) {
    acum += fr[k];
    let s = posicaoPorArea(anel, o, u, sMin, sMax, acum * areaTotal);
    // divisa grudada num vértice existente: empurra 2 cm para não nascer um lado
    // de comprimento zero (a área muda menos que a precisão das coordenadas)
    const perto = proj.find((p) => Math.abs(p - s) < EPS_VERTICE);
    if (perto !== undefined) s = perto + (s >= perto ? EPS_VERTICE : -EPS_VERTICE);
    ss.push(s);
  }

  // ---- cruzamentos: cada divisa entra e sai UMA vez ----
  const cortes = ss.map((s) => cruzamentos(anel, o, u, s));
  const ruim = cortes.findIndex((c) => c.length !== 2);
  if (ruim >= 0) {
    return vazio(cortes[ruim].length > 2
      ? `nesta direção a divisa ${ruim + 1} cruzaria o imóvel em ${cortes[ruim].length} pontos (a parte ficaria em pedaços)`
      : `nesta direção a divisa ${ruim + 1} não atravessa o imóvel`);
  }
  // as duas pontas de cada divisa: aresta, posição nela e a coordenada gravada
  const pontas: { aresta: number; t: number; p: Pt }[][] = cortes.map((c) => c.map((x) => ({ aresta: x.aresta, t: x.t, p: arredP(x.p) })));

  // ---- compensação do arredondamento ----
  // O documento não mede o ponto calculado: mede o ponto ARREDONDADO a 0,001"
  // (~3 cm), e a área anda em degraus — com as duas pontas presas a uma reta,
  // degraus de ~4 m². Por isso cada ponta é escolhida à parte, entre as posições
  // da grade a até 30 cm do cruzamento exato, sempre sobre o próprio lado do
  // perímetro; o par que deixa a área acumulada mais perto do alvo fica. A
  // divisa sai fora do paralelo por milímetros, e as áreas impressas batem.
  //
  // O alvo é fração do total REAL: o ponto arredondado sai uns milímetros fora
  // da reta do lado, e isso muda a área do imóvel somada pelas partes. A busca
  // roda de novo com o total que a rodada anterior produziu, até estabilizar.
  const pub = ent.publicar;
  if (pub && opts.compensar !== false) {
    const candidatos = (x: { aresta: number; t: number }) => {
      const a = anel[x.aresta], b = anel[(x.aresta + 1) % anel.length];
      const L = dist(a, b) || 1;
      const vistos = new Map<string, { aresta: number; t: number; p: Pt; ver: Pt }>();
      for (let m = -30; m <= 30; m++) {
        const t = x.t + (m * 0.01) / L;
        if (t <= 0.0005 || t >= 0.9995) continue;
        const gravado = arredP(pub(arredP(lerp(a, b, t))));
        const chave = `${gravado[0]}|${gravado[1]}`;
        if (!vistos.has(chave)) vistos.set(chave, { aresta: x.aresta, t, p: gravado, ver: pub(gravado) });
      }
      return [...vistos.values()];
    };
    const opcoes = cortes.map((c) => c.map(candidatos));
    // como o documento vê cada divisa agora (as seguintes, da rodada anterior)
    const vistos = new Map<number, Pt[]>(pontas.map((c, k) => [k, c.map((q) => pub(q.p))]));
    for (let rodada = 0; rodada < 3; rodada++) {
      let acumR = 0;
      for (let k = 0; k < ss.length; k++) {
        acumR += fr[k];
        let melhor: typeof opcoes[number][number] | null = null, erroMin = Infinity;
        for (const A of opcoes[k][0]) {
          for (const B of opcoes[k][1]) {
            const par = [{ aresta: A.aresta, t: A.t, p: A.ver }, { aresta: B.aresta, t: B.t, p: B.ver }];
            const a = areaAbaixo(anel, proj, ss.slice(0, k), vistos, ss[k], par, o, u);
            // o total que ESTE par produz, com as outras divisas onde estão
            const comPar = new Map(vistos).set(k, [A.ver, B.ver]);
            const total = areaAbaixo(anel, proj, ss, comPar, Infinity, [], o, u);
            const erro = Math.abs(a - acumR * total);
            if (erro < erroMin) { erroMin = erro; melhor = [A, B]; }
          }
        }
        if (melhor) {
          pontas[k] = melhor.map((m) => ({ aresta: m.aresta, t: m.t, p: m.p }));
          vistos.set(k, melhor.map((m) => m.ver));
        }
      }
    }
    // Acabamento: o que o herdeiro compara é parte contra parte. Divisa a
    // divisa, com as outras paradas, fica o par que deixa a MAIOR diferença
    // entre uma parte e a sua fração do total a menor possível.
    const pior = (vis: Map<number, Pt[]>, pts: { aresta: number; t: number }[][]) => {
      const total = areaAbaixo(anel, proj, ss, vis, Infinity, [], o, u);
      let ant = 0, max = 0;
      for (let k = 0; k <= ss.length; k++) {
        const ate = k < ss.length
          ? areaAbaixo(anel, proj, ss.slice(0, k), vis, ss[k], pts[k].map((q, i) => ({ ...q, p: vis.get(k)![i] })), o, u)
          : total;
        max = Math.max(max, Math.abs(ate - ant - fr[k] * total));
        ant = ate;
      }
      return max;
    };
    for (let passada = 0; passada < 2; passada++) {
      for (let k = 0; k < ss.length; k++) {
        let melhor = pior(vistos, pontas), escolha: typeof opcoes[number][number] | null = null;
        for (const A of opcoes[k][0]) {
          for (const B of opcoes[k][1]) {
            const vis = new Map(vistos).set(k, [A.ver, B.ver]);
            const pts = pontas.map((c, j) => (j === k ? [A, B] : c));
            const v = pior(vis, pts);
            if (v < melhor - 1e-6) { melhor = v; escolha = [A, B]; }
          }
        }
        if (escolha) {
          pontas[k] = escolha.map((m) => ({ aresta: m.aresta, t: m.t, p: m.p }));
          vistos.set(k, escolha.map((m) => m.ver));
        }
      }
    }
  }

  // ---- perímetro com os pontos novos inseridos ----
  type P = PontoParte & { s: number };
  const aumentado: P[] = [];
  const novos: PontoParte[] = [];
  for (let i = 0; i < anel.length; i++) {
    aumentado.push({ e: anel[i][0], n: anel[i][1], vertice: i, s: proj[i] });
    const aqui = pontas.flatMap((c, k) => c.filter((x) => x.aresta === i).map((x) => ({ ...x, k }))).sort((a, b) => a.t - b.t);
    for (const x of aqui) {
      const pt: P = { e: x.p[0], n: x.p[1], novo: { divisa: x.k, aresta: i, t: x.t }, s: ss[x.k] };
      aumentado.push(pt);
      novos.push(pt);
    }
  }

  // ---- cada faixa vira uma parte: os pontos dela, na ordem do perímetro ----
  const limites = [-Infinity, ...ss, Infinity];
  const dentro = (p: P, k: number) => {
    if (p.novo) return p.novo.divisa === k - 1 || p.novo.divisa === k;
    return p.s > limites[k] && p.s < limites[k + 1];
  };
  const partes: ParteDivisao[] = [];
  for (let k = 0; k < nPartes; k++) {
    const pts = aumentado.filter((p) => dentro(p, k));
    const anelP = rotacionarNoSalto(pts, aumentado);
    // medida como o documento vai medir: ponto novo no lugar arredondado
    const coords = anelP.map((p) => (p.novo && pub ? pub([p.e, p.n]) : [p.e, p.n] as Pt));
    const areaM2 = Math.abs(areaAssinada(coords));
    let perimetroM = 0, frenteEstradaM = 0;
    for (let j = 0; j < anelP.length; j++) {
      const a = anelP[j], b = anelP[(j + 1) % anelP.length];
      const l = dist([a.e, a.n], [b.e, b.n]);
      perimetroM += l;
      const aresta = arestaComum(a, b, anel.length);
      if (aresta !== null && ent.estrada?.[aresta]) frenteEstradaM += l;
    }
    partes.push({ anel: anelP.map(({ s: _s, ...p }) => p), areaM2, perimetroM, frenteEstradaM });
  }

  const divisas: Divisa[] = pontas.map((c, k) => {
    const [a, b] = c.map((x) => novos.find((p) => p.novo!.divisa === k && p.novo!.aresta === x.aresta && Math.abs(p.novo!.t - x.t) < 1e-12)!);
    return { a, b, comprimentoM: dist([a.e, a.n], [b.e, b.n]) };
  });

  // conferência: a soma das partes tem de fechar o imóvel, e cada uma a sua fração
  const soma = partes.reduce((s, p) => s + p.areaM2, 0);
  // com arredondamento, a parte é medida contra a fração do total que os
  // documentos vão somar — é a comparação que o herdeiro faz no papel
  const erroAreaM2 = Math.max(...partes.map((p, k) => Math.abs(p.areaM2 - fr[k] * (pub ? soma : areaTotal))));
  // com arredondamento a soma oscila alguns m² (os pontos saem da reta do lado)
  if (Math.abs(soma - areaTotal) > Math.max(pub ? 5 : 1, areaTotal * 1e-5)) return vazio("as partes não fecham a área do imóvel nesta direção");

  // ---- custo: acesso, cerca, forma ----
  const temEstrada = !!ent.estrada?.some(Boolean);
  const semAcesso = temEstrada ? partes.filter((p) => p.frenteEstradaM < 5).length : 0;
  const cerca = divisas.reduce((s, d) => s + d.comprimentoM, 0);
  const lado = Math.sqrt(areaTotal / nPartes);
  // 0 para um círculo; uma tira de 1 : 10 já pesa ~1,1
  const forma = partes.reduce((s, p) => s + (p.perimetroM / (2 * Math.sqrt(Math.PI * p.areaM2)) - 1), 0);
  // Frente para a estrada repartida: não basta "encostar" — 7 m de testada para
  // um herdeiro e 200 m para outro é partilha que vai parar na justiça. Cada
  // metro que falta para a parte chegar à sua cota de frente custa 3 m de cerca.
  const frenteTotal = temEstrada ? partes.reduce((s, p) => s + p.frenteEstradaM, 0) : 0;
  const cota = Math.min(lado * 0.6, (frenteTotal / nPartes) * 0.8);
  const faltaFrente = temEstrada ? partes.reduce((s, p) => s + Math.max(0, cota - p.frenteEstradaM), 0) : 0;
  const custo = semAcesso * 1e7 + cerca + forma * lado * 0.8 + faltaFrente * 3;
  return { ok: true, azimute: az, divisas, partes, novos, custo, erroAreaM2 };
}

const arred = (v: number) => Math.round(v * 1000) / 1000;
const arredP = (p: Pt): Pt => [arred(p[0]), arred(p[1])];

/**
 * Área do imóvel abaixo da divisa `s` (lado das partes já feitas), contando os
 * pontos das divisas anteriores e os desta no lugar publicado.
 */
function areaAbaixo(
  anel: Pt[], proj: number[], anteriores: number[], pubPts: Map<number, Pt[]>,
  s: number, aqui: { aresta: number; t: number; p: Pt }[], o: Pt, u: Pt,
): number {
  const pts: Pt[] = [];
  const extras = new Map<number, { t: number; p: Pt }[]>();
  const somar = (aresta: number, t: number, p: Pt) => extras.set(aresta, [...(extras.get(aresta) ?? []), { t, p }]);
  anteriores.forEach((sa, k) => {
    const pp = pubPts.get(k)!;
    cruzamentos(anel, o, u, sa).forEach((x, i) => somar(x.aresta, x.t, pp[i]));
  });
  for (const x of aqui) somar(x.aresta, x.t, x.p);
  for (let i = 0; i < anel.length; i++) {
    if (proj[i] < s) pts.push(anel[i]);
    for (const x of (extras.get(i) ?? []).sort((a, b) => a.t - b.t)) {
      // ponto de divisa anterior fica se estiver abaixo; os desta divisa sempre
      if (aqui.some((q) => q.p === x.p) || dot(sub(x.p, o), u) < s) pts.push(x.p);
    }
  }
  return pts.length >= 3 ? Math.abs(areaAssinada(pts)) : 0;
}

/** Se os dois pontos estão na MESMA aresta do perímetro, qual é ela. */
export function arestaComum(a: PontoParte, b: PontoParte, nV: number): number | null {
  const arestasDe = (p: PontoParte): number[] => p.novo ? [p.novo.aresta] : [p.vertice!, (p.vertice! - 1 + nV) % nV];
  const A = arestasDe(a), B = arestasDe(b);
  // vértice→vértice: só se forem vizinhos no anel (a aresta que sai do primeiro)
  if (a.vertice !== undefined && b.vertice !== undefined) {
    if ((a.vertice + 1) % nV === b.vertice) return a.vertice;
    if ((b.vertice + 1) % nV === a.vertice) return b.vertice;
    return null;
  }
  return A.find((x) => B.includes(x)) ?? null;
}

/** Um lado do contorno de uma parte, para a tabela de medidas. */
export interface LadoParte {
  de: PontoParte;
  ate: PontoParte;
  comprimentoM: number;
  /** lado sobre o perímetro do imóvel: a aresta (do vértice i ao i+1) */
  aresta: number | null;
  /** lado de divisa nova: a parte do outro lado */
  vizinha: number | null;
}

/** Os lados da parte k, na ordem do anel: perímetro do imóvel ou divisa com a parte vizinha. */
export function ladosDaParte(r: ResultadoDivisao, k: number, nVertices: number): LadoParte[] {
  const anel = r.partes[k]?.anel ?? [];
  return anel.map((a, j) => {
    const b = anel[(j + 1) % anel.length];
    const aresta = arestaComum(a, b, nVertices);
    // lado por dentro do imóvel: a vizinha é a outra parte que tem os dois pontos
    const tem = (p: ParteDivisao, q: PontoParte) => p.anel.some((x) => Math.abs(x.e - q.e) < 0.002 && Math.abs(x.n - q.n) < 0.002);
    const vizinha = aresta === null ? r.partes.findIndex((p, j) => j !== k && tem(p, a) && tem(p, b)) : -1;
    return { de: a, ate: b, comprimentoM: dist([a.e, a.n], [b.e, b.n]), aresta, vizinha: vizinha >= 0 ? vizinha : null };
  });
}

/** Começa o anel da parte num ponto que não seja o meio de uma corrente. */
function rotacionarNoSalto<T>(pts: T[], todos: T[]): T[] {
  if (pts.length < 3) return pts;
  const pos = new Map(todos.map((p, i) => [p, i]));
  const n = todos.length;
  let melhor = 0, maior = -1;
  for (let i = 0; i < pts.length; i++) {
    const a = pos.get(pts[(i - 1 + pts.length) % pts.length])!, b = pos.get(pts[i])!;
    const salto = (b - a + n) % n;
    if (salto > maior) { maior = salto; melhor = i; }
  }
  return [...pts.slice(melhor), ...pts.slice(0, melhor)];
}

/**
 * As melhores direções para dividir: varre 0–180° e refina em volta das
 * melhores. Devolve até `quantas` sugestões bem diferentes entre si (≥ 15°),
 * a primeira é a recomendada.
 */
export function sugerirDivisoes(ent: EntradaDivisao, quantas = 3): ResultadoDivisao[] {
  const grossos: ResultadoDivisao[] = [];
  // a varredura não compensa o arredondamento (só a escolhida, no fim)
  for (let az = 0; az < 180; az += 1) {
    const r = dividir(ent, az, { compensar: false });
    if (r.ok) grossos.push(r);
  }
  if (!grossos.length) return [];
  grossos.sort((a, b) => a.custo - b.custo);
  const escolhidas: ResultadoDivisao[] = [];
  const longe = (a: number, b: number) => { const d = Math.abs(a - b) % 180; return Math.min(d, 180 - d) >= 15; };
  for (const g of grossos) {
    if (escolhidas.every((e) => longe(e.azimute, g.azimute))) {
      // refina ±1° em décimos de grau
      let melhor = g;
      for (let d = -1; d <= 1.0001; d += 0.1) {
        const r = dividir(ent, g.azimute + d, { compensar: false });
        if (r.ok && r.custo < melhor.custo) melhor = r;
      }
      escolhidas.push({ ...melhor, azimute: Math.round(melhor.azimute * 10) / 10 });
      if (escolhidas.length >= quantas) break;
    }
  }
  // o arredondamento do azimute mexe na geometria: refaz no valor exibido
  return escolhidas.map((e) => dividir(ent, e.azimute)).filter((r) => r.ok);
}
