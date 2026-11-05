// Os arquivos finais do CAR e do loteamento saem do servidor (função
// `entregar`, auditoria de 04/11/2026): ele lê o projeto do banco, confere o
// imóvel do serviço (contorno assinado, 0039) e devolve o arquivo. Aqui só se
// pede e baixa.
import { arquivoDaFuncao } from "./supabase";
import type { DadosCarimbo } from "./loteamento/planta.ts";

export function baixarBlob(blob: Blob, nome: string): void {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: nome });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function base64(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

/** O carimbo como a função `entregar` recebe (imagens em base64). */
export function carimboParaEnvio(c: DadosCarimbo): Record<string, unknown> {
  const { logo, situacao, ...textos } = c;
  return {
    ...textos,
    logo: logo ? { tipo: logo.tipo, base64: base64(logo.bytes) } : null,
    situacao: situacao ? base64(situacao) : null,
  };
}

/** Pede um arquivo ao servidor e baixa. */
export async function baixarEntrega(corpo: { servico_id: string; saida: string } & Record<string, unknown>): Promise<void> {
  const { blob, nome } = await arquivoDaFuncao("entregar", corpo);
  baixarBlob(blob, nome);
}
