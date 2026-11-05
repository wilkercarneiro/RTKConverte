// Página PÚBLICA de verificação de documento: o QR da planta abre
// https://vertces.com.br/app/#/verificar/<código>. Abre sem login e consulta a
// RPC verificar_documento (migração 0043), que devolve só os campos públicos —
// nunca CPF de ninguém. Quem tem o PDF em mãos pode soltá-lo aqui: o SHA-256
// é calculado NO NAVEGADOR (o arquivo não é enviado) e comparado ao registrado.
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { Logo } from "./Logo";

export interface RegistroVerificado {
  codigo: string;
  tipo: string;
  titulo: string | null;
  denominacao: string | null;
  municipio: string | null;
  uf: string | null;
  area_ha: string | null;
  perimetro_m: string | null;
  folha: string | null;
  empresa: string | null;
  rt_nome: string | null;
  rt_registro: string | null;
  emitido_em: string;
  hash_sha256: string;
  versao_mais_nova_em: string | null;
}

export type Consulta = (codigo: string) => Promise<RegistroVerificado | null>;

/** Como o banco guarda o código: maiúsculas, sem traços; O→0, I/L→1. */
export function normalizarCodigo(entrada: string): string {
  return entrada.toUpperCase().replace(/[\s\-.]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
}

/** Prévia de conferência (tipo planta_previa, ver _shared/autenticidade.ts): não é o documento final. */
export const ehPrevia = (tipo: string | null | undefined): boolean => tipo === "planta_previa";

export function codigoEmGrupos(c: string): string {
  return c.match(/.{1,4}/g)?.join("-") ?? c;
}

const consultarNoBanco: Consulta = async (codigo) => {
  const { data, error } = await supabase.rpc("verificar_documento", { p_codigo: codigo });
  if (error) throw new Error(error.message);
  return ((data as RegistroVerificado[] | null) ?? [])[0] ?? null;
};

const dataHora = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });
};

async function sha256DoArquivo(f: File): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", await f.arrayBuffer());
  return Array.from(new Uint8Array(h), (b) => b.toString(16).padStart(2, "0")).join("");
}

type Estado =
  | { t: "digitar" }
  | { t: "carregando" }
  | { t: "ok"; r: RegistroVerificado }
  | { t: "nao" }
  | { t: "erro"; msg: string };

