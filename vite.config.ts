import { defineConfig } from "vite";
import type { Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

// Identidade do build: o sistema aberto compara a sua (__VERSAO__) com a de
// /app/versao.json e oferece "Atualizar" quando o servidor tem outra (lib/versao.ts).
// Na Vercel nem sempre há .git: usa VERCEL_GIT_COMMIT_SHA; senão o git; senão só a hora.
function idDoBuild(): string {
  const agora = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const carimbo = `${agora.getUTCFullYear()}${p(agora.getUTCMonth() + 1)}${p(agora.getUTCDate())}${p(agora.getUTCHours())}${p(agora.getUTCMinutes())}${p(agora.getUTCSeconds())}`;
  let commit = (process.env.VERCEL_GIT_COMMIT_SHA ?? "").slice(0, 7);
  if (!commit) {
    try { commit = execSync("git rev-parse --short=7 HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { /* sem git */ }
  }
  return commit ? `${commit}-${carimbo}` : carimbo;
}

/** Versão do app Android publicado (mesmo arquivo que o Gradle lê). */
function versaoAndroid(): { versionCode: number; versionName: string; minimo: number } | null {
  try {
    const v = JSON.parse(readFileSync(resolve(__dirname, "android/versao.json"), "utf8"));
    return { versionCode: Number(v.versionCode), versionName: String(v.versionName), minimo: Number(v.minimo ?? v.versionCode) };
  } catch { return null; }
}

/** Escreve dist/app/versao.json (só no build; no dev o aviso fica desligado). */
function arquivoDeVersao(versao: string): Plugin {
  return {
    name: "vertces-versao",
    apply: "build",
    generateBundle() {
      const android = versaoAndroid();
      this.emitFile({
        type: "asset",
        fileName: "app/versao.json",
        source: JSON.stringify({
          versao,
          gerado: new Date().toISOString(),
          android: android && { ...android, url: `/baixar/vertces.apk?v=${android.versionCode}` },
        }, null, 2) + "\n",
      });
    },
  };
}

// Duas entradas: a página pública (/) e o sistema (/app/). O sistema usa rota
// por hash, então só /app/ precisa existir no servidor.
export default defineConfig(({ command }) => {
  const versao = command === "build" ? idDoBuild() : "dev";
  return {
    plugins: [react(), arquivoDeVersao(versao)],
    define: {
      __VERSAO__: JSON.stringify(versao),
    },
    build: {
      rollupOptions: {
        input: {
          site: resolve(__dirname, "index.html"),
          app: resolve(__dirname, "app/index.html"),
        },
      },
    },
  };
});
