// Modelo de terreno e curvas fora da thread da tela: num imóvel de 500 ha com
// centenas de marcos são algumas centenas de milissegundos (mais num celular).
import { calcularRelevo } from "./modelo.ts";
import type { EntradaRelevo } from "./modelo.ts";

self.onmessage = (e: MessageEvent<EntradaRelevo>) => {
  try {
    const r = calcularRelevo(e.data);
    (self as unknown as Worker).postMessage({ ok: true, r });
  } catch (err) {
    (self as unknown as Worker).postMessage({ ok: false, erro: err instanceof Error ? err.message : String(err) });
  }
};
