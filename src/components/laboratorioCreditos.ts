// Dados de exemplo dos créditos em carteiras e da cobrança (0034) para os
// laboratórios (#/lab/casca, #/lab/sistema): sem banco e sem Asaas. A compra
// "paga sozinha" 8 s depois, para a gaveta mostrar a confirmação.
import { SERVICOS } from "../lib/modalidades";
import type { Creditos } from "../lib/creditos";
import { definirCobrancaFalsa } from "../lib/cobranca";
import type { MinhaCobranca } from "../lib/cobranca";

export interface Cenario {
  /** os créditos de CAR do mês acabaram */
  carEsgotado?: boolean;
  /** os gerais também */
  geralEsgotado?: boolean;
  /** plano Só CAR */
  soCar?: boolean;
  /** Asaas desligado: a compra vira pedido */
  semAsaas?: boolean;
}

export function creditosDeExemplo(o: Cenario = {}): Creditos {
  const geral = o.soCar
    ? { por_mes: 0, usado: 0, extra: 0, precos: [] }
    : { por_mes: 6, usado: o.geralEsgotado ? 6 : 2, extra: o.geralEsgotado ? 0 : 1, precos: [{ a_partir_de: 2, preco: 70 }] };
  const car = o.soCar
    ? { por_mes: 5, usado: o.carEsgotado ? 5 : 3, extra: 0, precos: [{ a_partir_de: 2, preco: 19.9 }, { a_partir_de: 10, preco: 15 }, { a_partir_de: 51, preco: 10 }] }
    : { por_mes: 12, usado: o.carEsgotado ? 12 : 7, extra: 0, precos: [{ a_partir_de: 2, preco: 9.9 }] };
  const temGeral = geral.por_mes - geral.usado + geral.extra > 0;
  const temCar = car.por_mes - car.usado + car.extra > 0;
  return {
    periodo: { inicio: "2026-10-25", renova_em: "2026-11-25", dia: 25 },
    carteiras: [
      { chave: "geral", nome: "Créditos gerais", descricao: "Valem para qualquer serviço. No CAR, só com o seu aceite.", servicos: null, ...geral },
      { chave: "car", nome: "Créditos de CAR", descricao: "Valem só para o CAR.", servicos: ["servico.car"], ...car },
    ],
    servicos: Object.fromEntries(SERVICOS.map((s) => {
      const k = `servico.${s.chave}`;
      if (s.chave === "car") return [k, { disponivel: temCar || temGeral, carteira: temCar ? "car" : temGeral ? "geral" : null, precisa_aceite: !temCar && temGeral }];
      return [k, { disponivel: temGeral, carteira: temGeral ? "geral" : null, precisa_aceite: false }];
    })),
    sou_dono: true,
    pagamento_online: !o.semAsaas,
    compras: [
      { id: "x1", tipo: "car", quantidade: 10, valor: 99, unitario: 9.9, descricao: "10 créditos de CAR", status: "aprovado", origem: "compra",
        created_at: "2026-10-12T12:00:00Z", link: null, pagamento: "RECEIVED" },
      { id: "x2", tipo: "geral", quantidade: 3, valor: null, unitario: null, descricao: "Cortesia de lançamento", status: "aprovado", origem: "manual",
        created_at: "2026-10-02T12:00:00Z", link: null, pagamento: null },
    ],
  };
}

export const cobrancaDeExemplo = (situacao: MinhaCobranca["situacao"], status = "ativo"): MinhaCobranca => ({
  status, empresa: "D'Prol Georreferenciamento", plano: "Profissional", valor: 249.9, situacao,
  link: "https://sandbox.asaas.com/i/exemplo", vencimento: situacao === "em_dia" ? "2026-11-25" : "2026-10-25", sou_dono: true,
});

/** Um QR com cara de QR (módulos e os três quadrados), em PNG base64. */
export function qrDeExemplo(): string {
  const n = 29, m = 8;
  const c = document.createElement("canvas");
  c.width = c.height = (n + 4) * m;
  const g = c.getContext("2d")!;
  g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = "#111";
  let s = 7;
  const aleatorio = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  const olho = (x: number, y: number) => (x < 8 && y < 8) || (x > n - 9 && y < 8) || (x < 8 && y > n - 9);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (!olho(x, y) && aleatorio() > 0.52) g.fillRect((x + 2) * m, (y + 2) * m, m, m);
  for (const [x, y] of [[0, 0], [n - 7, 0], [0, n - 7]]) {
    g.fillRect((x + 2) * m, (y + 2) * m, 7 * m, 7 * m);
    g.fillStyle = "#fff"; g.fillRect((x + 3) * m, (y + 3) * m, 5 * m, 5 * m);
    g.fillStyle = "#111"; g.fillRect((x + 4) * m, (y + 4) * m, 3 * m, 3 * m);
  }
  return c.toDataURL("image/png").replace(/^data:image\/png;base64,/, "");
}

/** Liga a função de cobrança falsa sobre o objeto de créditos do laboratório. */
export function instalarCobrancaFalsa(creditos: Creditos): void {
  definirCobrancaFalsa(async (b) => {
    if (b.acao === "comprar_creditos") {
      const k = creditos.carteiras.find((x) => x.chave === b.tipo)!;
      const n = Number(b.quantidade);
      const unit = [...k.precos].sort((a, c) => c.a_partir_de - a.a_partir_de).find((f) => f.a_partir_de <= n)!.preco;
      const id = `c${Date.now()}`;
      const descricao = `${n} ${k.nome.charAt(0).toLowerCase()}${k.nome.slice(1)}`;
      creditos.compras.unshift({ id, tipo: k.chave, quantidade: n, valor: unit * n, unitario: unit, descricao, status: "pendente", origem: "compra",
        created_at: new Date().toISOString(), link: "https://sandbox.asaas.com/i/exemplo", pagamento: "PENDING" });
      setTimeout(() => {
        const c = creditos.compras.find((x) => x.id === id);
        if (c) { c.status = "aprovado"; c.pagamento = "RECEIVED"; k.extra += n; }
      }, 8000);
      return { credito_id: id, valor: Math.round(unit * n * 100) / 100, descricao, link: "https://sandbox.asaas.com/i/exemplo",
        pix: { encodedImage: qrDeExemplo(), payload: "00020101021226820014br.gov.bcb.pix2560qrpix.asaas.com/qr/cobv/exemplo5204000053039865802BR" } };
    }
    if (b.acao === "pix") return { pix: { encodedImage: qrDeExemplo(), payload: "00020101021226820014br.gov.bcb.pix" }, link: "https://sandbox.asaas.com/i/exemplo" };
    if (b.acao === "conferir") return { conferidos: 1, mudancas: [] };
    if (b.acao === "cancelar_compra") {
      const c = creditos.compras.find((x) => x.id === b.credito_id);
      if (c) c.status = "cancelado";
      return { ok: true };
    }
    return { ok: true };
  });
}
