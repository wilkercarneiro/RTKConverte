// Onde fica o prédio de um equipamento da rede (reservatório, estação de esgoto).
// O cálculo hidráulico parte de um nó da rede — que fica no eixo da rua —, mas o
// prédio não pode ficar no meio da rua: vai para o chão livre mais perto (área
// pública, sobra da gleba) ou, se o projeto não deixou nenhum, para o lote mais
// perto, que então tem de ser reservado para o sistema.
import type { Pt } from "../geom.ts";
import { centroide, dentroPol, distAnel } from "../geom.ts";
import type { Resultado } from "../calculo.ts";

export interface Implantacao {
  p: Pt;
  /** id do lote ocupado (null: área pública ou sobra da gleba) */
  lote: string | null;
}

/**
 * Ponto mais perto de `p` onde cabe um prédio de raio `raio` sem encostar na
 * caixa das ruas (com 1 m de folga), dentro da gleba e longe de `evitar`.
 * Prefere o chão sem lote; um lote só entra se não houver chão livre até 60 m.
 */
export function implantarFora(res: Resultado, p: Pt, raio: number, evitar: { p: Pt; r: number }[] = []): Implantacao {
  const ruas = res.ruas.flatMap((r) => r.pols);
  const livreDasRuas = (q: Pt) => ruas.every((pg) => !dentroPol(q, pg) && [pg.ext, ...pg.furos].every((a) => distAnel(q, a) >= raio + 1));
  const naGleba = (q: Pt) => dentroPol(q, res.gleba) && distAnel(q, res.gleba.ext) >= raio + 0.5;
  const longe = (q: Pt) => evitar.every((e) => Math.hypot(q[0] - e.p[0], q[1] - e.p[1]) >= raio + e.r + 1);
  const loteDe = (q: Pt) => res.lotes.find((l) => dentroPol(q, l.pol));
  if (naGleba(p) && livreDasRuas(p) && longe(p) && !loteDe(p)) return { p, lote: null };
  let noLote: Implantacao | null = null;
  const passo = 1.5;
  for (let r = passo; r <= 160; r += passo) {
    const n = Math.max(8, Math.ceil((2 * Math.PI * r) / passo));
    for (let k = 0; k < n; k++) {
      const a = (2 * Math.PI * k) / n;
      const q: Pt = [p[0] + r * Math.cos(a), p[1] + r * Math.sin(a)];
      if (!naGleba(q) || !longe(q) || !livreDasRuas(q)) continue;
      const l = loteDe(q);
      if (!l) return { p: q, lote: null };
      // dentro do lote, inteiro (sem passar da divisa) — no meio dele quando cabe:
      // a torre colada na frente do lote ficava encostada na calçada
      if (!noLote && distAnel(q, l.pol.ext) >= raio + 0.5) {
        const c = centroide(l.pol.ext);
        const meio = dentroPol(c, l.pol) && distAnel(c, l.pol.ext) >= raio + 0.5 && longe(c) && livreDasRuas(c);
        noLote = { p: meio ? c : q, lote: l.id };
      }
    }
    if (noLote && r >= 60) return noLote;
  }
  return noLote ?? { p, lote: null };
}