export function VerificarDocumento({ codigo, consultar = consultarNoBanco }: { codigo?: string; consultar?: Consulta }) {
  const [estado, setEstado] = useState<Estado>(codigo ? { t: "carregando" } : { t: "digitar" });
  const [digitado, setDigitado] = useState("");
  const [conferencia, setConferencia] = useState<{ ok: boolean; nome: string } | null>(null);

  async function buscar(c: string) {
    const n = normalizarCodigo(c);
    setConferencia(null);
    if (n.length !== 20) { setEstado({ t: "nao" }); return; }
    setEstado({ t: "carregando" });
    try {
      const r = await consultar(n);
      setEstado(r ? { t: "ok", r } : { t: "nao" });
    } catch (e) {
      setEstado({ t: "erro", msg: e instanceof Error ? e.message : String(e) });
    }
  }

  useEffect(() => { if (codigo) buscar(codigo); }, [codigo]); // eslint-disable-line react-hooks/exhaustive-deps

  async function conferirArquivo(f: File, hash: string) {
    setConferencia({ ok: (await sha256DoArquivo(f)) === hash, nome: f.name });
  }

  return (
    <main className="verif">
      <section className="verif-cartao" aria-live="polite">
        <div className="verif-topo"><Logo size={22} /> Vertces · Verificação de documento</div>

        {estado.t === "carregando" && <div className="verif-selo"><span className="spinner" /> <p>Consultando o código…</p></div>}

        {estado.t === "erro" && (
          <div className="verif-selo nao"><span className="verif-icone">!</span>
            <div><h1>Não foi possível consultar</h1><p>{estado.msg}</p></div></div>
        )}

        {estado.t === "nao" && (
          <div className="verif-selo nao"><span className="verif-icone">✕</span>
            <div><h1>Código não encontrado</h1>
              <p>Nenhum documento foi emitido com este código. Confira se digitou certo — ou desconfie do documento.</p></div></div>
        )}

        {estado.t === "ok" && (() => {
          const r = estado.r;
          return (
            <>
              {/* prévia de conferência: códigos provisórios, não serve para protocolar —
                  não pode sair com o verde de "autêntico" */}
              {ehPrevia(r.tipo) ? (
                <div className="verif-selo previa"><span className="verif-icone">!</span>
                  <div><h1>Prévia de conferência — não é o documento final</h1>
                    <p>Emitida pelo sistema Vertces em {dataHora(r.emitido_em)} só para conferência: os códigos dos vértices são provisórios e ela não vale para protocolo.</p></div></div>
              ) : (
                <div className="verif-selo ok"><span className="verif-icone">✓</span>
                  <div><h1>Documento autêntico</h1>
                    <p>Emitido pelo sistema Vertces em {dataHora(r.emitido_em)}.</p></div></div>
              )}
              {r.versao_mais_nova_em && (
                <p className="verif-aviso">Existe uma emissão mais nova deste documento (de {dataHora(r.versao_mais_nova_em)}). Confira se a cópia em mãos é a mais recente.</p>
              )}
              <dl className="verif-campos">
                <div className="largo"><dt>Documento</dt><dd>{r.titulo || "Planta do imóvel"}{r.folha ? ` · folha ${r.folha}` : ""}</dd></div>
                <div className="largo"><dt>Imóvel</dt><dd>{r.denominacao || "—"}</dd></div>
                <div><dt>Município/UF</dt><dd>{[r.municipio, r.uf].filter(Boolean).join(" / ") || "—"}</dd></div>
                <div><dt>Área</dt><dd>{r.area_ha ? `${r.area_ha} ha` : "—"}</dd></div>
                <div><dt>Perímetro</dt><dd>{r.perimetro_m ? `${r.perimetro_m} m` : "—"}</dd></div>
                <div><dt>Código</dt><dd className="mono">{codigoEmGrupos(r.codigo)}</dd></div>
                <div><dt>Empresa</dt><dd>{r.empresa || "—"}</dd></div>
                <div><dt>Responsável técnico</dt><dd>{r.rt_nome || "—"}{r.rt_registro ? ` · ${r.rt_registro}` : ""}</dd></div>
                <div className="largo"><dt>SHA-256 do arquivo original</dt><dd className="verif-hash">{r.hash_sha256}</dd></div>
              </dl>
              <div className="verif-conferir">
                <label className="dropzone linha"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) conferirArquivo(f, r.hash_sha256); }}>
                  <b>Tem o PDF? Solte aqui para conferir se é o mesmo arquivo</b>
                  <small className="sub">o arquivo não sai do seu computador: a conta é feita no navegador</small>
                  <input type="file" accept="application/pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) conferirArquivo(f, r.hash_sha256); e.target.value = ""; }} />
                </label>
                {conferencia && (
                  <p className={`resultado ${conferencia.ok ? "ok" : "nao"}`}>
                    {conferencia.ok
                      ? `${conferencia.nome}: é exatamente o arquivo emitido.`
                      : `${conferencia.nome}: NÃO é o arquivo emitido (foi alterado, impresso de novo ou é outro documento).`}
                  </p>
                )}
              </div>
            </>
          );
        })()}

        {(estado.t === "digitar" || estado.t === "nao" || estado.t === "erro") && (
          <form className="verif-busca" onSubmit={(e) => { e.preventDefault(); buscar(digitado); }}>
            <input aria-label="Código de verificação" placeholder="XXXX-XXXX-XXXX-XXXX-XXXX" value={digitado} onChange={(e) => setDigitado(e.target.value)} />
            <button className="principal" type="submit">Verificar</button>
          </form>
        )}

        <p className="verif-rodape">
          O código impresso na planta (junto do QR) identifica uma emissão. Esta página mostra só dados públicos do documento —
          nenhum dado pessoal do proprietário. A assinatura que aparece no documento é imagem, não assinatura digital ICP-Brasil.
        </p>
      </section>
    </main>
  );
}
