// Entregas dos projetos de infraestrutura: os números de cada rede, os
// parâmetros (o que a concessionária e a prefeitura pedem para o empreendimento)
// e os arquivos — pranchas, memorial descritivo e de cálculo, planilhas de
// dimensionamento com os quantitativos e o DXF das redes.
import { useMemo, useState } from "react";
import type { Resultado } from "../../lib/loteamento/calculo.ts";
import type { Projeto } from "../../lib/loteamento/modelo.ts";
import type { DadosCarimbo, Folha } from "../../lib/loteamento/planta.ts";
import { calcularInfra, infraDe, REDES } from "../../lib/loteamento/infra/index.ts";
import type { ParametrosInfra } from "../../lib/loteamento/infra/index.ts";
import { gerarPlantasInfra } from "../../lib/loteamento/infra/planta.ts";
import { dxfRedes, memorialInfra, zipPlanilhas } from "../../lib/loteamento/infra/saidas.ts";
import { gerarDocx } from "../../lib/loteamento/docx.ts";
import type { Servico } from "../../lib/types";
import { Dica } from "../ui";

const f = (v: number, c = 2) => v.toLocaleString("pt-BR", { minimumFractionDigits: c, maximumFractionDigits: c });
const soma = (o: Record<number, number>) => Object.values(o).reduce((a, b) => a + b, 0);

