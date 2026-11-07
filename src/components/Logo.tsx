// Símbolo da marca Vertces: um vértice e seus dois vizinhos.
// `sobreClaro`: versão para fundo claro (o topo do Início no celular) — traço
// verde-escuro e o vértice de cima no verde da marca.
export function Logo({ className, size, sobreClaro = false }: { className?: string; size?: number; sobreClaro?: boolean }) {
  const traco = sobreClaro ? "#178552" : "#7BD3A6";
  const ponta = sobreClaro ? "#0E3B2B" : "#fff";
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <path d="M4 22 14 5l10 17" stroke={traco} strokeWidth="2.6" strokeLinejoin="round" />
      <circle cx="14" cy="5" r="3" fill={traco} />
      <circle cx="4" cy="22" r="2.4" fill={ponta} />
      <circle cx="24" cy="22" r="2.4" fill={ponta} />
    </svg>
  );
}
