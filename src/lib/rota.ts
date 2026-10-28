// Roteamento por hash.
//
// A navegação era `useState` puro: atualizar a página caía no dashboard e o
// botão voltar do navegador saía do sistema. Numa tela em que o operador
// alterna entre cliente, serviço e configurações o dia inteiro, isso custa
// trabalho perdido.
//
// Hash e não History API de propósito: o app é servido como estático (Vercel) e
// `#/servico/x` nunca chega ao servidor — não há rota 404 para configurar.
import { useEffect, useState } from "react";

export type Rota =
  | { t: "inicio" }
  | { t: "clientes" }
  | { t: "servicos" }
  | { t: "config" }
  | { t: "marca" }
  | { t: "ajuda" }
  // públicas (abrem sem login)
  | { t: "cadastro" }
  | { t: "termos" }
  | { t: "privacidade" }
  | { t: "cliente"; id: string }
  | { t: "servico"; id: string }
  | { t: "novo"; chave: string; clienteId?: string }
  // painel do superadmin (SaaS): #/admin/<aba>[/<id da empresa>]
  | { t: "admin"; aba: string; id?: string };

export function rotaParaHash(r: Rota): string {
  switch (r.t) {
    case "cliente": return `#/cliente/${r.id}`;
    case "servico": return `#/servico/${r.id}`;
    case "novo": return `#/novo/${r.chave}${r.clienteId ? `/${r.clienteId}` : ""}`;
    case "admin": return `#/admin/${r.aba}${r.id ? `/${r.id}` : ""}`;
    default: return `#/${r.t}`;
  }
}

export function hashParaRota(hash: string): Rota {
  const p = hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  switch (p[0]) {
    case "clientes": return { t: "clientes" };
    case "servicos": return { t: "servicos" };
    case "config": return { t: "config" };
    case "marca": return { t: "marca" };
    case "ajuda": return { t: "ajuda" };
    case "cadastro": return { t: "cadastro" };
    case "termos": return { t: "termos" };
    case "privacidade": return { t: "privacidade" };
    case "cliente": return p[1] ? { t: "cliente", id: p[1] } : { t: "clientes" };
    case "servico": return p[1] ? { t: "servico", id: p[1] } : { t: "servicos" };
    // sem cliente na URL a chave nem aparece: um `clienteId: undefined`
    // explícito faria a rota deixar de ser igual à que a gerou
    case "novo": return p[1] ? { t: "novo", chave: p[1], ...(p[2] ? { clienteId: p[2] } : {}) } : { t: "inicio" };
    case "admin": return { t: "admin", aba: p[1] ?? "visao", ...(p[2] ? { id: p[2] } : {}) };
    default: return { t: "inicio" };
  }
}

/** Rota atual + navegação. `trocar` empilha no histórico; `substituir`, não. */
export function useRota(): { rota: Rota; ir: (r: Rota) => void; substituir: (r: Rota) => void } {
  const [rota, setRota] = useState<Rota>(() => hashParaRota(location.hash));

  useEffect(() => {
    const onHash = () => setRota(hashParaRota(location.hash));
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);

  return {
    rota,
    ir: (r) => { location.hash = rotaParaHash(r); },
    // replace: usado quando a tela atual deixou de existir (ex.: serviço recém
    // criado assume o lugar da tela "novo"), para que voltar não retorne a ela
    substituir: (r) => {
      history.replaceState(null, "", rotaParaHash(r));
      setRota(r);
    },
  };
}
