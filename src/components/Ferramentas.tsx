// Ferramentas (sem serviço): cartões horizontais com foto, no mesmo padrão dos
// cartões de "Novo serviço" — no Início, logo abaixo das modalidades, e na
// folha "Ferramentas" da barra de baixo do celular.
//
// Fotos do Wikimedia Commons em domínio público (src/assets/ferramentas):
// consulta = "Aerial photo of center pivot irrigations systems (9364)" (USDA);
// campo = "BLM Utah Cadastral Survey Team conducts resurvey…" (BLM, 27706149180);
// terraplanagem = "2026-03-03 Construction of Bolotnaya Embankment footbridge,
// earthworks 41" (CC0).
import type { Rota } from "../lib/rota";
import fotoConsulta from "../assets/ferramentas/consulta.jpg";
import fotoCampo from "../assets/ferramentas/campo.jpg";
import fotoTerraplanagem from "../assets/ferramentas/terraplanagem.jpg";

export type ChaveFerramenta = "consulta" | "campo" | "terraplanagem";

export const FERRAMENTAS: { chave: ChaveFerramenta; titulo: string; resumo: string; cta: string; foto: string; selo: string }[] = [
  {
    chave: "consulta", titulo: "Consultar imóvel", foto: fotoConsulta, selo: "Sem crédito",
    resumo: "CAR, SIGEF, restrições, queimadas, bioma e solo de qualquer lugar — sem abrir serviço.",
    cta: "Consultar",
  },
  {
    chave: "campo", titulo: "Medir no campo", foto: fotoCampo, selo: "GPS do celular",
    resumo: "Marque pontos ou caminhe o perímetro; a medição chega sozinha ao escritório.",
    cta: "Medir",
  },
  {
    chave: "terraplanagem", titulo: "Terraplanagem", foto: fotoTerraplanagem, selo: "Corte e aterro",
    resumo: "Quanto cortar e aterrar para deixar o terreno plano — e quantos caminhões.",
    cta: "Calcular",
  },
];

/** Os três cartões. `titulo` false: sem o cabeçalho da seção (a folha do celular já tem o dela). */
export function FerramentasCartoes({ onAbrir, titulo = true }: { onAbrir: (r: Rota) => void; titulo?: boolean }) {
  return (
    <section className="fe" aria-label="Ferramentas">
      {titulo && (
        <div className="ns-cabeca">
          <h2 className="ns-titulo">Ferramentas</h2>
          <span className="ns-conta">sem abrir serviço</span>
        </div>
      )}
      <div className="fe-grade">
        {FERRAMENTAS.map((f) => (
          <button key={f.chave} type="button" className={`fe-cartao fe-${f.chave}`} onClick={() => onAbrir({ t: f.chave })}>
            <img className="fe-foto" src={f.foto} alt="" loading="lazy" decoding="async" />
            <span className="fe-veu" aria-hidden="true" />
            <span className="fe-corpo">
              <span className="fe-selo">{f.selo}</span>
              <b className="fe-nome">{f.titulo}</b>
              <span className="fe-resumo">{f.resumo}</span>
            </span>
            <span className="fe-cta">{f.cta}<span aria-hidden="true">→</span></span>
          </button>
        ))}
      </div>
    </section>
  );
}
