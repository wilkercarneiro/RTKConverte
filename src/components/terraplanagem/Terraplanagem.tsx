// Terraplanagem: esboço da fundação. A implementação segue
// docs/plano-ferramentas-campo-consulta-terraplanagem.md.
import type { Rota } from "../../lib/rota";

export function Terraplanagem({ ir }: { ir: (r: Rota) => void }) {
  void ir;
  return <div className="pagina"><h1>Terraplanagem</h1></div>;
}
