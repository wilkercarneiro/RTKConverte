// Importa o loteamento pronto fora da thread da tela: o DXF de um loteamento
// grande (centenas de lotes) leva alguns segundos entre ler, recortar e
// repartir o viário — a página não pode congelar enquanto isso.
import { importarLoteamento } from "./index.ts";
import type { Perimetro } from "../calculo.ts";
import type { Projeto } from "../modelo.ts";

self.onmessage = async (e: MessageEvent<{ nome: string; bytes: Uint8Array; base: Projeto; perimetro: Perimetro; fuso: number }>) => {
  try {
    const { nome, bytes, base, perimetro, fuso } = e.data;
    const imp = await importarLoteamento({ nome, bytes }, base, perimetro, fuso);
    (self as unknown as Worker).postMessage({ ok: true, imp });
  } catch (err) {
    (self as unknown as Worker).postMessage({ ok: false, erro: err instanceof Error ? err.message : String(err) });
  }
};
