// Geometria das glebas, separada do desenho.
//
// Estas funções decidem QUAIS pontos entram no contorno — a parte que erra
// calado: um trecho que anda para o lado errado do perímetro produz uma gleba
// com a forma de tudo menos o que se queria, e isso só aparece na planta
// impressa. Fora do componente, dá para provar em teste.

/** Ponto do anel de uma gleba, em coordenadas UTM do fuso do serviço. */
export type PontoAnel = [number, number];

/** Tolerância para dizer que dois pontos são o mesmo (1 mm). */
const TOL = 0.001;

export const mesmoPonto = (a: PontoAnel, b: PontoAnel): boolean =>
  Math.abs(a[0] - b[0]) < TOL && Math.abs(a[1] - b[1]) < TOL;

/** Área do anel em hectares (shoelace), a mesma conta do motor da planta. */
export function areaHaDoAnel(anel: PontoAnel[]): number {
  if (anel.length < 3) return 0;
  let s = 0;
  for (let i = 0; i < anel.length; i++) {
    const [ax, ay] = anel[i];
    const [bx, by] = anel[(i + 1) % anel.length];
    s += ax * by - bx * ay;
  }
  return Math.abs(s / 2) / 10000;
}

/** Posição de um ponto do anel na lista de vértices do perímetro; -1 se é livre. */
export const indiceNoPerimetro = (perimetro: PontoAnel[], p: PontoAnel): number =>
  perimetro.findIndex((q) => mesmoPonto(q, p));

/**
 * Os vértices entre `de` e `ate`, andando PELO PERÍMETRO, sem incluir `de`.
 *
 * `sentido` manda quando é informado. Sem ele, vai pelo caminho MAIS CURTO —
 * bom para o primeiro trecho, quando ainda não há direção estabelecida.
 *
 * Por que o sentido importa: o contorno de uma gleba acompanha um pedaço
 * contíguo do perímetro, sempre no mesmo rumo. Quando o operador já passou da
 * metade do anel, o "caminho mais curto" inverte e volta por trás — e o anel sai
 * cruzado. Continuar no rumo que ele já vinha seguindo é o que evita isso.
 */
export function trechoDoPerimetro(total: number, de: number, ate: number, sentido?: 1 | -1): number[] {
  if (total <= 0 || de < 0 || ate < 0) return [];
  const frente = ((ate - de) % total + total) % total;
  const tras = ((de - ate) % total + total) % total;
  const passo = sentido ?? (frente <= tras ? 1 : -1);
  const quantos = passo === 1 ? frente : tras;
  const out: number[] = [];
  for (let k = 1; k <= quantos; k++) out.push((((de + passo * k) % total) + total) % total);
  return out;
}

/**
 * Em que rumo o contorno já vinha andando pelo perímetro.
 *
 * Sai dos dois últimos pontos que são vértices do perímetro: se o penúltimo é o
 * 7 e o último é o 8, o rumo é para a frente. `null` quando ainda não há dois
 * pontos consecutivos do perímetro para comparar — aí quem decide é o caminho
 * mais curto.
 */
export function sentidoDoContorno(perimetro: PontoAnel[], anel: PontoAnel[]): 1 | -1 | null {
  const total = perimetro.length;
  if (total < 2 || anel.length < 2) return null;
  const idx = anel.map((p) => indiceNoPerimetro(perimetro, p));
  for (let k = idx.length - 1; k >= 1; k--) {
    const b = idx[k], a = idx[k - 1];
    if (a < 0 || b < 0 || a === b) continue;
    const frente = ((b - a) % total + total) % total;
    const tras = ((a - b) % total + total) % total;
    // um salto de exatamente meio anel não diz rumo nenhum
    if (frente === tras) continue;
    return frente < tras ? 1 : -1;
  }
  return null;
}

/**
 * Acrescenta pontos ao anel ignorando os que já estão lá.
 *
 * Sem isso, passar o retângulo de seleção duas vezes pela mesma área duplicaria
 * os vértices e a shoelace devolveria área errada.
 */
export function acrescentarSemRepetir(anel: PontoAnel[], novos: PontoAnel[]): PontoAnel[] {
  const out = [...anel];
  for (const p of novos) if (!out.some((q) => mesmoPonto(q, p))) out.push(p);
  return out;
}

/**
 * Vértice do perímetro mais próximo de um ponto, dentro de `raio`.
 * É o ímã que impede a divisa da gleba de parar a 20 cm da poligonal — folga que
 * viraria fresta visível na planta e área errada na soma.
 */
export function grudarNoPerimetro(
  perimetro: { x: number; y: number }[],
  alvo: { x: number; y: number },
  raio: number,
): { x: number; y: number } | null {
  let melhor = raio;
  let achado: { x: number; y: number } | null = null;
  for (const p of perimetro) {
    const d = Math.hypot(p.x - alvo.x, p.y - alvo.y);
    if (d < melhor) { melhor = d; achado = p; }
  }
  return achado;
}

/**
 * Ordena índices do perímetro como uma SEQUÊNCIA CONTÍGUA do anel: por índice,
 * começando depois do maior salto. Assim uma escolha que dá a volta pelo 0
 * (28, 29, 30, 31, 0, 1, 2) continua contígua em vez de virar 0, 1, 2, 28…
 *
 * É a regra do botão "Dividir gleba": o operador marca os vértices na planta em
 * qualquer ordem, e a gleba é o polígono desses vértices percorridos como o
 * perímetro os percorre, fechado pela reta entre o último e o primeiro — a
 * divisa interna.
 */
export function ordenarNoAnel(indices: number[], total: number): number[] {
  const l = [...new Set(indices)].filter((i) => i >= 0 && i < total).sort((a, b) => a - b);
  if (l.length < 2 || total <= 0) return l;
  let maior = -1, corte = 0;
  for (let i = 0; i + 1 < l.length; i++) {
    const gap = l[i + 1] - l[i];
    if (gap > maior) { maior = gap; corte = i + 1; }
  }
  const volta = l[0] + total - l[l.length - 1];
  if (volta >= maior) return l;
  return [...l.slice(corte), ...l.slice(0, corte)];
}

/** O anel da gleba a partir dos índices escolhidos no perímetro. */
export function anelDaSelecao(perimetro: PontoAnel[], indices: number[]): PontoAnel[] {
  return ordenarNoAnel(indices, perimetro.length).map((i) => perimetro[i]);
}
