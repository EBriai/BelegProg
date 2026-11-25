// Tekstherkenning (OCR) op een schermafbeelding van je broker, in je eigen
// browser met Tesseract.js. De afbeelding gaat nergens heen.
//
// Werkwijze: eerst de hele afbeelding lezen (tickers in grote letters), daarna
// elk klein woordje rechts (de beurscode) apart uitvergroot opnieuw lezen.
window.Beleg = window.Beleg || {};

Beleg.ocr = (() => {
  const LIB = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
  let libPromise = null, workerPromise = null, progress = null;

  function loadLib() {
    if (window.Tesseract) return Promise.resolve();
    return (libPromise ||= new Promise((ok, fail) => {
      const s = document.createElement("script");
      s.src = LIB; s.onload = ok; s.onerror = () => { libPromise = null; fail(new Error("Kon de tekstherkenning niet laden. Probeer het opnieuw.")); };
      document.head.appendChild(s);
    }));
  }
  async function worker() {
    await loadLib();
    return (workerPromise ||= Tesseract.createWorker("eng", 1, {
      logger: (m) => m.status === "recognizing text" && progress?.(m.progress),
    }));
  }

  /** Groter, grijs, donkere achtergrond omgekeerd, scherp zwart-wit. */
  function prepare(src, sx, sy, sw, sh, width) {
    const scale = Math.max(1, Math.min(8, width / sw));
    const c = document.createElement("canvas");
    c.width = Math.round(sw * scale); c.height = Math.round(sh * scale);
    const g = c.getContext("2d", { willReadFrequently: true });
    g.imageSmoothingQuality = "high";
    g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(src, sx, sy, sw, sh, 0, 0, c.width, c.height);
    const img = g.getImageData(0, 0, c.width, c.height), d = img.data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const dark = sum / (d.length / 4) < 128;
    for (let i = 0; i < d.length; i += 4) {
      let y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      if (dark) y = 255 - y;
      y = y < 200 ? 0 : 255;
      d[i] = d[i + 1] = d[i + 2] = y;
    }
    g.putImageData(img, 0, 0);
    return { canvas: c, scale };
  }

  /** Geeft regels terug als [{ticker, code}] (code kan leeg zijn). */
  async function read(file, onProgress) {
    if (!file || !/^image\//.test(file.type)) throw new Error("Dat is geen afbeelding.");
    const w = await worker();
    const bmp = await createImageBitmap(file);
    progress = (p) => onProgress?.(Math.round(p * 50));
    const full = prepare(bmp, 0, 0, bmp.width, bmp.height, 1800);
    await w.setParameters({ tessedit_pageseg_mode: "6", tessedit_char_whitelist: "" });
    const { data } = await w.recognize(full.canvas);
    const rows = [];
    for (const line of data.lines || []) {
      const words = line.words.filter((x) => x.text.trim());
      if (!words.length) continue;
      rows.push({ ticker: words[0].text.trim(), tickerWord: words[0], codeWord: words.length > 1 ? words.at(-1) : null });
    }
    // tweede ronde: beurscodes los en extra groot
    progress = null;
    const crop = (word, width) => {
      const b = word.bbox, pad = 6;
      const x0 = Math.max(0, b.x0 / full.scale - pad), y0 = Math.max(0, b.y0 / full.scale - pad);
      const x1 = Math.min(bmp.width, b.x1 / full.scale + pad), y1 = Math.min(bmp.height, b.y1 / full.scale + pad);
      return prepare(bmp, x0, y0, x1 - x0, y1 - y0, width).canvas;
    };
    for (let i = 0; i < rows.length; i++) {
      onProgress?.(50 + Math.round((i / rows.length) * 50));
      // ticker opnieuw, los en groot: haalt 5/S en 1/T uit elkaar
      await w.setParameters({ tessedit_pageseg_mode: "8", tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789." });
      const t2 = (await w.recognize(crop(rows[i].tickerWord, 250))).data.text.replace(/\s+/g, "");
      if (t2) rows[i].ticker = t2;
      await w.setParameters({ tessedit_pageseg_mode: "7", tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ." });
      const cw = rows[i].codeWord;
      if (!cw) { rows[i].code = ""; continue; }
      const r = await w.recognize(crop(cw, 600));
      rows[i].code = r.data.text.replace(/\s+/g, "").toUpperCase() || cw.text.toUpperCase();
      rows[i].raw = cw.text;
    }
    return rows.map(({ ticker, code, raw }) => ({ ticker, code, raw }));
  }

  return { read };
})();
