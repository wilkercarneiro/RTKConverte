// Versão do sistema e do app Android (src/lib/versao.ts): quando o aviso
// "Nova versão" aparece, quando o do APK aparece, e a leitura do aparelho.
import { test } from "node:test";
import assert from "node:assert/strict";
import { appDesatualizado, haNovaVersao, lerOrigem, navegadorIosDe, plataformaDe } from "../src/lib/versao.ts";

const UA = {
  android: "Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",
  iphoneChrome: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.7390.41 Mobile/15E148 Safari/604.1",
  ipad: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15",
  windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
};

test("plataforma pelo navegador (iPad se diz Mac, o toque denuncia)", () => {
  assert.equal(plataformaDe(UA.android), "android");
  assert.equal(plataformaDe(UA.iphone), "ios");
  assert.equal(plataformaDe(UA.ipad, 5), "ios");
  assert.equal(plataformaDe(UA.ipad, 0), "computador");
  assert.equal(plataformaDe(UA.windows), "computador");
});

test("navegador do iPhone", () => {
  assert.equal(navegadorIosDe(UA.iphone), "safari");
  assert.equal(navegadorIosDe(UA.iphoneChrome), "chrome");
  assert.equal(navegadorIosDe(UA.iphone.replace("Safari", "FxiOS/140 Safari")), "outro");
});

test("nova versão do sistema: só quando o servidor tem outro build (nunca no dev)", () => {
  assert.equal(haNovaVersao("abc1234-20261108", "abc1234-20261108"), false);
  assert.equal(haNovaVersao("abc1234-20261108", "def5678-20261109"), true);
  assert.equal(haNovaVersao("dev", "def5678-20261109"), false);
  assert.equal(haNovaVersao("abc1234-20261108", null), false);
  assert.equal(haNovaVersao("abc1234-20261108", ""), false);
});

test("app desatualizado: só com versionCode publicado maior que o instalado", () => {
  const android = { versionCode: 3, versionName: "1.2.0", minimo: 1, url: "/baixar/vertces.apk?v=3" };
  assert.equal(appDesatualizado(2, android), true);
  assert.equal(appDesatualizado(3, android), false);
  assert.equal(appDesatualizado(4, android), false);
  assert.equal(appDesatualizado(null, android), false, "fora do app não avisa");
  assert.equal(appDesatualizado(2, null), false, "sem APK publicado não avisa");
});

test("origem do app Android na URL de abertura", () => {
  assert.deepEqual(lerOrigem("?origem=android&versaoApp=7"), { android: true, versaoApp: 7 });
  assert.deepEqual(lerOrigem("?versaoApp=abc"), { android: false, versaoApp: null });
  assert.deepEqual(lerOrigem(""), { android: false, versaoApp: null });
});
