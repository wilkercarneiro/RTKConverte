// Gancho de resolução de módulos: troca o supabase-js pelo banco falso.
const FALSO = new URL("./supabase-falso.mjs", import.meta.url).href;
export async function resolve(especificador, contexto, proximo) {
  if (especificador === "@supabase/supabase-js") return { url: FALSO, shortCircuit: true };
  return proximo(especificador, contexto);
}
