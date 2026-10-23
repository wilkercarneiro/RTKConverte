// Laboratório local do loteamento (só no `npm run dev`, rota #/lab/loteamento):
// a tela inteira com uma gleba sintética de ~9,6 ha, sem login e sem banco —
// o projeto fica no navegador. Serve para desenvolver e validar a prancheta
// sem criar serviço de mentira em produção.
import type { Servico, Vertice } from "../../lib/types";
import type { Projeto } from "../../lib/loteamento/modelo.ts";
import { Loteamento } from "./Loteamento";

const E0 = 491000, N0 = 8738800;
const REL: [number, number][] = [[0, 0], [372, 18], [395, 140], [360, 268], [210, 290], [175, 230], [60, 262], [-12, 120]];
const CONF = ["ESTRADA MUNICIPAL BA-001", "JOSÉ DOS SANTOS", "JOSÉ DOS SANTOS", "MARIA APARECIDA LIMA", "MARIA APARECIDA LIMA", "MARIA APARECIDA LIMA", "ANTÔNIO PEREIRA", "ANTÔNIO PEREIRA"];

const servico = {
  id: "lab-loteamento", tipo: "geo", modalidade: "loteamento", tem_glebas: false, status: "rascunho",
  nome_arquivo_txt: "GLEBA-DEMO.txt", fuso_utm: 24, denominacao: "RESIDENCIAL BOA VISTA", municipio: "Vitória da Conquista", uf: "BA",
  detentor_nome: "JOÃO DA SILVA", detentor_cpf: "000.000.000-00", matricula: "12.345", trt: null, rt_id: null,
} as unknown as Servico;

const vertices: Vertice[] = REL.map(([e, n], i) => ({
  servico_id: servico.id, ordem: i, num_txt: i + 1, rotulo_txt: null, e: E0 + e, n: N0 + n, h: 318 + i * 0.7,
  sigma_pos: 0.003, sigma_h: 0.005, tipo: "M", codigo: `M-${String(i + 1).padStart(2, "0")}`, metodo: "PG1", inserido_manual: false,
  lat_gms: "", lon_gms: "", descritivo: CONF[i], tipo_limite: null, eh_via: i === 0, cns: null, matricula: null, apelido_txt: null,
  numerado: false, exibir_planta: true,
}));

const CHAVE = "vertice.lab.loteamento";

export function Laboratorio() {
  return (
    <Loteamento servico={servico} vertices={vertices} onVoltar={() => { location.hash = "#/"; }}
      armazenamento={{
        carregar: async () => { try { return JSON.parse(localStorage.getItem(CHAVE) ?? "null") as Partial<Projeto> | null; } catch { return null; } },
        salvar: async (_id, p) => { try { localStorage.setItem(CHAVE, JSON.stringify(p)); } catch { /* sem armazenamento */ } },
      }} />
  );
}
