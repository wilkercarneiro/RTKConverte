// Refaz o APK do app Android (TWA) e o publica em public/baixar/vertces.apk.
//
//   node scripts/android-build.mjs                 compila, assina, confere e copia
//   node scripts/android-build.mjs --gerar-chave   cria a chave (só na primeira vez)
//
// Antes de gerar uma versão nova, suba "versionCode" (e "versionName") em
// android/versao.json — o site lê o mesmo arquivo para avisar quem está com o
// app velho. Detalhes em android/LEIAME.md.
//
// Chave de assinatura: %USERPROFILE%\.vertces-android\ (vertces.keystore +
// senhas.txt). NUNCA no repositório. Perder a chave = não dá mais para
// atualizar o app instalado (o Android recusa APK com assinatura diferente).
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ANDROID = join(RAIZ, "android");
const WIN = process.platform === "win32";
const JAVA_HOME = process.env.JAVA_HOME_VERTCES || process.env.JAVA_HOME || "C:\\Program Files\\Android\\Android Studio\\jbr";
const SDK = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || join(process.env.LOCALAPPDATA ?? homedir(), "Android", "Sdk");
const CHAVES = process.env.VERTCES_ANDROID_CHAVES || join(homedir(), ".vertces-android");
const KEYSTORE = join(CHAVES, "vertces.keystore");
const SENHAS = join(CHAVES, "senhas.txt");
const ALIAS = "vertces";
const APK_GERADO = join(ANDROID, "app", "build", "outputs", "apk", "release", "app-release.apk");
const APK_PUBLICO = join(RAIZ, "public", "baixar", "vertces.apk");
const ASSETLINKS = join(RAIZ, "public", ".well-known", "assetlinks.json");
const PACOTE = "br.com.vertces.app";

