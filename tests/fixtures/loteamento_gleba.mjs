// Gleba sintética de ~9,6 ha para os testes do loteamento (fuso 24S, Bahia).
// Lado 0 (ponto 1 → 2) é a estrada de acesso; tem um dente no lado norte para
// a divisão ter de lidar com quadra côncava.
const E0 = 491000, N0 = 8738800;
const rel = [[0, 0], [372, 18], [395, 140], [360, 268], [210, 290], [175, 230], [60, 262], [-12, 120]];
export const perimetro = {
  pts: rel.map(([e, n]) => [E0 + e, N0 + n]),
  altitudes: rel.map((_, i) => 318 + i * 0.7),
  confrontantes: ["ESTRADA MUNICIPAL BA-001", "JOSÉ DOS SANTOS", "JOSÉ DOS SANTOS", "MARIA APARECIDA LIMA", "MARIA APARECIDA LIMA", "MARIA APARECIDA LIMA", "ANTÔNIO PEREIRA", "ANTÔNIO PEREIRA"],
};
export const txt = rel.map(([e, n], i) =>
  `${i + 1};${(E0 + e).toFixed(3).replace(".", ",")};${(N0 + n).toFixed(3).replace(".", ",")};${(318 + i * 0.7).toFixed(3).replace(".", ",")};0,003000;0,005000`).join("\n");
