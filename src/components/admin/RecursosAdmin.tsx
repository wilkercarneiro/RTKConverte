// Catálogo de recursos, como o código o declara (src/lib/recursos.ts) e o
// painel sincroniza ao abrir. Aqui se vê o que é novo, em quantos planos está e
// quantas empresas têm exceção — a decisão em si é na matriz de Planos.
import { useEffect, useState } from "react";
import { matrizPlanos } from "../../lib/admin";
import type { DadosAdmin } from "./PainelAdmin";
import { Carregando, Topo, fmtData } from "./comum";

export function RecursosAdmin({ d }: { d: DadosAdmin }) {
  const [matriz, setMatriz] = useState<{ plano_id: string; recurso_chave: string; liberado: boolean }[] | null>(null);
  useEffect(() => { matrizPlanos().then(setMatriz).catch(() => setMatriz([])); }, []);

  const semana = Date.now() - 7 * 86_400_000;
  const ativos = d.recursos.filter((r) => r.ativo);
  const fora = d.recursos.filter((r) => !r.ativo);

  return (
    <>
      <Topo olho="Catálogo" titulo="Recursos do sistema"
        sub="Todo recurso criado no sistema entra aqui sozinho. Enquanto um plano não decide, vale o padrão de cada um.">
        <button onClick={() => d.ir({ t: "admin", aba: "planos" })}>Decidir nos planos →</button>
      </Topo>
      {d.novosRecursos > 0 && <div className="sa-aviso info">{d.novosRecursos} recurso(s) novo(s) entraram no catálogo agora. Confira nos planos o que cada um libera.</div>}

      {!matriz ? <Carregando /> : (
        <section className="sa-card" style={{ padding: "14px 10px" }}>
          <div className="sa-tabela-wrap">
            <table className="sa-tabela">
              <thead><tr><th>Recurso</th><th>Grupo</th><th>Padrão</th><th>Planos que liberam</th><th>Desde</th></tr></thead>
              <tbody>
                {ativos.map((r) => {
                  const linhas = matriz.filter((m) => m.recurso_chave === r.chave);
                  const liberam = linhas.filter((m) => m.liberado).map((m) => d.planos.find((p) => p.id === m.plano_id)?.nome).filter(Boolean);
                  const indecisos = d.planos.length - linhas.length;
                  return (
                    <tr key={r.chave}>
                      <td>
                        <b>{r.nome}</b> {new Date(r.criado_em).getTime() > semana && <span className="sa-novo">novo</span>}
                        <div className="sub" style={{ fontSize: 12.5 }}>{r.descricao}</div>
                        <code>{r.chave}</code>
                      </td>
                      <td>{r.grupo}</td>
                      <td>{r.padrao ? <span className="sa-pill ativo">Liberado</span> : <span className="sa-pill neutro">Bloqueado</span>}</td>
                      <td>
                        {liberam.length ? liberam.join(", ") : <span className="sub">nenhum</span>}
                        {indecisos > 0 && <div className="sub" style={{ fontSize: 12 }}>{indecisos} plano(s) ainda sem decisão</div>}
                      </td>
                      <td>{fmtData(r.criado_em)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {fora.length > 0 && (
            <p className="sub" style={{ padding: "10px 12px 0" }}>
              Fora do código (guardados, sem efeito): {fora.map((r) => r.nome).join(", ")}.
            </p>
          )}
        </section>
      )}
    </>
  );
}
