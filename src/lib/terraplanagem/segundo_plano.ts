// Um worker só, reaproveitado: pedido novo enquanto o anterior roda fica na
// fila (só o último vale) — arrastar a plataforma não empilha cálculos.
import { calcularTerraplanagem, ErroTerraplanagem } from "./calculo.ts";
import type { ResultadoTerraplanagem } from "./calculo.ts";
import type { ProjetoTerraplanagem } from "./modelo.ts";

type Resposta = { ok: true; r: ResultadoTerraplanagem } | { ok: false; erro: string; doUsuario: boolean };

export class Calculadora {
  private w: Worker | null = null;
  private seq = 0;
  private rodando: number | null = null;
  private fila: { projeto: ProjetoTerraplanagem; ok: (r: Resposta | null) => void } | null = null;
  private espera = new Map<number, (r: Resposta | null) => void>();

  constructor() {
    try {
      this.w = new Worker(new URL("./calculo.worker.ts", import.meta.url), { type: "module" });
      this.w.onmessage = (m: MessageEvent<Resposta & { id: number }>) => this.chegou(m.data.id, m.data);
      this.w.onerror = (ev) => {
        ev.preventDefault?.();
        const id = this.rodando;
        this.w?.terminate(); this.w = null; // cai para a thread da tela
        if (id != null) this.chegou(id, { ok: false, erro: `o cálculo falhou${ev.message ? `: ${ev.message}` : ""}`, doUsuario: false });
      };
    } catch { this.w = null; }
  }

  private chegou(id: number, r: Resposta) {
    const f = this.espera.get(id);
    this.espera.delete(id);
    if (this.rodando === id) this.rodando = null;
    f?.(r);
    if (this.fila && this.rodando === null) { const q = this.fila; this.fila = null; this.enviar(q.projeto, q.ok); }
  }

  private enviar(projeto: ProjetoTerraplanagem, ok: (r: Resposta | null) => void) {
    const id = ++this.seq;
    this.rodando = id;
    this.espera.set(id, ok);
    if (this.w) { this.w.postMessage({ id, projeto }); return; }
    setTimeout(() => {
      try { this.chegou(id, { ok: true, r: calcularTerraplanagem(projeto) }); }
      catch (e) { this.chegou(id, { ok: false, erro: e instanceof Error ? e.message : String(e), doUsuario: e instanceof ErroTerraplanagem }); }
    }, 0);
  }

  /** Calcula; se outro pedido chegar antes de este começar, este é descartado (devolve null). */
  calcular(projeto: ProjetoTerraplanagem): Promise<Resposta | null> {
    return new Promise((ok) => {
      if (this.rodando === null) { this.enviar(projeto, ok); return; }
      this.fila?.ok(null);
      this.fila = { projeto, ok };
    });
  }

  encerrar() { this.w?.terminate(); this.w = null; this.fila = null; }
}
