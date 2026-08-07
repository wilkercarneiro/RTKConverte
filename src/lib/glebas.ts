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
 * Vai pelo caminho MAIS CURTO: uma divisa de gleba acompanha um pedaço contíguo
 * do contorno, e o pedaço curto é o que se quer em quase todo caso. Para o outro
 * lado, o operador clica um ponto no meio antes — o que também é como se
 * descreve o trecho em voz alta ("passa pelo canto de baixo e sobe").
 *
 * Empate (exatamente meio perímetro) resolve para a frente, que é a ordem em que
 * o anel é publicado.
 */
export function trechoDoPerimetro(total: number, de: number, ate: number): number[] {
  if (total <= 0 || de < 0 || ate < 0) return [];
  const frente = ((ate - de) % total + total) % total;
  const tras = ((de - ate) % total + total) % total;
  const quantos = Math.min(frente, tras);
  const passo = frente <= tras ? 1 : -1;
  const out: number[] = [];
  for (let k = 1; k <= quantos; k++) out.push((((de + passo * k) % total) + total) % total);
  return out;
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
