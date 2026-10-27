// Laboratório da divisão em partes iguais (só no `npm run dev`, rota #/lab/divisao):
// a etapa Divisão da Conferência sobre o anel real da FAZENDA SALGADA VELHA
// (fixture dos testes), sem login e sem banco. Aplicada a divisão, gera no
// navegador a planta A1 do imóvel inteiro e a de uma parte pelo MESMO caminho de
// gerar-documentos (montarServico → calcularGleba → dadosDasPartes → planta).
import { useState } from "react";
import proj4 from "proj4";
import type { Gleba, Servico, Vertice } from "../lib/types";
import { DivisaoEditor } from "./DivisaoEditor";
import { abrirPlanta } from "./planta/VisualizadorPlanta";
import { servicoDaParte, verticesDaParte } from "../lib/divisao_servico";
import { montarServico } from "../../supabase/functions/_shared/servico.ts";
import { calcularGleba, dadosDasPartes, geometriaDoCalculo, servicoDaGleba } from "../../supabase/functions/_shared/planta_dados.ts";
import { gerarPlantaPdf } from "../../supabase/functions/_shared/planta.ts";
// @ts-expect-error fixture em JS dos testes, sem declaração de tipos
import { ANEL, dadosPlantaDe } from "../../tests/fixtures/salgada_velha.mjs";

const SID = "lab-divisao";
const VIZINHOS = ["", "", "", "", "FAZENDA BOA ESPERANÇA\\JOSÉ PEREIRA\\CPF:000.000.001-00", "", "", "", "", "", "", "", "", "", "", "SÍTIO SÃO JOSÉ\\MARIA LIMA\\CPF:000.000.002-00"];
const servicoInicial = {
  id: SID, tipo: "geo", modalidade: "completo", tem_glebas: true, divisao: { iguais: true },
  denominacao: "FAZENDA SALGADA VELHA", detentor_nome: "ESPÓLIO DE JOSÉ DE SOUZA", detentor_cpf: "111.111.111-11",
  matricula: "1.234", cns: "00.810-2", tipo_imovel: "matricula", fuso_utm: 24, municipio: "ARACI", uf: "BA",
} as unknown as Servico;
const verticesIniciais: Vertice[] = (ANEL as [number, number, number, "M" | "P", string, string, string | null][]).map(([ordem, e, n, tipo, , descritivo, tl]) => ({
  id: `v${ordem}`, servico_id: SID, ordem, num_txt: ordem + 1, rotulo_txt: null, e, n, h: 360, sigma_pos: 0.01, sigma_h: 0.01,
  tipo, codigo: null, codigo_provisorio: false, metodo: "PG6", inserido_manual: false, lat_gms: "", lon_gms: "",
  descritivo: tipo === "M" ? (descritivo || VIZINHOS[ordem] || `FAZENDA VIZINHA ${ordem}\\VIZINHO ${ordem}`) : null,
  tipo_limite: tipo === "M" ? (tl ?? "LA1") : null, eh_via: tl === "LA3", cns: null, matricula: null, apelido_txt: null,
  // o código da fixture fica fora: a geração aloca de novo, como num serviço novo
  numerado: false, exibir_planta: true,
}));

function calcular(vs: Vertice[]) {
  const p4 = (f: string, t: string, c: [number, number]) => proj4(f, t, c);
  return montarServico({
    fusoUtm: 24, prefixo: "DSBN", contadores: { M: 5000, P: 20000, V: 0 },
    vertices: vs.map((v) => ({
      ordem: v.ordem, numTxt: v.num_txt, e: v.e, n: v.n, latGmsStr: null, lonGmsStr: null, h: v.h, sigmaPos: v.sigma_pos, sigmaH: v.sigma_h,
      tipo: v.tipo, metodo: v.metodo, codigoManual: v.codigo, inserido: false, descritivo: v.descritivo || "", tipoLimite: v.tipo_limite,
      ehVia: v.eh_via, cns: null, matricula: null, numerado: false, exibirPlanta: true,
    })),
  }, p4);
}

