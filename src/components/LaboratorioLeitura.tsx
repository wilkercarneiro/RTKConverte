// Laboratório da etapa "Leitura do arquivo" (só no `npm run dev`):
//   #/lab/leitura/equipe   formato de sempre (THEREZA)
//   #/lab/leitura/emlid    CSV da Emlid com cabeçalho e RMS (reconhecido pelas regras)
//   #/lab/leitura/ia       formato novo interpretado pela IA (receita simulada)
//   #/lab/leitura/cruza    numeração que cruza o desenho (ordem do arquivo)
//   #/lab/leitura/semsigma PNEZD sem precisões (σ declarado na prévia)
//   #/lab/leitura/manual   formato não reconhecido: o operador mapeia as colunas
// A leitura é feita aqui mesmo, pelo leitor de verdade; nada sai do navegador.
import { useMemo, useState } from "react";
import proj4lib from "proj4";
import type { Proj4 } from "../../supabase/functions/_shared/geo.ts";
import { lerLinhas } from "../../supabase/functions/_shared/leitor/index.ts";
import { separarLinhas } from "../../supabase/functions/_shared/leitor/abertura.ts";
import { APOIO_PADRAO, camposVazios } from "../../supabase/functions/_shared/leitor/receita.ts";
import type { Receita } from "../../supabase/functions/_shared/leitor/receita.ts";
import { LeituraArquivo } from "./LeituraArquivo";
import type { LeituraConfirmada, RespostaLeitura } from "./LeituraArquivo";
import { Passos } from "./ui";
import THEREZA from "../../reference/THEREZA.txt?raw";
import LARISSA from "../../reference/LARISSA.txt?raw";

const proj4: Proj4 = (de, para, c) => (proj4lib as unknown as Proj4)(de, para, c);
const base = lerLinhas(separarLinhas(LARISSA), { proj4 })!.anel;

function caso(nome: string): { arquivo: string; linhas: string[]; receita?: Receita; ia?: boolean } {
  switch (nome) {
    case "emlid":
      return { arquivo: "Fazenda_Lagoa_Emlid.csv", linhas: ["Name,Code,Easting,Northing,Elevation,Description,Easting RMS,Northing RMS,Elevation RMS,Antenna height,Solution status",
        ...base.map((p) => `${p.num},${p.rotulo ?? ""},${p.e.toFixed(3)},${p.n.toFixed(3)},${p.h.toFixed(3)},,${p.sigmaPos},${p.sigmaPos},${p.sigmaH},1.800,FIX`)] };
    case "ia": {
      const linhas = ["CO,Projeto Fazenda Boa Vista", "CO,Unidades: metros", ...base.slice(0, 40).flatMap((p) => [`CP,${p.num},${p.n.toFixed(3)},${p.e.toFixed(3)},${p.h.toFixed(3)},MARCO,${p.sigmaPos},${p.sigmaH}`, `SS,${p.num},1.800,0.0000,90.0000,10.000`])];
      const receita: Receita = {
        versao: 1, registro: "linha", pular_inicio: 2, ignorar: ["^SS,"], tokenizacao: "delimitado", delimitador: ",", colunas: 8, excedente_em: null, cortes: null, regex: null,
        decimal: ".", campos: { ...camposVazios(), nome: 1, n: 2, e: 3, h: 4, codigo: 5, sigma_pos: 6, sigma_h: 7 }, sistema: "utm", fuso: null, hemisferio: "S",
        unidade_sigma: "m", confianca_sigma: "1sigma", nome_formato: "texto", ordem: "auto", apoio: [...APOIO_PADRAO], origem: "ia:gpt-6-luna",
        explicacao: "Exportação no estilo Nikon: registros CP trazem ponto, N, E, cota, código e as duas precisões; os registros SS são observações e foram ignorados, assim como os comentários CO do topo.",
      };
      return { arquivo: "levantamento_nikon.raw.txt", linhas, receita, ia: true };
    }
    case "cruza":
      return { arquivo: "EZAU ROCINHA.TXT", linhas: ["110,480317.467,8733797.440,387.499,0.00,0.00", "114,480362.737,8733767.483,385.441,0.00,0.00", "20,480368.349,8733773.423,385.776,0.008500,0.008500", "19,480391.464,8733798.527,387.058,0.009400,0.009400", "115,480387.181,8733835.316,386.997,0.00,0.00", "109,480368.005,8733841.113,387.441,0.00,0.00"] };
    case "semsigma":
      return { arquivo: "pontos_pnezd.csv", linhas: base.map((p) => `${p.num},${p.n.toFixed(3)},${p.e.toFixed(3)},${p.h.toFixed(3)},${p.rotulo ?? ""}`) };
    case "manual":
      return { arquivo: "exportacao_estranha.txt", linhas: ["### LEVANTAMENTO ###", ...base.slice(0, 25).map((p) => `PT=${p.num} | X:${p.e.toFixed(3)} | Y:${p.n.toFixed(3)} | Z:${p.h.toFixed(3)}`)] };
    default:
      return { arquivo: "THEREZA.txt", linhas: separarLinhas(THEREZA) };
  }
}

export function LaboratorioLeitura() {
  const nome = location.hash.split("/")[3] ?? "equipe";
  const c = useMemo(() => caso(nome), [nome]);
  const [confirmada, setConfirmada] = useState<LeituraConfirmada | null>(null);
  const resposta: RespostaLeitura = useMemo(() => {
    const l = c.receita ? null : nome === "manual" ? null : lerLinhas(c.linhas, { proj4 });
    return {
      ok: true, formato: "texto (utf-8)", codificacao: "utf-8", linhas: c.linhas,
      receita: c.receita ?? l?.receita ?? null, confianca: c.ia ? "alta" : l?.confianca ?? "baixa", duvidas: l?.duvidas ?? [],
      perfil: null,
      ia: c.ia
        ? { usada: true, tentativas: [{ modelo: "gpt-6-luna", aprovada: true, ms: 2140, custoUsd: 0.0021 }], custoUsd: 0.0021, erro: null, motivo: null }
        : { usada: false, tentativas: [], custoUsd: 0, erro: null, motivo: nome === "manual" ? "IA desligada neste laboratório" : null },
    };
  }, [c, nome]);
  return (
    <div className="upload-tela fade" style={{ padding: 24 }}>
      <Passos passos={[{ rotulo: "Área certificada", estado: "feita" }, { rotulo: "Arquivo do levantamento", estado: "feita" }, { rotulo: "Leitura do arquivo", estado: "ativa" }, { rotulo: "Conferência", estado: "futura" }, { rotulo: "Documentos", estado: "futura" }]} rotulo="Etapas do novo serviço" />
      <div className="upload-card leitura">
        <div>
          <h2>Georreferenciamento completo</h2>
          <p className="sub">Confira como o arquivo foi lido antes de criar o serviço.</p>
        </div>
        <LeituraArquivo key={nome} nomeArquivo={c.arquivo} resposta={resposta} criando={false} erro={null}
          onConfirmar={setConfirmada} onTrocarArquivo={() => setConfirmada(null)} />
        {confirmada && <pre className="mono pequeno" data-testid="confirmada">{JSON.stringify({ origem: confirmada.receita.origem, ordem: confirmada.ordem, excluir: confirmada.excluir, sigma: confirmada.sigma_padrao, confirmados: confirmada.confirmados }, null, 1)}</pre>}
      </div>
    </div>
  );
}
