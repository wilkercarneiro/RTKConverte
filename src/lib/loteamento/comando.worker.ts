// Comandos pesados da prancheta ("Igualar áreas", "fundo com fundo" nos lotes
// selecionados) fora da thread da tela: numa quadra grande ou de três frentes o
// rearranjo testa dezenas de arranjos e leva vários segundos — a página não pode
// congelar enquanto isso.
import { executar } from "./acoes.ts";
import type { Selecao } from "./acoes.ts";
import type { Resultado } from "./calculo.ts";
import type { Projeto } from "./modelo.ts";

self.onmessage = (e: MessageEvent<{ texto: string; projeto: Projeto; res: Resultado; sel: Selecao }>) => {
  try {
    const s = executar(e.data.texto, e.data.projeto, e.data.res, e.data.sel);
    (self as unknown as Worker).postMessage({ ok: true, s });
  } catch (err) {
    (self as unknown as Worker).postMessage({ ok: false, erro: err instanceof Error ? err.message : String(err) });
  }
};
