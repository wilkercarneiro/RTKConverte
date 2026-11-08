# App Android do Vertces (TWA)

O app é uma **Trusted Web Activity**: abre `https://vertces.com.br/app/` dentro
do **Chrome** do celular, em tela cheia, sem barra de endereço. Não é WebView nem
Capacitor — de propósito: só o motor do Chrome tem Web Serial sobre Bluetooth
(Chrome Android 138+), Web Bluetooth e a localização do Chrome, que o sistema usa
para falar com receptores GNSS RTK. Sem Chrome no aparelho, o app abre o sistema
numa aba personalizada do navegador que houver (`FALLBACK_STRATEGY=customtabs`).

- Pacote: `br.com.vertces.app` · nome: **Vertces** · minSdk 24 (Android 7) · targetSdk 35
- Biblioteca: `com.google.androidbrowserhelper:androidbrowserhelper` (LauncherActivity)
- URL de abertura: `https://vertces.com.br/app/?origem=android&versaoApp=<versionCode>`
  — o site guarda a versão e avisa quando há APK mais novo (`src/lib/versao.ts`).

## Gerar o APK

```
node scripts/android-build.mjs
```

Compila (Gradle 8.14 + JBR do Android Studio), assina, roda `apksigner verify` e
`aapt dump badging`, copia para `public/baixar/vertces.apk` e garante o SHA-256 da
chave em `public/.well-known/assetlinks.json`. Caminhos podem ser trocados por
`JAVA_HOME`, `ANDROID_HOME` e `VERTCES_ANDROID_CHAVES`.

Ícones (app e PWA) saem de `scripts/gerar-icones-app.py` (redesenha o
`public/favicon.svg`): `C:\Python314\python.exe scripts/gerar-icones-app.py`.

## Versão nova

1. Suba `versionCode` (inteiro, +1) e `versionName` em `android/versao.json`.
   Para obrigar a atualização de quem está muito atrás, suba também `minimo`.
2. `node scripts/android-build.mjs`
3. Publique o site (o push na `main` publica na Vercel). O build grava
   `/app/versao.json` com a versão do APK; quem abrir o app velho vê
   "Há uma versão nova do app" → **Atualizar app** (baixa e instala por cima).

O mesmo `versao.json` do build traz o id do build do site: quem está com o
sistema aberto vê "Nova versão do Vertces disponível" → **Atualizar**.

## Chave de assinatura

Fica **fora do repositório**, em `%USERPROFILE%\.vertces-android\`:
`vertces.keystore` (PKCS12, alias `vertces`) e `senhas.txt` (chave=valor).
Criada uma vez com `node scripts/android-build.mjs --gerar-chave`.

**Guarde cópia dessa pasta em lugar seguro.** Sem ela não dá para atualizar o
app já instalado: o Android recusa APK assinado com outra chave.

## Digital Asset Links

`public/.well-known/assetlinks.json` liga o site ao app (sem ele o Chrome mostra
a barra de endereço no app). Se um dia o app for para a Play Store com o
**Play App Signing**, acrescente ali o SHA-256 da chave de assinatura da Google
(Play Console → Integridade do app), mantendo o atual.
