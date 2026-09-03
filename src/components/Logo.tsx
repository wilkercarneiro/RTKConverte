// Símbolo da marca Vértice: um vértice e seus dois vizinhos.
export function Logo({ className, size }: { className?: string; size?: number }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <path d="M4 22 14 5l10 17" stroke="#7BD3A6" strokeWidth="2.6" strokeLinejoin="round" />
      <circle cx="14" cy="5" r="3" fill="#7BD3A6" />
      <circle cx="4" cy="22" r="2.4" fill="#fff" />
      <circle cx="24" cy="22" r="2.4" fill="#fff" />
    </svg>
  );
}
