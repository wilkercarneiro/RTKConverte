// Ícone de traço único (1.8px), no padrão do protótipo Vértice.
// O `d` é o path SVG em viewBox 24×24 — os das modalidades vivem em
// src/lib/modalidades.ts, ao lado do resto da definição de cada serviço.
export function Icone({ d, size = 20, traco = 1.8, className }: {
  d: string; size?: number; traco?: number; className?: string;
}) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={traco} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

/** Paths reaproveitados por mais de uma tela. */
export const ICONE = {
  busca: "M11 11m-7 0a7 7 0 1 0 14 0a7 7 0 1 0-14 0M20 20l-3.5-3.5",
  upload: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12",
  download: "M12 3v12M7 10l5 5 5-5M4 21h16",
  retomar: "M21 12a9 9 0 1 1-3-6.7M21 3v6h-6",
  relogio: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 8v4l3 2",
  seta: "m9 6 6 6-6 6",
  arquivo: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6",
  imagem: "M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM21 15l-5-5L5 21",
};