export function LaboratorioDivisao() {
  const [vertices, setVertices] = useState<Vertice[]>(verticesIniciais);
  const [glebas, setGlebas] = useState<Gleba[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [resumo, setResumo] = useState<string | null>(null);

  async function plantaTotal() {
    setErro(null);
    try {
      const p4 = (f: string, t: string, c: [number, number]) => proj4(f, t, c);
      const calc = calcular(vertices);
      const base = { fusoUtm: 24, prefixo: "DSBN" };
      const unidades = glebas.map((g) => ({ nome: g.nome, calc: calcularGleba(g, glebas, calc, servicoInicial, base, p4).calc }));
      setResumo(unidades.map((u) => `${u.nome}: ${u.calc.areaHa.toFixed(4).replace(".", ",")} ha`).join(" · "));
      const dp = dadosDasPartes(unidades, servicoInicial, glebas);
      const bytes = await gerarPlantaPdf(dadosPlantaDe(dp.geometria, { partes: dp.partes, glebas: dp.glebas, folha: "A1", denominacao: servicoInicial.denominacao, proprietarios: [{ nome: servicoInicial.detentor_nome, cpf: servicoInicial.detentor_cpf }] }), undefined, { editavel: true });
      abrirPlanta({ bytes, nome: "Planta A1 - partilha (laboratório)", titulo: "Planta A1 · imóvel inteiro com as partes (laboratório)" });
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)); }
  }
  async function plantaDaParte(k: number) {
    setErro(null);
    try {
      // o GEO individual: códigos do total + vértices da parte, como o "Criar os GEOs" faz
      const calc = calcular(vertices);
      const codigoDe = new Map(calc.ring.map((v) => [v.conf.ordem, v.codigo]));
      const comCodigo = vertices.map((v) => ({ ...v, codigo: codigoDe.get(v.ordem) ?? null }));
      const vp = verticesDaParte(servicoInicial, comCodigo, glebas, k, "parte");
      const cab = servicoDaParte(servicoInicial, glebas[k]);
      const calcP = calcular(vp);
      const g = geometriaDoCalculo(calcP);
      const s = servicoDaGleba(servicoInicial, glebas[k], glebas[k].nome);
      const bytes = await gerarPlantaPdf(dadosPlantaDe(g, {
        folha: "A1", denominacao: cab.denominacao, proprietarios: [{ nome: s.detentor_nome ?? "", cpf: s.detentor_cpf ?? "" }],
      }), undefined, { editavel: true });
      abrirPlanta({ bytes, nome: `Planta - ${cab.denominacao}`, titulo: `GEO individual · ${cab.denominacao} · ${cab.detentor_nome}` });
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)); }
  }

  return (
    <div style={{ padding: "28px 40px", display: "grid", gap: 16, maxWidth: 1280, margin: "0 auto" }}>
      <h2 style={{ margin: 0 }}>Laboratório · divisão em partes iguais</h2>
      <p className="sub" style={{ margin: 0 }}>FAZENDA SALGADA VELHA (fixture) · espólio de José de Souza · estrada vicinal a leste</p>
      <DivisaoEditor servico={servicoInicial} vertices={vertices} glebas={glebas}
        onAplicar={(r) => { setVertices(r.vertices); setGlebas(r.glebas); setResumo(null); }}
        onGlebas={setGlebas} />
      {glebas.length >= 2 && (
        <section className="bloco">
          <header><h3>Documentos (gerados no navegador pelo caminho do servidor)</h3></header>
          <div className="acoes-linha">
            <button className="principal" onClick={plantaTotal}>Planta A1 do imóvel inteiro</button>
            {glebas.map((g, k) => <button key={k} onClick={() => plantaDaParte(k)}>GEO de {g.nome}</button>)}
          </div>
          {resumo && <p className="sub" style={{ margin: 0 }}>Áreas no cálculo dos documentos: {resumo}</p>}
        </section>
      )}
      {erro && <div className="erro">{erro}</div>}
    </div>
  );
}
