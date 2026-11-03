// Comandos pesados da prancheta ("Igualar áreas", "fundo com fundo" nos lotes
// selecionados ou na quadra) fora da thread da tela: numa quadra grande ou de três frentes o
// rearranjo testa dezenas de arranjos e leva vários segundos — a página não pode
// congelar enquanto isso.
import { executar, refazerDados } from "./acoes.ts";
import type { Selecao } from "./acoes.ts";
import { calcular } from "./calculo.ts";
import type { Perimetro, Resultado } from "./calculo.ts";
import { melhorEstrutura } from "./edicao.ts";
import type { Projeto } from "./modelo.ts";

self.onmessage = (e: MessageEvent<{ texto: string; projeto: Projeto; res: Resultado; sel: Selecao; perimetro?: Perimetro }>) => {
  try {
    // (os dados chegam copiados: refeitos, o cálculo roda na velocidade normal — ver refazerDados)
    const { texto, projeto, res, sel, perimetro } = refazerDados(e.data);
    const s = executar(texto, projeto, res, sel);
    // "fundo com fundo" da quadra inteira: as variantes da linha central (quantidade, esquina)
    // também aqui — cada uma é um cálculo da planta, e eram ~2 s de tela parada
    if (s.pr && s.estruturar !== undefined && s.escolherEstrutura && perimetro) {
      const q = res.quadras.find((x) => x.nome === s.escolherEstrutura);
      if (q) s.melhor = melhorEstrutura(projeto, res, q, (p) => { try { return calcular(p, perimetro); } catch { return null; } });
    }
    (self as unknown as Worker).postMessage({ ok: true, s });
  } catch (err) {
    (self as unknown as Worker).postMessage({ ok: false, erro: err instanceof Error ? err.message : String(err) });
  }
};