const exe = (nome) => (WIN ? `${nome}.exe` : nome);
const keytool = join(JAVA_HOME, "bin", exe("keytool"));
const pastaBuildTools = () => {
  const dir = join(SDK, "build-tools");
  const v = readdirSync(dir).filter((n) => /^\d/.test(n)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (!v.length) throw new Error(`Nenhum build-tools em ${dir}`);
  return join(dir, v[v.length - 1]);
};

function rodar(cmd, args, { silencioso = false, ...op } = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", env: { ...process.env, JAVA_HOME, ANDROID_HOME: SDK }, ...op });
  if (r.error) throw r.error;
  if (r.status !== 0) {
    if (!silencioso) process.stderr.write((r.stdout ?? "") + (r.stderr ?? ""));
    throw new Error(`${cmd} saiu com ${r.status}`);
  }
  return r.stdout ?? "";
}

function lerSenhas() {
  const p = {};
  for (const l of readFileSync(SENHAS, "utf8").split(/\r?\n/)) {
    const m = /^\s*([\w.]+)\s*=\s*(.*)$/.exec(l);
    if (m) p[m[1]] = m[2].trim();
  }
  return p;
}

function gerarChave() {
  if (existsSync(KEYSTORE)) { console.log(`Chave já existe em ${KEYSTORE} — nada a fazer.`); return; }
  mkdirSync(CHAVES, { recursive: true });
  // PKCS12: a senha da chave é a mesma do arquivo
  const senha = randomBytes(24).toString("base64url");
  rodar(keytool, ["-genkeypair", "-keystore", KEYSTORE, "-storetype", "PKCS12", "-alias", ALIAS,
    "-keyalg", "RSA", "-keysize", "2048", "-validity", "10000",
    "-storepass", senha, "-keypass", senha,
    "-dname", "CN=Vertces, OU=Vertces, O=Vertces, C=BR"], { silencioso: true });
  writeFileSync(SENHAS, [
    "# Senhas da chave de assinatura do app Android do Vertces.",
    "# GUARDE ESTA PASTA (keystore + este arquivo) em lugar seguro, com cópia.",
    "# Sem ela não dá para publicar atualização do app já instalado.",
    "storeFile=vertces.keystore",
    `storePassword=${senha}`,
    `keyAlias=${ALIAS}`,
    `keyPassword=${senha}`,
    "",
  ].join("\n"));
  console.log(`Chave criada em ${KEYSTORE} (senhas em ${SENHAS}).`);
}

function sha256DaChave() {
  const s = lerSenhas();
  const out = rodar(keytool, ["-list", "-v", "-keystore", KEYSTORE, "-alias", s.keyAlias ?? ALIAS, "-storepass", s.storePassword], { silencioso: true });
  const m = /SHA256:\s*([0-9A-F:]{95})/i.exec(out);
  if (!m) throw new Error("Não achei o SHA-256 da chave na saída do keytool.");
  return m[1].toUpperCase();
}

function main() {
  if (process.argv.includes("--gerar-chave")) gerarChave();
  if (!existsSync(KEYSTORE) || !existsSync(SENHAS)) {
    throw new Error(`Sem chave em ${CHAVES}. Rode com --gerar-chave (só na primeira vez) ou copie a pasta da chave para lá.`);
  }
  if (!existsSync(join(ANDROID, "local.properties"))) {
    writeFileSync(join(ANDROID, "local.properties"), `sdk.dir=${SDK.replace(/\\/g, "/")}\n`);
  }

  const versao = JSON.parse(readFileSync(join(ANDROID, "versao.json"), "utf8"));
  console.log(`Compilando o app ${versao.versionName} (versionCode ${versao.versionCode})…`);
  if (WIN) rodar("cmd.exe", ["/d", "/c", join(ANDROID, "gradlew.bat"), "--no-daemon", "assembleRelease"], { cwd: ANDROID, stdio: "inherit" });
  else rodar("./gradlew", ["--no-daemon", "assembleRelease"], { cwd: ANDROID, stdio: "inherit" });

  const bt = pastaBuildTools();
  const apksigner = join(bt, WIN ? "apksigner.bat" : "apksigner");
  const aapt = join(bt, exe("aapt"));
  const verif = WIN
    ? rodar("cmd.exe", ["/d", "/c", apksigner, "verify", "--verbose", "--print-certs", APK_GERADO])
    : rodar(apksigner, ["verify", "--verbose", "--print-certs", APK_GERADO]);
  console.log(verif.split(/\r?\n/).filter((l) => /Verifies|Verified using|SHA-256|DN:/.test(l)).join("\n"));
  const badging = rodar(aapt, ["dump", "badging", APK_GERADO]);
  console.log(badging.split(/\r?\n/).filter((l) => /^(package|sdkVersion|targetSdkVersion|application-label):/.test(l)).join("\n"));
  if (!badging.includes(`name='${PACOTE}'`) || !badging.includes(`versionCode='${versao.versionCode}'`)) {
    throw new Error("O APK não tem o pacote/versionCode esperado.");
  }

  mkdirSync(dirname(APK_PUBLICO), { recursive: true });
  copyFileSync(APK_GERADO, APK_PUBLICO);
  console.log(`APK copiado para ${APK_PUBLICO}`);

  // Digital Asset Links: o SHA-256 da chave que assinou (sem ele o Chrome mostra a barra de endereço)
  const sha = sha256DaChave();
  let lista = [];
  try { lista = JSON.parse(readFileSync(ASSETLINKS, "utf8")); } catch { /* arquivo novo */ }
  const alvo = lista.find((e) => e?.target?.package_name === PACOTE);
  if (alvo) {
    const shas = new Set(alvo.target.sha256_cert_fingerprints ?? []);
    shas.add(sha);
    alvo.target.sha256_cert_fingerprints = [...shas];
  } else {
    lista.push({
      relation: ["delegate_permission/common.handle_all_urls"],
      target: { namespace: "android_app", package_name: PACOTE, sha256_cert_fingerprints: [sha] },
    });
  }
  mkdirSync(dirname(ASSETLINKS), { recursive: true });
  writeFileSync(ASSETLINKS, JSON.stringify(lista, null, 2) + "\n");
  console.log(`assetlinks.json com o SHA-256 ${sha}`);
}

try { main(); } catch (e) { console.error(`\nFalhou: ${e.message}`); process.exit(1); }
