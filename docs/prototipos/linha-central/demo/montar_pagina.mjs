import { readFileSync, writeFileSync } from "node:fs";
const html = readFileSync("modelo.html", "utf8");
const dados = readFileSync("dados.json", "utf8");
const app = readFileSync("app.js", "utf8").replace(/<\/script/gi, "<\/script");
const out = html.replace("/*DADOS*/", () => dados).replace("/*APP*/", () => app);
writeFileSync("linha-central.html", out);
console.log("linha-central.html", out.length);
