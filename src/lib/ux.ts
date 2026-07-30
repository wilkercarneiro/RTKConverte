// Infraestrutura de experiência: autossalvamento, avisos flutuantes e as
// inferências que alimentam as sugestões preditivas das telas.
//
// Princípio: o operador nunca deve perder trabalho por esquecer de salvar, nem
// precisar informar algo que o sistema já consegue deduzir do próprio acervo.
import { useCallback, useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Autossalvamento
// ---------------------------------------------------------------------------

export type EstadoSalvamento = "ocioso" | "salvando" | "salvo" | "erro";

export interface Autosave {
  estado: EstadoSalvamento;
  /** hora do último sucesso, já formatada para exibição */
  horaSalvo: string | null;
  /** força a gravação imediata do valor corrente (ex.: antes de sair da tela) */
  agora: () => Promise<void>;
}

/**
 * Grava `valor` sempre que ele muda e o usuário para de digitar por `atraso`.
 *
 * `ativo: false` suspende a gravação sem perder a alteração: o valor pendente
 * é gravado quando a tela reativa. É assim que evitamos que um autossave entre
 * no meio de uma geração de documentos ou da correção de sobreposição — essas
 * rotinas gravam e releem o serviço, e uma escrita concorrente sobrescreveria
 * o resultado que acabou de voltar do servidor.
 */
export function useAutosave<T>(
  valor: T,
  salvar: (v: T) => Promise<void>,
  { ativo, atraso = 1200 }: { ativo: boolean; atraso?: number },
): Autosave {
  const [estado, setEstado] = useState<EstadoSalvamento>("ocioso");
  const [horaSalvo, setHoraSalvo] = useState<string | null>(null);
  // refs para que trocar a função de gravação (recriada a cada render) não
  // dispare o efeito nem reinicie o debounce
  const fnSalvar = useRef(salvar);
  fnSalvar.current = salvar;
  const valorAtual = useRef(valor);
  valorAtual.current = valor;
  const gravado = useRef<string | null>(null);

  const executar = useCallback(async () => {
    const serial = JSON.stringify(valorAtual.current);
    if (serial === gravado.current) return;
    setEstado("salvando");
    try {
      await fnSalvar.current(valorAtual.current);
      gravado.current = serial;
      setEstado("salvo");
      setHoraSalvo(new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }));
    } catch {
      // silencioso de propósito: o indicador vira "não salvo" e o botão de
      // salvar manual continua disponível. Um toast a cada tecla seria pior.
      setEstado("erro");
    }
  }, []);

  useEffect(() => {
    const serial = JSON.stringify(valor);
    // primeira passada: registra o estado que veio do banco como já gravado
    if (gravado.current === null) { gravado.current = serial; return; }
    if (serial === gravado.current || !ativo) return;
    const t = setTimeout(executar, atraso);
    return () => clearTimeout(t);
  }, [valor, ativo, atraso, executar]);

  return { estado, horaSalvo, agora: executar };
}

// ---------------------------------------------------------------------------
// Avisos flutuantes
// ---------------------------------------------------------------------------

export interface AvisoItem {
  id: number;
  tom: "ok" | "erro" | "alerta";
  texto: string;
}

let seqAviso = 0;

export function useAvisos(duracao = 6000) {
  const [avisos, setAvisos] = useState<AvisoItem[]>([]);

  const fechar = useCallback((id: number) => {
    setAvisos((as) => as.filter((a) => a.id !== id));
  }, []);

  const avisar = useCallback((tom: AvisoItem["tom"], texto: string) => {
    const id = ++seqAviso;
    setAvisos((as) => [...as, { id, tom, texto }]);
    // erro não desaparece sozinho: quem precisa ler um erro costuma precisar
    // de mais tempo do que o toast dá
    if (tom !== "erro") setTimeout(() => fechar(id), duracao);
  }, [duracao, fechar]);

  return { avisos, avisar, fechar };
}

// ---------------------------------------------------------------------------
// Inferências preditivas
// ---------------------------------------------------------------------------

/** Quantos campos de um grupo já têm conteúdo — alimenta o selo das seções. */
export function contarPreenchidos(valores: (string | number | boolean | null | undefined)[]): number {
  return valores.filter((v) => v !== null && v !== undefined && v !== "" && v !== false).length;
}

/**
 * UF provável para um município, aprendida dos serviços já cadastrados.
 * Município é digitado à mão e a UF é obrigatória: se a dupla já apareceu
 * antes, não há motivo para perguntar de novo.
 */
export function inferirUf(municipio: string | null, acervo: { municipio: string | null; uf: string | null }[]): string | null {
  if (!municipio?.trim()) return null;
  const alvo = municipio.trim().toLowerCase();
  const achado = acervo.find((s) => s.municipio?.trim().toLowerCase() === alvo && s.uf);
  return achado?.uf ?? null;
}

/** Lê o rascunho de preferência local (última UF usada, etc.). */
export function lembrar(chave: string): string | null {
  try { return localStorage.getItem(`rtk:${chave}`); } catch { return null; }
}

export function guardar(chave: string, valor: string | null): void {
  try {
    if (valor) localStorage.setItem(`rtk:${chave}`, valor);
    else localStorage.removeItem(`rtk:${chave}`);
  } catch { /* modo privado / storage cheio: preferência é opcional */ }
}
