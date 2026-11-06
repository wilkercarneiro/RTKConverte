// De onde vêm as posições: o GPS do aparelho (navigator.geolocation) ou, no
// laboratório, um trajeto gravado tocado em sequência (simulador). A tela só
// conhece a interface FonteGps — as duas se trocam sem mudar nada nela.
import type { Leitura } from "./tipos.ts";

export type TipoErroGps = "sem-permissao" | "indisponivel" | "sem-sinal";

export interface ErroGps {
  tipo: TipoErroGps;
  mensagem: string;
}

export interface FonteGps {
  /** Começa a ouvir; devolve a função que para. */
  iniciar(aoLer: (l: Leitura) => void, aoErrar: (e: ErroGps) => void): () => void;
}

/** O que dizer ao usuário em cada falha (com o caminho para resolver). */
export const TEXTO_ERRO_GPS: Record<TipoErroGps, string> = {
  "sem-permissao":
    "O navegador não deixou usar a localização. Para liberar: toque no cadeado ao lado do endereço → Permissões → Localização → Permitir, e recarregue a página. " +
    "No iPhone: Ajustes → Privacidade → Serviços de Localização → Safari → Durante o uso. Enquanto isso, dá para desenhar à mão no mapa.",
  indisponivel:
    "Este aparelho não informa a localização (no computador é comum). Dá para desenhar o contorno à mão no mapa; para medir andando, abra esta tela no celular.",
  "sem-sinal":
    "O GPS ainda não achou sinal. Vá para um lugar aberto, longe de telhado e de árvore, e espere alguns segundos.",
};

/** O GPS do aparelho. Precisa de https (ou localhost). */
export function fonteDoNavegador(): FonteGps {
  return {
    iniciar(aoLer, aoErrar) {
      const geo = typeof navigator !== "undefined" ? navigator.geolocation : undefined;
      if (!geo) { aoErrar({ tipo: "indisponivel", mensagem: TEXTO_ERRO_GPS.indisponivel }); return () => {}; }
      if (typeof isSecureContext !== "undefined" && !isSecureContext) {
        aoErrar({ tipo: "indisponivel", mensagem: "A localização só funciona com o endereço seguro (https). Abra pelo vertces.com.br." });
        return () => {};
      }
      const id = geo.watchPosition(
        (p) => aoLer({
          lon: p.coords.longitude, lat: p.coords.latitude,
          precisao: Number.isFinite(p.coords.accuracy) ? p.coords.accuracy : null,
          alt: p.coords.altitude ?? null,
          t: p.timestamp || Date.now(),
        }),
        (e) => {
          const tipo: TipoErroGps = e.code === 1 ? "sem-permissao" : "sem-sinal";
          aoErrar({ tipo, mensagem: TEXTO_ERRO_GPS[tipo] });
        },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
      );
      return () => geo.clearWatch(id);
    },
  };
}

/** Uma fonte que só falha (laboratório: "sem GPS", "sem permissão"). */
export function fonteComErro(tipo: TipoErroGps): FonteGps {
  return { iniciar(_l, aoErrar) { const t = setTimeout(() => aoErrar({ tipo, mensagem: TEXTO_ERRO_GPS[tipo] }), 30); return () => clearTimeout(t); } };
}

// ---------------------------------------------------------------------------
// Simulador (laboratório)
// ---------------------------------------------------------------------------

export interface EstadoSimulador {
  indice: number;
  total: number;
  tocando: boolean;
  velocidade: number;
  /** multiplica a precisão (e o erro) das leituras: "sinal ruim" de mentira */
  piora: number;
}

export interface Simulador extends FonteGps {
  tocar(): void;
  pausar(): void;
  /** entrega as próximas n leituras agora (sem esperar o relógio) */
  avancar(n?: number): void;
  irPara(indice: number): void;
  velocidade(v: number): void;
  piorar(fator: number): void;
  estado(): EstadoSimulador;
  /** a tela do laboratório redesenha quando o estado muda */
  assinar(f: () => void): () => void;
}

/**
 * Toca um trajeto gravado: uma leitura a cada `intervaloMs / velocidade`. As
 * leituras saem com o relógio de agora (t = Date.now()), como sairiam do GPS —
 * o Marcar ponto junta as que chegam na janela dele.
 */
export function criarSimulador(trajeto: Leitura[], intervaloMs = 1000): Simulador {
  let indice = 0, tocando = false, vel = 1, piora = 1;
  let timer: ReturnType<typeof setInterval> | null = null;
  const leitores = new Set<(l: Leitura) => void>();
  const ouvintes = new Set<() => void>();
  // o retrato do estado só muda quando algo muda (useSyncExternalStore compara por referência)
  let retrato: EstadoSimulador = { indice, total: trajeto.length, tocando, velocidade: vel, piora };
  const mudou = () => {
    retrato = { indice, total: trajeto.length, tocando, velocidade: vel, piora };
    ouvintes.forEach((f) => f());
  };
  const atual = () => trajeto[Math.min(indice, trajeto.length - 1)];
  const emitir = (l: Leitura) => {
    const out: Leitura = { ...l, t: Date.now(), precisao: l.precisao == null ? null : l.precisao * piora };
    leitores.forEach((f) => f(out));
  };
  const passo = () => {
    if (indice >= trajeto.length - 1) { indice = trajeto.length - 1; emitir(atual()); pausar(); return; }
    indice++;
    emitir(atual());
    mudou();
  };
  const religar = () => {
    if (timer) clearInterval(timer);
    timer = tocando ? setInterval(passo, Math.max(16, intervaloMs / vel)) : null;
  };
  // parado, o GPS de verdade continua mandando a mesma posição (uma por segundo)
  let repouso: ReturnType<typeof setInterval> | null = null;
  const ligarRepouso = () => {
    if (repouso || !leitores.size) return;
    repouso = setInterval(() => { if (!tocando && trajeto.length) emitir(atual()); }, intervaloMs);
  };
  function pausar() { tocando = false; religar(); mudou(); }
  return {
    iniciar(aoLer) {
      leitores.add(aoLer);
      if (trajeto.length) setTimeout(() => emitir(atual()), 0);
      ligarRepouso();
      return () => {
        leitores.delete(aoLer);
        if (!leitores.size && repouso) { clearInterval(repouso); repouso = null; }
      };
    },
    tocar() { if (indice >= trajeto.length - 1) indice = 0; tocando = true; religar(); mudou(); },
    pausar,
    avancar(n = 1) { for (let i = 0; i < n && indice < trajeto.length - 1; i++) { indice++; emitir(atual()); } mudou(); },
    irPara(i) { indice = Math.max(0, Math.min(trajeto.length - 1, i)); if (trajeto.length) emitir(atual()); mudou(); },
    velocidade(v) { vel = v > 0 ? v : 1; religar(); mudou(); },
    piorar(f) { piora = f > 0 ? f : 1; if (trajeto.length) emitir(atual()); mudou(); },
    estado: () => retrato,
    assinar(f) { ouvintes.add(f); return () => { ouvintes.delete(f); }; },
  };
}
