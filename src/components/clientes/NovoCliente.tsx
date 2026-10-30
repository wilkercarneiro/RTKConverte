// Gaveta "Novo cliente": o essencial para começar (nome, tipo, documento,
// contato e cidade). O resto da qualificação fica na página do cliente.
import { useState } from "react";
import { supabase } from "../../lib/supabase";
import type { Cliente } from "../../lib/types";
import { avisar, Gaveta, Rotulo } from "../ui";
import { Icone } from "../Icone";
import { IC } from "./comum";
import { avisoDoc, docEstado, emailValido, formatarDoc, formatarTelefone, soDigitos, UFS } from "./qualificacao";
import type { TipoPessoa } from "./qualificacao";

export function NovoCliente({ existentes, onFechar, onCriado, onAbrirExistente }: {
  existentes: Cliente[];
  onFechar: () => void;
  onCriado: (id: string) => void;
  onAbrirExistente: (id: string) => void;
}) {
  const [tipo, setTipo] = useState<TipoPessoa>("PF");
  const [nome, setNome] = useState("");
  const [doc, setDoc] = useState("");
  const [tel, setTel] = useState("");
  const [email, setEmail] = useState("");
  const [cidade, setCidade] = useState("");
  const [uf, setUf] = useState("");
  const [criando, setCriando] = useState(false);
  const [tentou, setTentou] = useState(false);

  const [digitando, setDigitando] = useState(false);
  const estadoDoc = docEstado(doc, tipo);
  // depois de tentar criar, "incompleto" aparece mesmo com o foco no campo
  const aviso = avisoDoc(doc, tipo, digitando && !tentou);
  const emailOk = !email.trim() || emailValido(email);
  const digitos = soDigitos(doc);
  // mesmo CPF/CNPJ já cadastrado: oferece abrir o que existe em vez de duplicar
  const repetido = digitos.length >= 11 ? existentes.find((c) => soDigitos(c.cpf_cnpj ?? "") === digitos) : undefined;
  const pode = nome.trim().length > 1 && (estadoDoc === "vazio" || estadoDoc === "ok") && emailOk && !criando;

  function trocarTipo(t: TipoPessoa) {
    setTipo(t);
    setDoc((d) => formatarDoc(d, t));
  }

  async function criar() {
    setTentou(true);
    if (!pode) return;
    setCriando(true);
    const { data, error } = await supabase.from("clientes").insert({
      nome: nome.trim().toUpperCase(),
      tipo_pessoa: tipo,
      cpf_cnpj: doc.trim() || null,
      telefone: tel.trim() || null,
      email: email.trim() || null,
      cidade: cidade.trim() ? cidade.trim().toUpperCase() : null,
      uf: uf || null,
    }).select().single();
    setCriando(false);
    if (error) { avisar("erro", `Não foi possível criar o cliente: ${error.message}`); return; }
    if (data) onCriado((data as Cliente).id);
  }

  const pj = tipo === "PJ";
  return (
    <Gaveta titulo="Novo cliente" olho="Cadastro" onFechar={onFechar}
      rodape={
        <>
          <button type="button" className="fantasma" onClick={onFechar}>Cancelar</button>
          <button type="submit" form="cl-novo" className="principal" disabled={criando || (tentou && !pode)}>
            {criando ? "Criando…" : "Criar e abrir"}
          </button>
        </>
      }>
      <form id="cl-novo" className="cl-novo" onSubmit={(e) => { e.preventDefault(); void criar(); }}>
        <span className="cl-novo-rotulo">
          <Rotulo dica="RG, estado civil, endereço e o resto da qualificação ficam na página do cliente, que abre logo depois de criar">Tipo de pessoa</Rotulo>
        </span>
        <div className="cl-tipo" role="radiogroup" aria-label="Tipo de pessoa">
          {([["PF", "Pessoa física", IC.pessoa, "proprietário, possuidor, herdeiro"], ["PJ", "Pessoa jurídica", IC.predio, "empresa, associação, cooperativa"]] as const).map(([k, r, ic, sub]) => (
            <button key={k} type="button" role="radio" aria-checked={tipo === k} className={tipo === k ? "ativo" : ""} onClick={() => trocarTipo(k)}>
              <Icone d={ic} size={20} />
              <span><b>{r}</b><small>{sub}</small></span>
            </button>
          ))}
        </div>

        <div className="grade" data-grade>
          <label className="largo">
            <Rotulo obrigatorio dica="gravado em MAIÚSCULAS, como sai nos documentos">{pj ? "Razão social" : "Nome completo"}</Rotulo>
            <input autoFocus value={nome} onChange={(e) => setNome(e.target.value)} placeholder={pj ? "Ex.: AGROPECUÁRIA BOA VISTA LTDA" : "Ex.: JOSÉ DA SILVA SANTOS"}
              className="cl-maiusculo" aria-invalid={tentou && nome.trim().length < 2} />
          </label>
          <label>
            <Rotulo>{pj ? "CNPJ" : "CPF"}</Rotulo>
            <input className={`mono${aviso ? " cl-invalido" : ""}`} inputMode="numeric" value={doc}
              onChange={(e) => setDoc(formatarDoc(e.target.value, tipo))} placeholder={pj ? "00.000.000/0000-00" : "000.000.000-00"}
              onFocus={() => setDigitando(true)} onBlur={() => setDigitando(false)} aria-invalid={!!aviso} />
            {aviso && <span className="cl-erro-campo">{aviso}</span>}
          </label>
          <label>
            <Rotulo>Telefone / WhatsApp</Rotulo>
            <input inputMode="tel" value={tel} onChange={(e) => setTel(formatarTelefone(e.target.value))} placeholder="(00) 00000-0000" />
          </label>
          <label>
            <Rotulo>E-mail</Rotulo>
            <input type="email" className={emailOk ? "" : "cl-invalido"} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nome@exemplo.com" aria-invalid={!emailOk} />
            {!emailOk && <span className="cl-erro-campo">e-mail incompleto</span>}
          </label>
          <div className="cl-cidade-uf">
            <label>
              <Rotulo>Cidade</Rotulo>
              <input value={cidade} onChange={(e) => setCidade(e.target.value)} placeholder="Ex.: Irecê" />
            </label>
            <label>
              <Rotulo>UF</Rotulo>
              <select value={uf} onChange={(e) => setUf(e.target.value)}>
                <option value="">—</option>
                {UFS.map((u) => <option key={u}>{u}</option>)}
              </select>
            </label>
          </div>
        </div>

        {repetido && (
          <div className="cl-aviso" role="status">
            <Icone d={IC.alerta} size={18} />
            <span>Já existe um cliente com este {pj ? "CNPJ" : "CPF"}: <b>{repetido.nome}</b>.</span>
            <button type="button" className="link" onClick={() => onAbrirExistente(repetido.id)}>Abrir cadastro</button>
          </div>
        )}
      </form>
    </Gaveta>
  );
}
