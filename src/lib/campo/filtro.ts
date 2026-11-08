// O que o GPS diz antes de virar vértice (Medir no campo). Contas puras, sem
// relógio próprio: o tempo vem das leituras (t), para os testes e o laboratório
// tocarem trajetos gravados igual ao campo.
//
//  • Aquecimento — `estadoAquecimento`: logo que liga, o celular dá posição da
//    rede (Wi-Fi, antena) ou de um GNSS que ainda está convergindo; muitas vezes
//    com "precisão" boa e a posição deslocada. O primeiro vértice espera o GPS
//    assentar: a precisão parou de melhorar, ou passou o tempo máximo.
//    Receptor externo não aquece: ele diz o tipo de solução (fix).
//
//  • Convergência — `convergencia`: no Marcar ponto, o erro do GPS do celular
//    muda devagar (o multicaminho leva centenas de segundos para mudar), então
//    5 s de média quase não ajudam. A tela mostra o ponto assentando e oferece
//    "Pronto" quando ele parou de andar.
//
//  • Filtro do Caminhar — `criarFiltroCaminhar`: Kalman de velocidade constante
//    em metros (leste/norte). Tira o zigue-zague e, sobretudo, recusa o SALTO
//    impossível a pé (reflexo em telhado, troca de satélites): antes ele virava
//    vértice se a precisão informada estivesse dentro do limite. A precisão do
//    vértice continua a do aparelho (o filtro não inventa precisão: os erros do
//    celular andam juntos e a covariância do Kalman sairia otimista).
import { combinarLeituras } from "./motor.ts";
import { distanciaM, metrosPorGrau } from "./geometria.ts";
import type { Leitura } from "./tipos.ts";

// ---------------------------------------------------------------- aquecimento

export interface EstadoAquecimento {
  pronto: boolean;
  /** segundos desde a primeira leitura do GPS */
  segundos: number;
  /** o que falta, para a tela: "a precisão ainda está melhorando (±6,2 m)" */
  motivo: string | null;
}

/** Tempo mínimo e máximo do aquecimento (s). */
export const AQUECER_MIN_S = 8;
export const AQUECER_MAX_S = 45;

/**
 * O GPS já assentou? `historico` = as leituras desde que o GPS ligou (em ordem).
 * Pronto quando: (receptor com solução) OU (≥ 8 s E a melhor precisão dos últimos
 * 5 s não é mais que 10% melhor que a melhor de antes) OU ≥ 45 s.
 */
export function estadoAquecimento(historico: Leitura[], agora: number): EstadoAquecimento {
  const ult = historico[historico.length - 1];
  if (!ult) return { pronto: false, segundos: 0, motivo: "esperando a primeira posição" };
  if (ult.fonte === "receptor") {
    const ok = !!ult.fix && ult.fix !== "sem-fix";
    return { pronto: ok, segundos: 0, motivo: ok ? null : "o receptor ainda não tem posição" };
  }
  const t0 = historico[0].t;
  const segundos = Math.max(0, (agora - t0) / 1000);
  if (segundos >= AQUECER_MAX_S) return { pronto: true, segundos, motivo: null };
  if (segundos < AQUECER_MIN_S) return { pronto: false, segundos, motivo: "o GPS acabou de ligar" };
  const corte = agora - 5000;
  const precs = (ls: Leitura[]) => ls.map((l) => l.precisao).filter((p): p is number => p != null && Number.isFinite(p));
  const antes = precs(historico.filter((l) => l.t < corte));
  const recentes = precs(historico.filter((l) => l.t >= corte));
  if (!recentes.length) return { pronto: false, segundos, motivo: "esperando posição nova" };
  const melhorRecente = Math.min(...recentes);
  if (!antes.length) return { pronto: false, segundos, motivo: "a precisão ainda está melhorando" };
  const melhorAntes = Math.min(...antes);
  // ainda melhorando: a melhor recente é mais de 10% melhor que a melhor de antes
  if (melhorRecente < 0.9 * melhorAntes) return { pronto: false, segundos, motivo: "a precisão ainda está melhorando" };
  return { pronto: true, segundos, motivo: null };
}

// ---------------------------------------------------------------- convergência

export interface Convergencia {
  /** leituras (sem repetidas) juntadas até agora */
  n: number;
  /** a precisão do ponto se parar agora (a honesta de combinarLeituras) */
  precisao: number | null;
  /** há quantos segundos o ponto médio parou de andar */
  estavelHaS: number;
  /** quanto o ponto médio andou nos últimos 5 s (m) */
  andouM: number;
}

/** Quanto o ponto médio pode andar e ainda contar como parado: 10% da precisão, entre 2 cm e 30 cm. */
export const toleranciaEstavel = (precisao: number | null): number => Math.min(0.3, Math.max(0.02, 0.1 * (precisao ?? 3)));

/**
 * Como está o ponto do Marcar ponto. Reconta o ponto médio a cada leitura e vê há
 * quanto tempo ele não sai do lugar (dentro de `toleranciaEstavel`).
 */
export function convergencia(leituras: Leitura[]): Convergencia | null {
  if (!leituras.length) return null;
  const final = combinarLeituras(leituras);
  if (!final) return null;
  const tol = toleranciaEstavel(final.precisao);
  const tFim = leituras[leituras.length - 1].t;
  // o ponto médio depois de cada leitura, do fim para o começo: a última vez que
  // ele estava longe do final é quando "parou de andar"
  let desde = leituras[0].t;
  let andouM = 0;
  for (let i = leituras.length - 1; i >= 1; i--) {
    const p = combinarLeituras(leituras.slice(0, i));
    if (!p) break;
    const d = distanciaM(p, final);
    if (leituras[i - 1].t >= tFim - 5000) andouM = Math.max(andouM, d);
    if (d > tol) { desde = leituras[i].t; break; }
  }
  return { n: final.usadas + final.descartadas, precisao: final.precisao, estavelHaS: Math.max(0, (tFim - desde) / 1000), andouM };
}

