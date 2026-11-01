// O mapa interativo (MapLibre) e a maquete 3D (three.js) desenham com WebGL.
// Navegador com a aceleração por hardware desligada, placa de vídeo bloqueada
// pelo Chrome ou contexto gráfico perdido NÃO tem WebGL — e o MapLibre, criado
// assim, lança "Failed to initialize WebGL". Sem esta checagem o erro subia
// até o React e apagava a tela inteira (foi o "clico em Confrontantes e
// vértices e nada aparece" de 2026-11-01).

let cache: boolean | null = null;

/** O navegador consegue criar um contexto WebGL agora? (resultado guardado) */
export function webglDisponivel(): boolean {
  if (cache !== null) return cache;
  try {
    const canvas = document.createElement("canvas");
    const gl = (canvas.getContext("webgl2") ?? canvas.getContext("webgl")) as WebGLRenderingContext | null;
    cache = !!gl;
    // devolve o contexto na hora: o navegador limita quantos ficam vivos
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    cache = false;
  }
  return cache;
}

/** Para os testes e para "tentar de novo" depois que o usuário liga a aceleração. */
export function esquecerWebgl(): void {
  cache = null;
}

export const MOTIVO_SEM_WEBGL =
  "Este navegador está sem WebGL (aceleração gráfica), que o mapa interativo e a maquete 3D usam. " +
  "No Chrome: Configurações → Sistema → ligue \"Usar aceleração gráfica quando disponível\" e reinicie o navegador.";
