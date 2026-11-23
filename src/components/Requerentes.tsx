// "Quantos requerentes assinam?" — o detentor é o 1º; daqui sai uma linha (nome,
// CPF, gênero) para cada um dos outros. Todos assinam a planta, o memorial e as
// peças técnicas (pedido de cliente, 23/11/2026). Usado nos Dados do serviço
// completo/conferência e no serviço de peças pelo PDF do SIGEF.
import { useState } from "react";
import type { Servico } from "../lib/types";
import {
  MAX_REQUERENTES, camposDasLinhas, comQuantidade, linhasDoServico, ordinal, quemSaiAoReduzir, totalQueAssina,
  type RequerenteTela,
} from "../lib/requerentes";
import { Secao, confirmar } from "./ui";

type CamposRequerentes = Pick<Servico, "requerente2_nome" | "requerente2_cpf" | "requerente2_genero" | "requerentes_extras">;

export function RequerentesQueAssinam({ servico, onMudar, posse }: {
  servico: CamposRequerentes & Pick<Servico, "detentor_nome">;
  onMudar: (campos: CamposRequerentes) => void;
  posse?: boolean;
}) {
  const salvas = linhasDoServico(servico);
  // a quantidade escolhida vale mesmo antes de digitar o nome do 2º (linha vazia
  // não é gravada nas colunas do 2º, só na lista dos extras)
  const [escolhido, setEscolhido] = useState<number | null>(null);
  const total = Math.max(1 + salvas.length, escolhido ?? 0);
  const linhas = comQuantidade(salvas, total);
  const assinam = totalQueAssina(linhas);
  const papel = posse ? "posseiro" : "requerente";

  async function trocarQuantidade(n: number) {
    const saem = quemSaiAoReduzir(linhas, n);
    if (saem.length) {
      const ok = await confirmar({
        titulo: saem.length === 1 ? `Tirar ${saem[0]}?` : `Tirar ${saem.length} requerentes?`,
        texto: <p>{saem.join(", ")} {saem.length === 1 ? "deixa" : "deixam"} de assinar a planta, o memorial e as peças.</p>,
        confirmar: "Tirar",
        perigo: true,
      });
      if (!ok) return;
    }
    setEscolhido(n);
    onMudar(camposDasLinhas(comQuantidade(linhas, n)));
  }

  function mudarLinha(i: number, mudou: Partial<RequerenteTela>) {
    onMudar(camposDasLinhas(linhas.map((r, k) => (k === i ? { ...r, ...mudou } : r))));
  }

  return (
    <Secao titulo="Requerentes que assinam"
      selo={<span className={`secao-selo ${assinam > 1 ? "completa" : ""}`}>{assinam > 1 ? `${assinam} assinam` : "só o detentor"}</span>}
      abrirEm={linhas.length > 0}
      dica={`o 1º é o detentor; cada ${papel} a mais assina a planta, o memorial e todas as peças, com nome e CPF`}>
      <div className="grade requerentes-grade">
        <label>Quantos assinam?
          <select value={total} onChange={(e) => void trocarQuantidade(Number(e.target.value))} aria-label="Quantidade de requerentes que assinam">
            {Array.from({ length: MAX_REQUERENTES }, (_, k) => k + 1).map((n) => (
              <option key={n} value={n}>{n === 1 ? "1 — só o detentor" : `${n} requerentes`}</option>
            ))}
          </select>
        </label>
        <label>1º — detentor
          <input value={servico.detentor_nome ?? ""} readOnly tabIndex={-1} className="campo-leitura"
            title="O detentor é o 1º requerente: troque-o no campo Detentor, acima" />
        </label>
      </div>
      {linhas.map((r, i) => (
        <div className="grade requerentes-grade" key={i}>
          <label>Nome do {ordinal(i + 2)} {papel}
            <input id={i === 0 ? "campo-requerente2" : undefined} value={r.nome} placeholder="Nome completo" maxLength={150}
              onChange={(e) => mudarLinha(i, { nome: e.target.value })} />
          </label>
          <label>CPF do {ordinal(i + 2)}
            <input className="mono" value={r.cpf} placeholder="000.000.000-00" maxLength={20}
              onChange={(e) => mudarLinha(i, { cpf: e.target.value })} />
          </label>
          <label>Gênero do {ordinal(i + 2)}
            <select value={r.genero} onChange={(e) => mudarLinha(i, { genero: e.target.value as "M" | "F" })}>
              <option value="M">Masculino</option><option value="F">Feminino</option>
            </select>
          </label>
        </div>
      ))}
    </Secao>
  );
}
