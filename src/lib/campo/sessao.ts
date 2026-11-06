// Quem está logado, mesmo SEM internet.
//
// supabase.auth.getSession() com o token vencido (sessão de mais de 1 hora, o
// caso de quem sai do escritório e dirige até a fazenda) tenta renovar; sem
// rede a renovação falha e ele devolve session null. A casca continua logada,
// mas o Campo achava que não havia ninguém: sumiam a retomada, a lista do
// aparelho e a gravação de cada vértice. O aparelho é por usuário e só precisa
// do id — que está na sessão gravada no próprio navegador, vencida ou não.
// (Para ENVIAR à conta continua valendo a sessão válida: a fila trata o sem-login.)

export interface ArmazemLeitura {
  readonly length: number;
  key(i: number): string | null;
  getItem(k: string): string | null;
}

function idDe(texto: string | null): string | null {
  if (!texto) return null;
  try {
    const o = JSON.parse(texto) as { user?: { id?: unknown }; currentSession?: { user?: { id?: unknown } } } | null;
    const id = o?.user?.id ?? o?.currentSession?.user?.id;
    return typeof id === "string" && id ? id : null;
  } catch {
    return null;
  }
}

/**
 * O id do usuário na sessão que o supabase gravou no navegador (chave
 * `sb-<ref>-auth-token`, ou a `chave` do cliente). Só aceita a de outro ref se
 * houver UMA: duas contas de projetos diferentes no mesmo navegador = não adivinha.
 */
export function usuarioDaSessaoGravada(st: ArmazemLeitura | null, chave?: string | null): string | null {
  if (!st) return null;
  try {
    if (chave) {
      const id = idDe(st.getItem(chave)) ?? idDe(st.getItem(`${chave}-user`));
      if (id) return id;
    }
    const ids = new Set<string>();
    for (let i = 0; i < st.length; i++) {
      const k = st.key(i);
      if (!k || !/^sb-.+-auth-token(-user)?$/.test(k)) continue;
      const id = idDe(st.getItem(k));
      if (id) ids.add(id);
    }
    return ids.size === 1 ? [...ids][0] : null;
  } catch {
    return null;
  }
}