function baixar(dados: BlobPart, nome: string, tipo: string) {
  const url = URL.createObjectURL(new Blob([dados], { type: tipo }));
  const a = Object.assign(document.createElement("a"), { href: url, download: nome });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function EntregasInfra({ servico, projeto, res, base, obterCarimbo, onExportou, onMudarInfra }: {
  servico: Servico;
  projeto: Projeto;
  res: Resultado;
  base: string;
  obterCarimbo: () => Promise<DadosCarimbo>;
  onExportou: () => void;
  onMudarInfra?: (p: Partial<ParametrosInfra>) => void;
}) {
  const [folha, setFolha] = useState<Folha>("A1");
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const r = useMemo(() => calcularInfra(res, projeto), [res, projeto]);
  const prm = infraDe(projeto.infra);
  const mudar = (patch: Partial<ParametrosInfra>) => onMudarInfra?.({ ...(projeto.infra ?? {}), ...patch });

  async function fazer(rotulo: string, fn: () => Promise<void> | void) {
    setErro(null);
    setOcupado(rotulo);
    try { await new Promise((ok) => setTimeout(ok, 20)); await fn(); onExportou(); }
    catch (e) { setErro(e instanceof Error ? e.message : String(e)); }
    finally { setOcupado(null); }
  }

  const a = r.agua, e = r.esgoto, d = r.drenagem, el = r.eletrica;
  const cartoes: { id: string; titulo: string; linhas: string[] }[] = [
    { id: "agua", titulo: "Água", linhas: [`${f(soma(a.resumo.extensao), 0)} m de rede (DN ${Object.keys(a.resumo.extensao).join(", ")})`, a.reservatorio ? `Reservatório ${a.reservatorio.tipo} ${a.reservatorio.volume} m³${a.reservatorio.tipo === "elevado" ? ` · torre ${a.reservatorio.altura} m` : ""}` : "—", `Pressão ${f(a.resumo.pMin, 1)} a ${f(a.resumo.pMax, 1)} mca · ${a.hidrantes.length} hidrante(s)`] },
    { id: "esgoto", titulo: "Esgoto", linhas: [`${f(soma(e.resumo.extensao), 0)} m de coletor`, `${e.resumo.nPv} PV + ${e.resumo.nTil} TIL · até ${f(e.resumo.profMax)} m`, e.elevatoria ? `Elevatória + ${f(e.elevatoria.L, 0)} m de recalque` : e.saida?.destino === "ete" ? "Estação de tratamento compacta" : "Ligação na rede pública"] },
    { id: "drenagem", titulo: "Drenagem", linhas: [`${f(soma(d.resumo.extensao), 0)} m de galeria (Ø${Object.keys(d.resumo.extensao).join("/") || "—"})`, `${d.bocas.length} bocas de lobo · ${d.pvs.length} PVs`, `Lançamento ${f(d.resumo.qLancamento / 1000)} m³/s (T = ${prm.periodoRetorno} anos)`] },
    { id: "energia", titulo: "Energia", linhas: [`${el.resumo.nPostes} postes · ${el.trafos.length} trafos (${el.trafos.map((t) => f(t.kva, t.kva % 1 ? 1 : 0)).join(" + ")} kVA)`, `${f(el.resumo.extensaoMT, 0)} m de média · ${f(el.resumo.extensaoBT, 0)} m de baixa tensão`, `Demanda ${f(el.resumo.demanda, 1)} kVA · queda máx. ${f(el.resumo.quedaMax)}%`] },
    { id: "iluminacao", titulo: "Iluminação", linhas: [`${el.ip.quantidade} luminárias LED ${el.ip.potencia} W`, `${f(el.ip.eMedia, 1)} lux médios (classe ${el.ip.classe})`, "Nos postes da rede, unilateral"] },
  ];
  const cor = (id: string) => REDES.find((x) => x.id === id)?.cor ?? "#999";
  const avisos = [...a.avisos, ...e.avisos, ...d.avisos, ...el.avisos];

  const pranchas = () => fazer("pranchas", async () => {
    const c = await obterCarimbo();
    const bytes = await gerarPlantasInfra(res, projeto, r, c, folha);
    baixar(bytes as unknown as BlobPart, `PROJETOS_DE_INFRAESTRUTURA_${base}_${folha}.pdf`, "application/pdf");
  });
  const memorial = () => fazer("memorial", async () => {
    const c = await obterCarimbo();
    const secoes = memorialInfra(res, projeto, r, { municipio: servico.municipio ?? "", uf: servico.uf ?? "", rt: c.rt, rtRegistro: c.rtRegistro, trt: c.trt });
    const blob = await gerarDocx(secoes, `${projeto.nome} — projetos de infraestrutura`);
    baixar(blob, `MEMORIAL_INFRAESTRUTURA_${base}.docx`, blob.type);
  });
  const planilhas = () => fazer("planilhas", async () => baixar(await zipPlanilhas(res, r, base), `PLANILHAS_INFRAESTRUTURA_${base}.zip`, "application/zip"));
  const dxf = () => fazer("dxf", () => baixar(dxfRedes(res, r), `REDES_${base}.dxf`, "application/dxf"));

  return (
    <section className="bloco lot-entrega-infra" id="lot-infra">
      <header>
        <h3>Projetos de infraestrutura<Dica>Água (NBR 12218), esgoto (NBR 9649), drenagem pluvial (método racional), energia (Neoenergia DIS-NOR-012) e iluminação pública (NBR 5101), gerados pelo sistema a partir do traçado e do relevo. Mexeu numa rua, as redes acompanham. São a infraestrutura básica do art. 2º, §5º, da Lei 6.766.</Dica></h3>
        <span className="desc">{r.lotes} lotes · {r.populacao.toLocaleString("pt-BR")} habitantes de projeto</span>
      </header>
      {erro && <div className="lot-alerta erro">{erro}</div>}
      <div className="lot-infra-cartoes">
        {cartoes.map((c) => (
          <div key={c.id} className="lot-infra-cartao" style={{ borderTopColor: cor(c.id) }}>
            <b>{c.titulo}</b>
            {c.linhas.map((l) => <span key={l}>{l}</span>)}
          </div>
        ))}
      </div>

      <div className="lot-entrega-grade lot-infra-corpo">
        <div className="lot-infra-param">
          <h4>Parâmetros do empreendimento<Dica>Confira com a carta de viabilidade da concessionária de água (Embasa não publica manual de projeto), com a Coelba (tensão do município) e com o Corpo de Bombeiros (hidrantes). Tudo recalcula na hora.</Dica></h4>
          <div className="grade" data-grade>
            <label><span>Habitantes por lote</span><input type="number" min={1} max={20} step={0.5} value={prm.habPorLote} onChange={(ev) => mudar({ habPorLote: Number(ev.target.value) })} /></label>
            <label><span>Consumo (L/hab.dia)</span><input type="number" min={50} max={400} step={10} value={prm.perCapita} onChange={(ev) => mudar({ perCapita: Number(ev.target.value) })} /></label>
            <label><span>Raio do hidrante (m)</span><input type="number" min={0} max={1000} step={50} value={prm.raioHidrante} onChange={(ev) => mudar({ raioHidrante: Number(ev.target.value) })} /></label>
            <label><span>Destino do esgoto</span>
              <select value={prm.destinoEsgoto} onChange={(ev) => mudar({ destinoEsgoto: ev.target.value as ParametrosInfra["destinoEsgoto"] })}>
                <option value="ete">ETE própria</option>
                <option value="rede">Rede pública</option>
              </select>
            </label>
            <label><span>Chuva: retorno (anos)</span>
              <select value={prm.periodoRetorno} onChange={(ev) => mudar({ periodoRetorno: Number(ev.target.value) })}>
                {[2, 5, 10, 25].map((t) => <option key={t} value={t}>{t} anos</option>)}
              </select>
            </label>
            <label><span>Tensão da Coelba</span>
              <select value={prm.tensaoBT} onChange={(ev) => mudar({ tensaoBT: ev.target.value as ParametrosInfra["tensaoBT"] })}>
                <option value="220/127">220/127 V</option>
                <option value="380/220">380/220 V</option>
              </select>
            </label>
            <label><span>Padrão das casas</span>
              <select value={prm.padraoLote} onChange={(ev) => mudar({ padraoLote: ev.target.value as ParametrosInfra["padraoLote"] })}>
                <option value="A">A — interesse social</option>
                <option value="B">B — até 2 quartos</option>
                <option value="C">C — 3 a 4 quartos</option>
              </select>
            </label>
            <label><span>Iluminação da rua</span>
              <select value={prm.classeIP} onChange={(ev) => mudar({ classeIP: ev.target.value as ParametrosInfra["classeIP"] })}>
                <option value="V5">V5 — tráfego leve (5 lux)</option>
                <option value="V4">V4 — tráfego médio (10 lux)</option>
              </select>
            </label>
          </div>
          {avisos.length > 0 && (
            <details className="lot-infra-avisos">
              <summary>{avisos.length} observação(ões) do projeto</summary>
              {avisos.map((t) => <p key={t}>{t}</p>)}
            </details>
          )}
        </div>
        <div className="lot-entrega-itens">
          <div className="lot-item">
            <div>
              <b>Pranchas das redes (PDF)<Dica>Quatro folhas — água, esgoto, drenagem e energia/iluminação — no arranjo das plantas da equipe: rede cotada sobre o loteamento, legenda, quadro resumo, critérios de projeto, observações e carimbo.</Dica></b>
              <span>4 folhas · mesma escala da planta</span>
            </div>
            <select value={folha} onChange={(ev) => setFolha(ev.target.value as Folha)}>
              {(["A0", "A1", "A2", "A3"] as Folha[]).map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
            <button className="principal" disabled={!!ocupado} onClick={pranchas}>{ocupado === "pranchas" ? "Gerando…" : "Baixar"}</button>
          </div>
          <div className="lot-item">
            <div><b>Memorial descritivo e de cálculo (DOCX)<Dica>Critérios de cada norma, população e vazões, rede, reservação, destino do esgoto, chuva de projeto, demanda e transformadores, iluminação, quantitativos e observações.</Dica></b></div>
            <button disabled={!!ocupado} onClick={memorial}>{ocupado === "memorial" ? "Gerando…" : "Baixar"}</button>
          </div>
          <div className="lot-item">
            <div><b>Planilhas de dimensionamento e quantitativos<Dica>Água, esgoto e drenagem trecho a trecho (colunas dos modelos das concessionárias), transformadores e postes com coordenadas UTM, e a lista de materiais para o orçamento — abre no Excel.</Dica></b><span>ZIP com 5 planilhas</span></div>
            <button disabled={!!ocupado} onClick={planilhas}>{ocupado === "planilhas" ? "Gerando…" : "Baixar"}</button>
          </div>
          <div className="lot-item">
            <div><b>Redes em CAD (DXF)<Dica>Uma camada por rede e por tipo de peça (tubos, PVs, bocas de lobo, postes, média e baixa tensão, textos), em UTM.</Dica></b></div>
            <button disabled={!!ocupado} onClick={dxf}>{ocupado === "dxf" ? "Gerando…" : "Baixar"}</button>
          </div>
        </div>
      </div>
    </section>
  );
}
