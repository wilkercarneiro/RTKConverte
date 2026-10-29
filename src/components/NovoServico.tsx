// "Novo serviço": todas as modalidades numa linha só, com rolagem lateral.
//
// Uma faixa e não uma grade: com 7 modalidades a grade quebrava em várias
// linhas e empurrava "Recentes" para fora da tela. Os cartões saem de SERVICOS
// (só os que o plano libera), então modalidade nova aparece aqui sozinha.
// Setas para quem usa mouse, encaixe por cartão (scroll-snap), roda do mouse
// vira rolagem lateral, e o teclado anda pelos cartões com Tab.
//
// Cartão vertical com uma foto do tipo de trabalho ao fundo (src/assets/servicos,
// fotos do Unsplash, licença livre). Modalidade sem foto cai no fundo verde.
import { useEffect, useRef, useState } from "react";
import { SERVICOS } from "../lib/modalidades";
import type { ChaveServico } from "../lib/modalidades";
import { servicoLiberado } from "../lib/recursos";
import fotoCompleto from "../assets/servicos/completo.jpg";
import fotoConferencia from "../assets/servicos/conferencia.jpg";
import fotoGleba from "../assets/servicos/gleba.jpg";
import fotoDivisao from "../assets/servicos/divisao.jpg";
import fotoLoteamento from "../assets/servicos/loteamento.jpg";
import fotoCar from "../assets/servicos/car.jpg";
import fotoPecas from "../assets/servicos/pecas.jpg";

const FOTOS: Partial<Record<ChaveServico, string>> = {
  completo: fotoCompleto, conferencia: fotoConferencia, gleba: fotoGleba, divisao: fotoDivisao,
  loteamento: fotoLoteamento, car: fotoCar, pecas: fotoPecas,
};

export function NovoServico({ onNovo, compacto = false, titulo = "Novo serviço" }: {
  onNovo: (chave: ChaveServico) => void; compacto?: boolean; titulo?: string;
}) {
  const lista = SERVICOS.filter((s) => servicoLiberado(s.chave));
  const faixa = useRef<HTMLDivElement>(null);
  const [borda, setBorda] = useState({ ini: true, fim: false });

  const medir = () => {
    const el = faixa.current;
    if (!el) return;
    setBorda({ ini: el.scrollLeft < 4, fim: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4 });
  };
  useEffect(() => {
    medir();
    const el = faixa.current;
    if (!el) return;
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    // roda do mouse (vertical) anda na horizontal enquanto houver para onde ir
    const roda = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      const podeIr = e.deltaY > 0 ? el.scrollLeft + el.clientWidth < el.scrollWidth - 2 : el.scrollLeft > 2;
      if (!podeIr) return;
      e.preventDefault();
      el.scrollBy({ left: e.deltaY, behavior: "auto" });
    };
    el.addEventListener("wheel", roda, { passive: false });
    return () => { ro.disconnect(); el.removeEventListener("wheel", roda); };
  }, []);

  const andar = (dir: 1 | -1) => {
    const el = faixa.current;
    if (!el) return;
    const cartao = el.querySelector<HTMLElement>(".ns-cartao");
    el.scrollBy({ left: dir * ((cartao?.offsetWidth ?? 280) + 14) * (compacto ? 2 : 1), behavior: "smooth" });
  };

  if (lista.length === 0) return null;
  return (
    <section className={compacto ? "ns ns-compacto" : "ns"} aria-label={titulo}>
      <div className="ns-cabeca">
        <h2 className="ns-titulo">{titulo}</h2>
        <span className="ns-conta">{lista.length} {lista.length === 1 ? "modalidade" : "modalidades"}</span>
        <div className="ns-setas">
          <button type="button" className="ns-seta" onClick={() => andar(-1)} disabled={borda.ini} aria-label="Modalidades anteriores">‹</button>
          <button type="button" className="ns-seta" onClick={() => andar(1)} disabled={borda.fim} aria-label="Próximas modalidades">›</button>
        </div>
      </div>
      <div className={`ns-moldura${borda.ini ? "" : " sombra-ini"}${borda.fim ? "" : " sombra-fim"}`}>
        <div className="ns-faixa" ref={faixa} onScroll={medir}>
          {lista.map((d) => (
            <button key={d.chave} type="button" className={`ns-cartao mod-${d.chave}`} onClick={() => onNovo(d.chave)}
              title={compacto ? d.resumo : undefined}>
              {FOTOS[d.chave] && <img className="ns-foto" src={FOTOS[d.chave]} alt="" loading="lazy" decoding="async" />}
              <span className="ns-veu" aria-hidden="true" />
              {!compacto && (
                <span className="ns-selo">{d.entrega.length} {d.entrega.length === 1 ? "entrega" : "entregas"}</span>
              )}
              <span className="ns-corpo">
                <b className="ns-nome">{d.titulo}</b>
                {!compacto && <span className="ns-resumo">{d.resumo}</span>}
                {!compacto && (
                  <span className="ns-entrega">
                    {d.entrega.slice(0, 2).map((e) => <span key={e}>{e}</span>)}
                    {d.entrega.length > 2 && <span className="mais">+{d.entrega.length - 2}</span>}
                  </span>
                )}
                <span className="ns-cta">{d.cta}<span aria-hidden="true">→</span></span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
