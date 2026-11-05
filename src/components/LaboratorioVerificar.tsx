// Laboratório (só no servidor de desenvolvimento): a página pública de
// verificação com dados de exemplo, sem banco.
//   #/lab/verificar          documento autêntico
//   #/lab/verificar/antigo   autêntico, mas com emissão mais nova
//   #/lab/verificar/nao      código não encontrado
//   #/lab/verificar/rts      Configurações → Responsáveis (o teste intercepta o banco)
import { VerificarDocumento } from "./VerificarDocumento";
import type { RegistroVerificado } from "./VerificarDocumento";
import { CadastroRTs } from "./Cadastros";

const EXEMPLO: RegistroVerificado = {
  codigo: "7K3M9QXW2ZR4TNBV8C6H",
  tipo: "planta_sigef",
  titulo: "Planta do imóvel (SIGEF)",
  denominacao: "FAZENDA TERRA NOVA",
  municipio: "ARACI",
  uf: "BA",
  area_ha: "84,0638",
  perimetro_m: "4.077,80",
  folha: "A1",
  empresa: "GEO TOPOGRAFIA LTDA",
  rt_nome: "JOSÉ DA SILVA",
  rt_registro: "CFTA 0578839458-9",
  emitido_em: "2026-11-05T14:32:00-03:00",
  hash_sha256: "3f9a1c0e5b7d2a4f8e6c1b9d0a2e4f6c8b1d3e5f7a9c0b2d4e6f8a1c3e5b7d9f",
  versao_mais_nova_em: null,
};

export function LaboratorioVerificar() {
  const caso = location.hash.replace(/^#\/lab\/verificar\/?/, "");
  if (caso === "rts") {
    return <div className="pagina" style={{ maxWidth: 1100, margin: "0 auto" }}><CadastroRTs escritorioId="e0000000-0000-0000-0000-0000000000e1" /></div>;
  }
  const r = caso === "antigo" ? { ...EXEMPLO, versao_mais_nova_em: "2026-11-06T09:10:00-03:00" } : EXEMPLO;
  return <VerificarDocumento codigo={caso === "nao" ? "AAAABBBBCCCCDDDDEEEE" : r.codigo}
    consultar={async (c) => (c === r.codigo ? r : null)} />;
}
