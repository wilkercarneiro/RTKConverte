// Testes da IA AO VIVO (OpenAI de verdade, com a OPENAI_API_KEY do .env).
// Ficam fora do `npm test` (que é determinístico e não gasta): rode
//   npm run test:ia
// Cada rodada custa menos de US$ 0,01.
import { spawnSync } from "node:child_process";

const r = spawnSync(process.execPath, [
  "--test", "--test-name-pattern=AO VIVO",
  "tests/leitor_ia.test.mjs", "tests/funcoes_ponta_a_ponta.test.mjs",
], { stdio: "inherit", env: { ...process.env, IA_AO_VIVO: "1" } });
process.exit(r.status ?? 1);