// ---------------------------------------------------------------- filtro do Caminhar

export interface FiltroCaminhar {
  /** entra a leitura bruta; sai a filtrada (null = recusada como salto) */
  passar(l: Leitura): Leitura | null;
  /** recusadas seguidas até agora */
  recusadas(): number;
  zerar(): void;
}

/**
 * Kalman de velocidade constante (x, y, vx, vy em metros a partir da 1ª leitura).
 * `acel` = desvio da aceleração de quem anda (m/s²); a medida tem σ = precisão / 1,51
 * por eixo (o raio de 68% de um erro circular é 1,51 σ).
 * Recusa a leitura cuja inovação passa do qui-quadrado de 99,9% (13,8) E fica a
 * mais de 3 m do previsto — mas depois de 3 recusas seguidas aceita (quem errou
 * foi o filtro: a pessoa correu, ou o celular ficou parado sem posição).
 */
export function criarFiltroCaminhar(op: { acel?: number } = {}): FiltroCaminhar {
  const acel = op.acel ?? 0.6;
  let o: { lon: number; lat: number } | null = null;
  let k: [number, number] = [1, 1];
  let x = [0, 0, 0, 0];
  // covariância 4×4 (linha a linha)
  let P = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  let tUlt = 0;
  let seguidas = 0;
  const idx = (i: number, j: number) => i * 4 + j;
  const iniciar = (l: Leitura, s: number) => {
    o = { lon: l.lon, lat: l.lat };
    k = metrosPorGrau(l.lat);
    x = [0, 0, 0, 0];
    P = new Array(16).fill(0);
    P[idx(0, 0)] = s * s; P[idx(1, 1)] = s * s; P[idx(2, 2)] = 4; P[idx(3, 3)] = 4;
    tUlt = l.t;
    seguidas = 0;
  };
  const sigma = (l: Leitura) => Math.max(0.005, (l.precisao ?? 5) / 1.51);
  return {
    recusadas: () => seguidas,
    zerar() { o = null; seguidas = 0; },
    passar(l) {
      if (!Number.isFinite(l.lon) || !Number.isFinite(l.lat)) return null;
      const s = sigma(l);
      if (!o) { iniciar(l, s); return l; }
      const dt = Math.min(10, Math.max(0, (l.t - tUlt) / 1000));
      // previsão: x += v·dt; P = F P Fᵀ + Q
      const F = [1, 0, dt, 0, 0, 1, 0, dt, 0, 0, 1, 0, 0, 0, 0, 1];
      const mul = (A: number[], B: number[]) => {
        const C = new Array(16).fill(0);
        for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let m = 0; m < 4; m++) C[idx(i, j)] += A[idx(i, m)] * B[idx(m, j)];
        return C;
      };
      const tr = (A: number[]) => { const T = new Array(16); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) T[idx(i, j)] = A[idx(j, i)]; return T; };
      const xp = [x[0] + x[2] * dt, x[1] + x[3] * dt, x[2], x[3]];
      const q = acel * acel;
      const Q = new Array(16).fill(0);
      const dt2 = dt * dt, dt3 = dt2 * dt / 2, dt4 = dt2 * dt2 / 4;
      Q[idx(0, 0)] = dt4 * q; Q[idx(1, 1)] = dt4 * q; Q[idx(0, 2)] = Q[idx(2, 0)] = dt3 * q; Q[idx(1, 3)] = Q[idx(3, 1)] = dt3 * q;
      Q[idx(2, 2)] = dt2 * q; Q[idx(3, 3)] = dt2 * q;
      const Pp = mul(mul(F, P), tr(F)).map((v, i) => v + Q[i]);
      // medida
      const z = [(l.lon - o.lon) * k[0], (l.lat - o.lat) * k[1]];
      const y = [z[0] - xp[0], z[1] - xp[1]];
      const S = [Pp[idx(0, 0)] + s * s, Pp[idx(0, 1)], Pp[idx(1, 0)], Pp[idx(1, 1)] + s * s];
      const det = S[0] * S[3] - S[1] * S[2];
      if (!(det > 0)) { iniciar(l, s); return l; }
      const Si = [S[3] / det, -S[1] / det, -S[2] / det, S[0] / det];
      const d2 = y[0] * (Si[0] * y[0] + Si[1] * y[1]) + y[1] * (Si[2] * y[0] + Si[3] * y[1]);
      if (d2 > 13.8 && Math.hypot(y[0], y[1]) > 3 && seguidas < 3) {
        seguidas++;
        return null;
      }
      if (seguidas >= 3) { iniciar(l, s); return l; }
      seguidas = 0;
      // ganho K = Pp Hᵀ S⁻¹ (H pega x e y)
      const K = [0, 1, 2, 3].map((i) => [
        Pp[idx(i, 0)] * Si[0] + Pp[idx(i, 1)] * Si[2],
        Pp[idx(i, 0)] * Si[1] + Pp[idx(i, 1)] * Si[3],
      ]);
      x = xp.map((v, i) => v + K[i][0] * y[0] + K[i][1] * y[1]);
      const KH = new Array(16).fill(0);
      for (let i = 0; i < 4; i++) { KH[idx(i, 0)] = K[i][0]; KH[idx(i, 1)] = K[i][1]; }
      const IKH = KH.map((v, i) => (i % 5 === 0 ? 1 : 0) - v);
      P = mul(IKH, Pp);
      tUlt = l.t;
      return { ...l, lon: o.lon + x[0] / k[0], lat: o.lat + x[1] / k[1] };
    },
  };
}
