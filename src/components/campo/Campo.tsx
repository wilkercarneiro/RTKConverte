// Medir no campo: esboço da fundação. A implementação segue
// docs/plano-ferramentas-campo-consulta-terraplanagem.md.
import type { Rota } from "../../lib/rota";

export function Campo({ ir }: { ir: (r: Rota) => void }) {
  void ir;
  return <div className="pagina"><h1>Medir no campo</h1></div>;
}
