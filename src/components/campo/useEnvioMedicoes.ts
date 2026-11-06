// As medições do campo sobem de QUALQUER tela (plano, seção 2: "nada se perde").
//
// O agrimensor mede sem sinal, volta e abre o Vertces no Início ou no
// computador: a casca do sistema chama este gancho, que envia o que ficou no
// aparelho ao entrar, quando a internet volta e quando a aba volta a aparecer.
// Leve de propósito: só carrega o código do campo se o aparelho TEM medição
// guardada (a chave "vertces.campo.v1:<usuário>").
import { useEffect } from "react";

const PREFIXO = "vertces.campo.v1:";

function temMedicaoNoAparelho(): boolean {
  try {
    for (let i = 0; i < localStorage.length; i++) if (localStorage.key(i)?.startsWith(PREFIXO)) return true;
  } catch { /* sem storage */ }
  return false;
}

export function useEnvioMedicoes(): void {
  useEffect(() => {
    let ocupado = false;
    const tentar = () => {
      if (ocupado || !temMedicaoNoAparelho()) return;
      if (typeof navigator !== "undefined" && navigator.onLine === false) return;
      ocupado = true;
      import("../../lib/campo/envio.ts")
        .then((m) => m.enviarMedicoesPendentes())
        .catch(() => { /* tenta de novo no próximo gatilho */ })
        .finally(() => { ocupado = false; });
    };
    const vis = () => { if (document.visibilityState === "visible") tentar(); };
    tentar();
    addEventListener("online", tentar);
    document.addEventListener("visibilitychange", vis);
    return () => { removeEventListener("online", tentar); document.removeEventListener("visibilitychange", vis); };
  }, []);
}
