import { readFileSync } from "fs";
import { extractText, getDocumentProxy } from "unpdf";

async function run() {
  const buf = readFileSync("./reference/PREVIA-FAZENDA-VIBRACAO.pdf");
  const proxy = await getDocumentProxy(new Uint8Array(buf));
  const { text } = await extractText(proxy, { mergePages: true });

  console.log("=== EXTRACAO DE VERTICES ===");
  const COD = "[A-Z0-9_]{1,10}-[MPV]-\\d+|[A-Z0-9_]{2,15}";
  const GMS = "-?\\d+°\\d+'[\\d,]+\"";
  const rowRe = new RegExp(
    `(${COD})\\s+(${GMS})\\s+(${GMS})\\s+([\\d.,]+)\\s+(${COD})\\s+(\\d+°\\d+')\\s+([\\d.,]+)\\s+` +
    `(.*?)(?=(?:${COD})\\s+-|Este Memorial|Data da Geração|$)`,
    "g"
  );
  let m;
  let count = 0;
  while ((m = rowRe.exec(text)) !== null) {
    count++;
    console.log(`${count}: ${m[1]} (lat:${m[3]}, lon:${m[2]}, alt:${m[4]}) -> vante: ${m[5]} (az:${m[6]}, dist:${m[7]})`);
  }
}

run().catch(console.error);
