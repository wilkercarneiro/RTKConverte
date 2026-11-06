// O envio das medições de quem está logado (a fila em si: lib/campo/fila.ts).
//
// A casca do sistema (AppShell) chama enviarMedicoesPendentes() ao entrar,
// quando a internet volta e quando a aba volta a aparecer — assim a medição
// feita sem sinal sobe mesmo que a pessoa não abra o #/campo de novo. Com o
// #/campo aberto, a tela registra a SUA fila (registrarTela).
import { supabase } from "../supabase";
import { armazemDoUsuario, gravarAparelho, lerAparelho, paraEnviar } from "./aparelho.ts";
import type { Armazem } from "./aparelho.ts";
import { repositorioSupabase } from "./conta.ts";
import { enviarPendentes } from "./fila.ts";
import type { Fila, ResultadoFila } from "./fila.ts";

// ---------------------------------------------------------------------------
// O aparelho de quem está logado
// ---------------------------------------------------------------------------

function storageDoNavegador(): Armazem | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}

/** O id de quem está logado (null = ninguém). */
export async function usuarioAtual(): Promise<string | null> {
  try {
    if (!supabase) return null;
    const { data } = await supabase.auth.getSession();
    return data.session?.user.id ?? null;
  } catch {
    return null;
  }
}

/** O aparelho de quem está logado (null = sem login ou sem storage). */
export async function aparelhoDaSessao(): Promise<Armazem | null> {
  const base = storageDoNavegador();
  const u = await usuarioAtual();
  return base && u ? armazemDoUsuario(base, u) : null;
}

let filaDaTela: (() => Fila) | null = null;

/** O #/campo aberto: a fila passa a ser a da tela (o estado dela na memória). */
export function registrarTela(f: () => Fila): () => void {
  filaDaTela = f;
  return () => { if (filaDaTela === f) filaDaTela = null; };
}

/** Pedido de "guardar para sempre": o Safari do iPhone apaga o site sem uso por 7 dias. */
let pediuPersistir = false;
export function pedirArmazenamentoPersistente(): void {
  if (pediuPersistir) return;
  pediuPersistir = true;
  try {
    const st = (navigator as Navigator & { storage?: { persist?: () => Promise<boolean> } }).storage;
    void st?.persist?.().catch(() => false);
  } catch { /* navegador sem a API */ }
}

/** A casca do sistema chama: ao entrar, quando a internet volta, quando a aba volta. */
export async function enviarMedicoesPendentes(): Promise<ResultadoFila | null> {
  if (filaDaTela) return enviarPendentes(filaDaTela());
  if (typeof navigator !== "undefined" && navigator.onLine === false) return null;
  const arm = await aparelhoDaSessao();
  if (!arm) return null;
  if (!Object.values(lerAparelho(arm).registros).some(paraEnviar)) return null;
  return enviarPendentes({ repo: repositorioSupabase(), ler: () => lerAparelho(arm), gravar: (e) => { gravarAparelho(arm, e); } });
}
