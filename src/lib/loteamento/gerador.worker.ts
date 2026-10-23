// Gera as propostas fora da thread da tela: numa gleba grande (80 ha, 2.000
// lotes) o gerador testa dezenas de malhas e leva alguns segundos — a página
// não pode congelar enquanto isso.
import { gerarPropostas } from "./auto.ts";
import type { OpcoesGerar } from "./auto.ts";
import type { Perimetro } from "./calculo.ts";
import type { Projeto } from "./modelo.ts";

self.onmessage = (e: MessageEvent<{ projeto: Projeto; perimetro: Perimetro; op: OpcoesGerar }>) => {
  try {
    const props = gerarPropostas(e.data.projeto, e.data.perimetro, e.data.op);
    (self as unknown as Worker).postMessage({ ok: true, props });
  } catch (err) {
    (self as unknown as Worker).postMessage({ ok: false, erro: err instanceof Error ? err.message : String(err) });
  }
};
