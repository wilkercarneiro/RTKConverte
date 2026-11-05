// PNG de "assinatura" sintético para os testes (traço ondulado azul-escuro em fundo transparente).
import { deflateSync, crc32 } from "node:zlib";

/** PNG RGBA mínimo (traço de "assinatura" em fundo transparente). */
export function pngAssinatura(w = 300, h = 90) {
  const linhas = [];
  for (let y = 0; y < h; y++) {
    const l = Buffer.alloc(1 + w * 4);
    for (let x = 0; x < w; x++) {
      const yc = h / 2 + Math.sin(x / 18) * h * 0.3;
      if (Math.abs(y - yc) < 3) { l[1 + x * 4] = 20; l[2 + x * 4] = 30; l[3 + x * 4] = 120; l[4 + x * 4] = 255; }
    }
    linhas.push(l);
  }
  const chunk = (tipo, dados) => {
    const t = Buffer.from(tipo, "latin1");
    const len = Buffer.alloc(4); len.writeUInt32BE(dados.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, dados])) >>> 0);
    return Buffer.concat([len, t, dados, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return new Uint8Array(Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.concat(linhas))), chunk("IEND", Buffer.alloc(0)),
  ]));
}
