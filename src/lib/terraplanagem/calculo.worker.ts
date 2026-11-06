// Volumes, equilíbrio e desenho fora da thread da tela: com milhares de pontos
// e a bisseção da cota são algumas centenas de milissegundos (mais no celular).
// O TIN fica guardado aqui entre um cálculo e outro (calculo.ts: cacheTin).
import { calcularTerraplanagem, ErroTerraplanagem } from "./calculo.ts";
import type { ProjetoTerraplanagem } from "./modelo.ts";

self.onmessage = (e: MessageEvent<{ id: number; projeto: ProjetoTerraplanagem }>) => {
  try {
    const r = calcularTerraplanagem(e.data.projeto);
    const m = r.malha;
    (self as unknown as Worker).postMessage({ id: e.data.id, ok: true, r }, [m.terreno.buffer, m.altura.buffer, m.projeto.buffer]);
  } catch (err) {
    (self as unknown as Worker).postMessage({
      id: e.data.id, ok: false, erro: err instanceof Error ? err.message : String(err), doUsuario: err instanceof ErroTerraplanagem,
    });
  }
};
