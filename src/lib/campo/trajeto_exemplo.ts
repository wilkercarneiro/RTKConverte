// Trajeto de GPS de exemplo (laboratório #/lab/campo e testes): a volta a pé
// num pasto de ~2,6 ha perto de Lençóis/BA, como um celular gravaria.
//
// Gerado de forma determinística (semente fixa) a cada carga — os mesmos
// números sempre:
//   • começa parado, com o GPS "esquentando" (±30 m → ±3,5 m);
//   • anda a 1,3 m/s, uma leitura por segundo, com o erro "passeando" devagar
//     (o erro do GPS do celular é correlacionado, não salta de leitura em leitura);
//   • para 3 s em cada canto da cerca;
//   • no 4º lado passa debaixo de árvores: a precisão cai para ±9–14 m;
//   • termina parado perto do ponto de partida (bom para o Marcar ponto aqui).
import type { Leitura, LonLat } from "./tipos.ts";

const ORIGEM: LonLat = [-41.3921, -12.5634];
const R = 6371008.8, RAD = Math.PI / 180;
const K = Math.cos(ORIGEM[1] * RAD);
const paraLonLat = (x: number, y: number): LonLat => [ORIGEM[0] + x / (R * RAD * K), ORIGEM[1] + y / (R * RAD)];

/** Os cantos de verdade da cerca (metros a partir da origem: leste, norte). */
const CANTOS_M: [number, number][] = [[0, 0], [150, -10], [185, 60], [160, 150], [40, 165], [-15, 80]];
export const CANTOS_EXEMPLO: LonLat[] = CANTOS_M.map(([x, y]) => paraLonLat(x, y));

function rng(semente: number) {
  let s = semente >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gerar(): Leitura[] {
  const r = rng(20261106);
  const normal = () => { const u = Math.max(1e-9, r()), v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const t0 = Date.UTC(2026, 10, 6, 17, 32, 0); // 14:32 em Brasília
  const saida: Leitura[] = [];
  let ex = 0, ey = 0, t = t0;
  const ler = (x: number, y: number, prec: number, escala: number) => {
    // erro correlacionado: anda devagar, volta para perto de zero
    ex = 0.88 * ex + normal() * 0.32 * escala;
    ey = 0.88 * ey + normal() * 0.32 * escala;
    const [lon, lat] = paraLonLat(x + ex, y + ey);
    saida.push({ lon, lat, precisao: Math.round(prec * 10) / 10, alt: 412 + y * 0.02 + normal() * 1.5, t });
    t += 1000;
  };
  // parado no canto 1, esquentando
  for (const p of [30, 22, 15, 10.5, 7.4, 5.2, 4.1, 3.6]) ler(0, 0, p, 1);
  for (let c = 0; c < CANTOS_M.length; c++) {
    const [ax, ay] = CANTOS_M[c], [bx, by] = CANTOS_M[(c + 1) % CANTOS_M.length];
    const L = Math.hypot(bx - ax, by - ay);
    const passos = Math.max(1, Math.round(L / 1.3));
    for (let i = 1; i <= passos; i++) {
      const f = i / passos;
      const sobArvore = c === 3 && f > 0.35 && f < 0.62;
      const prec = sobArvore ? 9 + r() * 5 : 2.6 + r() * 1.4;
      ler(ax + (bx - ax) * f, ay + (by - ay) * f, prec, sobArvore ? 3 : 1);
    }
    // 3 s parado no canto (o último canto é a volta à partida: fica mais)
    const parado = c === CANTOS_M.length - 1 ? 7 : 3;
    for (let i = 0; i < parado; i++) ler(bx, by, 2.6 + r() * 1.2, 1);
  }
  return saida;
}

export const TRAJETO_EXEMPLO: Leitura[] = gerar();
