// Casca do sistema em volta dos laboratórios de serviço (#/lab/loteamento,
// #/lab/car, #/lab/divisao): trilho lateral e a página com a mesma altura do
// sistema de verdade — a rolagem e o encaixe na tela só aparecem com ela.
// "sem-casca" na URL tira (a tela pura, como era). A faixa do GPROL (empresa
// conectada, como a D'Prol) vem junto; "sem-gprol" tira.
import type { ReactNode } from "react";
import { AppShell } from "./AppShell";
import "./gprol/gprol.css";

export function CascaLab({ children }: { children: ReactNode }) {
  if (location.hash.includes("sem-casca")) return <>{children}</>;
  return (
    <AppShell rota={{ t: "servico", id: "lab" }} ir={() => {}} usuario={{ nome: "Laboratório", papel: "Dono" }}>
      {!location.hash.includes("sem-gprol") && (
        <div className="gp-faixa gp-servico gp-discreta">
          <span className="gp-marca">GPROL</span>
          <span className="gp-texto">Vai para o GPROL ao gerar os primeiros documentos.</span>
          <button className="link">Já existe lá? Ligar a um serviço do GPROL</button>
        </div>
      )}
      {children}
    </AppShell>
  );
}
