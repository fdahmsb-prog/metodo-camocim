// Importador de provas em PDF — Método Camocim
// Roda inteiro no navegador do admin: lê o PDF (texto ou OCR), separa questões,
// aplica o gabarito e grava no banco. Não usa IA nem servidor próprio.
(function (G) {
"use strict";

/* ===================== 1. LEITURA DO PDF ===================== */
const TESS = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";

// Monta linhas a partir dos itens de texto do pdf.js, respeitando duas colunas.
function linhasDaPagina(items, largura, semColunas) {
  const its = items.filter(i => i.str).map(i => ({ s: i.str, x: i.transform[4], y: i.transform[5], w: i.width || 0, h: Math.abs(i.transform[3]) || 10 }));
  if (!its.some(i => i.s.trim())) return "";
  const meio = largura / 2;
  const cruzam = its.filter(i => i.x < meio - 10 && i.x + i.w > meio + 10).reduce((a, i) => a + i.s.length, 0);
  const total = its.reduce((a, i) => a + i.s.length, 0);
  const esq = its.filter(i => i.x < meio - 5).length, dir = its.filter(i => i.x >= meio - 5).length;
  const duasColunas = !semColunas && cruzam < total * 0.12 && esq > 15 && dir > 15;
  const grupos = duasColunas ? [its.filter(i => i.x < meio - 5), its.filter(i => i.x >= meio - 5)] : [its];
  const out = [];
  for (const g of grupos) {
    g.sort((a, b) => b.y - a.y || a.x - b.x);
    let linha = [], yAtual = null;
    const fecha = () => {
      if (!linha.length) return;
      linha.sort((a, b) => a.x - b.x);
      let t = "", fim = null;
      for (const it of linha) { if (!it.s.trim()) { if (t && !t.endsWith(" ")) t += " "; fim = it.x + it.w; continue; } if (fim !== null && it.x - fim > it.h * 0.2 && !t.endsWith(" ") && !it.s.startsWith(" ")) t += " "; t += it.s; fim = it.x + it.w; }
      out.push(t.replace(/\s+/g, " ").trim()); linha = [];
    };
    for (const it of g) { if (yAtual !== null && Math.abs(it.y - yAtual) > it.h * 0.45) fecha(); if (!linha.length) yAtual = it.y; linha.push(it); }
    fecha();
  }
  return out.join("\n");
}

// Texto "ruim": pouco texto ou letras soltas (P r o v a) — melhor fazer OCR.
function textoRuim(t) {
  const limpo = t.replace(/\s/g, "");
  if (limpo.length < 250) return true;
  const toks = t.split(/\s+/).filter(Boolean);
  const soltos = toks.filter(x => x.length === 1).length;
  return soltos / toks.length > 0.35;
}

let OCR = null;
async function ocrWorkers(n) {
  if (OCR) return OCR;
  await G.APP.loadScript(TESS);
  const ws = [];
  for (let i = 0; i < n; i++) ws.push(await G.Tesseract.createWorker("por"));
  OCR = ws; return ws;
}

// Lê um PDF e devolve o texto de cada página. Usa OCR só nas páginas sem texto bom.
async function lerPdf(file, prog, forcarOcr, semColunas) {
  await G.APP.loadScript(G.APP.PDFJS + "pdf.min.js");
  const lib = G.pdfjsLib; lib.GlobalWorkerOptions.workerSrc = G.APP.PDFJS + "pdf.worker.min.js";
  const pdf = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const N = pdf.numPages, paginas = new Array(N), precisaOcr = [];
  for (let p = 1; p <= N; p++) {
    const page = await pdf.getPage(p);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const t = linhasDaPagina(tc.items, vp.width, semColunas);
    if (forcarOcr || textoRuim(t)) precisaOcr.push(p); else paginas[p - 1] = t;
    prog(`Lendo ${file.name}: página ${p} de ${N}`, p / N * (precisaOcr.length ? 0.15 : 1));
  }
  if (precisaOcr.length) {
    const ws = await ocrWorkers(Math.min(2, precisaOcr.length));
    let feitas = 0, fila = precisaOcr.slice();
    const roda = async w => {
      while (fila.length) {
        const p = fila.shift();
        const page = await pdf.getPage(p);
        const vp = page.getViewport({ scale: 2.2 });
        const cv = document.createElement("canvas"); cv.width = vp.width; cv.height = vp.height;
        await page.render({ canvasContext: cv.getContext("2d"), viewport: vp }).promise;
        const r = await w.recognize(cv);
        paginas[p - 1] = r.data.text; cv.width = cv.height = 0;
        feitas++; prog(`Reconhecendo texto (OCR) de ${file.name}: ${feitas} de ${precisaOcr.length} páginas`, 0.15 + 0.85 * feitas / precisaOcr.length);
      }
    };
    await Promise.all(ws.map(roda));
  }
  return paginas.map(x => x || "");
}

/* ===================== 2. LIMPEZA ===================== */
const LIXO = /caderno\s+de\s+prova|^tipo\s+\w+\s*[–-]\s*p[áa]gina\s*\d+|fgv\s+conhecimento$|^–\s|tipo[\s-]*0{0,2}1\b|^modelo$|^p[áa]gina\s*\d+|^\W{0,3}$|^www\.|^about:blank|fundação\s*carlos\s*chagas|^fcc$/i;
function limpar(paginas, soNumero) {
  // cabeçalho/rodapé: linhas nas 3 primeiras ou 3 últimas posições que se repetem em muitas páginas
  const norm = l => l.toLowerCase().replace(/[\d\s'’"]+/g, "");
  const pls = paginas.map(t => t.split(/\r?\n/).map(l => l.replace(/\s+/g, " ").trim()).filter(Boolean));
  const borda = ls => ls.slice(0, 3).concat(ls.slice(-3));
  const freq = {}, todas = {};
  pls.forEach(ls => new Set(borda(ls).map(norm).filter(x => x.length > 3)).forEach(k => freq[k] = (freq[k] || 0) + 1));
  pls.forEach(ls => new Set(ls.filter(l => !/^\(?[A-Ea-e]\)/.test(l)).map(norm).filter(x => x.length > 6)).forEach(k => todas[k] = (todas[k] || 0) + 1));
  const lim = paginas.length >= 4 ? Math.max(3, paginas.length * 0.3) : Infinity;
  return pls.map(ls => ls.filter((l, i) => {
    if (LIXO.test(l)) return false;
    if (/^quest[ãa]o\s*\d{1,3}\b/i.test(l)) return true;
    const naBorda = i < 3 || i >= ls.length - 3;
    if (paginas.length >= 6 && todas[norm(l)] >= paginas.length * 0.5 && l.length < 90 && !/^\(?[A-Ea-e][\)\s]/.test(l) && !/[.:;?]$/.test(l)) return false;
    return !(naBorda && freq[norm(l)] >= lim && l.length < 90);
  }).join("\n")).join("\n");
}

/* ===================== 3. QUESTÕES ===================== */
const ROM = /^(?:[IVX]{1,5}|\d{1,2}|[a-e])[\.\)\-–]\s/;
function juntar(linhas) {
  let t = "";
  for (const l of linhas) {
    if (!t) { t = l; continue; }
    if (/[a-zà-ú]-$/.test(t) && /^[a-zà-ú]/.test(l)) { t = /^(se|me|te|lhes?|l[oa]s?|n[oa]s?|vos|[oa]s?)\b/.test(l) ? t + l : t.slice(0, -1) + l; continue; }
    const quebra = /[:;]$/.test(t) && ROM.test(l) || (/[.:;]$/.test(t) && /^[IVX]{1,4}\s+[A-ZÀ-Úa-zà-ú]/.test(l)) || /^Assinale a op[çc][ãa]o/.test(l) || /^[IVX]{1,5}\.\s/.test(l) || /^[•●▪\-–]\s/.test(l) || /^\(\s*\)\s/.test(l) || (/^(Está correto|As afirmativas são|Assinale|É correto)/.test(l) && /^(\(\s*\)|[IVX]{1,5}\.)/m.test(t.split("\n").pop())) || /\|/.test(l);
    t += (quebra ? "\n" : " ") + l;
  }
  return t.replace(/[ \t]+/g, " ").trim();
}
const OCRNUM = { O: "0", o: "0", I: "1", l: "1", "|": "1", T: "7", f: "7", Z: "2", S: "5", s: "5", B: "8", "à": "5", g: "9" };
const numOcr = s => s.split("").map(c => OCRNUM[c] !== undefined ? OCRNUM[c] : c).join("");
const LETRA_OCR = { "8": "B", "0": "CD", "O": "CD", "o": "CD", "Q": "D", "€": "C", "G": "C", "6": "C", "c": "C", "4": "A", "&": "E", "F": "E", "e": "E", "b": "B", "a": "A", "d": "D" };

// Padrão Cebraspe múltipla escolha: "Questão N", alternativas "A texto" e textos-base "Texto XYZ1A1"
function parseCebraspeME(texto, opt) {
  const L = "ABCDE".slice(0, opt.nAlt || 5);
  let linhas = texto.split("\n").map(l => l.trim()).filter(Boolean);
  const textos = {}, resto = [];
  for (let i = 0; i < linhas.length; i++) {
    const m = linhas[i].match(/^Texto\s+([A-Z0-9]{4,})$/);
    if (m) {
      const bl = [];
      let j = i + 1;
      for (; j < linhas.length && j < i + 160; j++) {
        if (/^Quest[ãa]o\s+\d{1,3}$/i.test(linhas[j]) || /^Texto\s+[A-Z0-9]{4,}$/.test(linhas[j])) { j--; break; }
        bl.push(linhas[j]);
        if (/(com adapta[çc][õo]es\)?\.?|adaptado\)?\.?)$/i.test(linhas[j]) || /^Internet:\s*</i.test(linhas[j])) break;
      }
      textos[m[1]] = juntar(bl.map(x => x)); i = j; continue;
    }
    resto.push(linhas[i]);
  }
  const ehTitulo = l => /^[A-ZÀ-Ú][A-ZÀ-Ú ,–\-()IVX]{5,}$/.test(l) && !/^[A-E]\s/.test(l) && l.split(" ").length >= 2;
  const lixo = l => /--|^P\d$|^PROVA OBJETIVA/.test(l) || /^<[A-Z0-9]+>$/.test(l);
  const qs = []; let q = null, disc = opt.disciplina || "", esperado = opt.inicio || 1;
  for (const l of resto) {
    const m = l.match(/^Quest[ãa]o\s+(\d{1,3})$/i);
    if (m && (+m[1] === esperado || +m[1] === esperado + 1)) { q = { n: +m[1], ls: [], disciplina: disc }; qs.push(q); esperado = +m[1] + 1; continue; }
    if (lixo(l)) continue;
    if (ehTitulo(l)) { disc = l.replace(/^[^A-ZÀ-Ú]+/, ""); disc = disc.charAt(0) + disc.slice(1).toLowerCase(); continue; }
    if (q) q.ls.push(l);
  }
  const out = qs.map(x => {
    const ls = x.ls, pos = []; let fim = ls.length;
    for (let k = L.length - 1; k >= 0; k--) {
      let p = -1; for (let i = fim - 1; i >= 0; i--) if (new RegExp("^" + L[k] + "\\s+\\S").test(ls[i])) { p = i; break; }
      if (p < 0) break; pos[k] = p; fim = p;
    }
    let enun, alts;
    if (L.split("").every((c, k) => pos[k] !== undefined)) {
      enun = juntar(ls.slice(0, pos[0]));
      alts = L.split("").map((c, k) => juntar([ls[pos[k]].replace(/^[A-E]\s+/, "")].concat(ls.slice(pos[k] + 1, k + 1 < L.length ? pos[k + 1] : ls.length))));
    } else { enun = juntar(ls); alts = L.split("").map(() => ""); }
    const refs = [...new Set((enun.match(/\btextos?\s+([A-Z0-9]{4,})/gi) || []).map(t => t.split(/\s+/).pop()))];
    const ctx = refs.filter(r => textos[r]).map(r => `Texto ${r}\n\n${textos[r]}`).join("\n\n");
    return { n: x.n, enunciado: (ctx ? ctx + "\n\n" : "") + enun, alternativas: alts, disciplina: x.disciplina };
  });
  out.forEach((x, k) => { if (out[k + 1] && out[k + 1].n > x.n + 1) x.falta = x.n + 1; });
  return out;
}

function parseQuestoes(texto, opt) {
  if (opt.tipo !== "CE" && (texto.match(/^Quest[ãa]o\s+\d{1,3}$/gim) || []).length >= 5 && /^[A-E]\s+\S/m.test(texto)) return parseCebraspeME(texto, opt);
  const ME = opt.tipo !== "CE";
  const nAlt = ME ? (opt.nAlt || 5) : 0;
  const L = "ABCDE".slice(0, nAlt || 5);
  const linhas = texto.split("\n").map(l => l.trim()).filter(Boolean);
  const qs = []; let q = null, alt = -1, pend = [], disc = opt.disciplina || "", ctxs = [];
  let esperado = opt.inicio || 1;
  const titulo = l => l.length < 70 && !/[.;,:]$/.test(l) && /^[A-ZÀ-Ú]/.test(l) && !/^\(?[A-E]\)/.test(l) && /[a-zà-úA-ZÀ-Ú]{4}/.test(l);
  const fechaPend = () => {
    if (!pend.length) return;
    let k = pend.length; while (k > 0 && pend.length - k < 2 && titulo(pend[k - 1])) k--;
    const corpo = pend.slice(0, k), tit = pend.slice(k);
    if (tit.length && (!q || !ME || alt >= nAlt - 2)) {
      const d = tit.filter(x => !/^conhecimentos\b/i.test(x)).pop() || tit.pop();
      disc = d.replace(/^[^A-Za-zÀ-ú]+/, "");
    } else corpo.push(...tit);
    if (q && corpo.length) { if (alt >= 0) q.alts[alt].push(...corpo); else q.enun.push(...corpo); }
    pend = [];
  };
  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i];
    // contexto "Atenção: as questões de números 26 a 34 referem-se..."
    const at = /^aten[çc][ãa]o\b/i.test(l) || /^(?:as\s+)?quest[õo]es\s+(?:de\s+n[úu]meros\s+)?\d{1,3}\s+a\s+\d{1,3}/i.test(l) || /^(?:texto|leia o texto)\b.*\bquest[õo]es\b/i.test(l);
    const RANGE = /quest[õo]es\s+(?:de\s+n[úu]meros\s+)?(\d{1,3})\s+(?:a|até)\s+(\d{1,3})/i;
    if (at && (!ME || !q || alt >= nAlt - 2) && RANGE.test(linhas.slice(i, i + 3).join(" "))) {
      fechaPend();
      const bl = [l]; while (i + 1 < linhas.length && !qStart(linhas[i + 1], esperado, false)) bl.push(linhas[++i]);
      const m = bl.join(" ").match(RANGE);
      if (m) ctxs.push({ de: +m[1], ate: +m[2], texto: juntar(bl) });
      else if (q) q.enun.push(...bl);
      continue;
    }
    const pronta = !q || !ME || alt >= nAlt - 2; // pelo menos 4 de 5 alternativas lidas
    if (ME && /^\d{1,4}$/.test(l)) { // número sozinho na linha: questão (padrão FGV) ou número de página
      const v = +l;
      if (pronta && (v === esperado || (q && alt >= nAlt - 1 && v === esperado + 1))) {
        fechaPend(); esperado = v;
        q = { n: v, enun: [], alts: L.split("").map(() => []), disciplina: disc };
        qs.push(q); alt = -1; esperado++;
      }
      continue;
    }
    const qs0 = pronta && qStart(l, esperado, q && ME && alt >= nAlt - 1);
    if (qs0) {
      fechaPend();
      if (qs0.n) esperado = qs0.n;
      q = { n: esperado, enun: qs0.resto ? [qs0.resto] : [], alts: L.split("").map(() => []), disciplina: disc };
      qs.push(q); alt = -1; esperado++; continue;
    }
    if (!q) { pend.push(l); if (pend.length > 6) pend.shift(); continue; }
    if (ME) {
      const a = altStart(l, L[alt + 1]);
      if (a && alt < nAlt - 1) { pend.length && (alt >= 0 ? q.alts[alt].push(...pend) : q.enun.push(...pend)); pend = []; alt = a.i; if (a.resto) q.alts[alt].push(a.resto); continue; }
      if (alt >= nAlt - 1) { pend.push(l); continue; } // pode ser continuação da última alternativa ou título de seção
      if (alt >= 0) q.alts[alt].push(l); else q.enun.push(l);
    } else {
      pend.push(l); if (pend.length > 3) { q.enun.push(pend.shift()); }
    }
  }
  if (q) { if (ME && alt >= 0) { while (pend.length && titulo(pend[pend.length - 1])) pend.pop(); q.alts[alt].push(...pend); } else q.enun.push(...pend); }
  qs.forEach((x, k) => { if (qs[k + 1] && qs[k + 1].n > x.n + 1) x.falta = x.n + 1; });
  return qs.map(x => {
    const ctx = ctxs.filter(c => x.n >= c.de && x.n <= c.ate).map(c => c.texto).join("\n\n");
    const enun = juntar(x.enun);
    return { n: x.n, enunciado: (ctx ? ctx + "\n\n" : "") + enun, alternativas: ME ? x.alts.map(juntar) : [], disciplina: x.disciplina, falta: x.falta };
  });

  function qStart(l, n, frouxo) {
    let m = l.match(/^quest[ãa]o\s*(\d{1,3})\b[\s:.\-–]*(.*)$/i);
    if (m && +m[1] === n) return { resto: m[2] };
    m = l.match(/^(\d{1,3})\s*[\.\)\-–]\s*(.*)$/) || (!ME && l.match(/^(\d{1,3})\s+([A-ZÀ-Ú].*)$/));
    if (m && (+m[1] === n || (frouxo && +m[1] === n + 1)) && (m[2] === "" || /^[^a-zà-ú]/.test(m[2]))) return { resto: m[2], n: +m[1] };
    if (frouxo) { // OCR leu o número errado (ex.: "f." no lugar de "7.")
      m = l.match(/^(\S{1,3})[\.\)]\s+([^a-zà-ú\s].*)$/);
      if (m && numOcr(m[1]) === String(n) && !/^[A-E]$/.test(m[1])) return { resto: m[2] };
    }
    return null;
  }
  function altStart(l, esp) { // devolve {i, resto}: aceita a letra esperada ou uma posterior (OCR pode perder uma)
    if (!esp) return null;
    const ok = c => { const k = L.indexOf(c); return k >= L.indexOf(esp) ? k : -1; };
    let m = l.match(/^\(\s*([A-Ea-e])\s*\)\s*(.*)$/) || l.match(/^([A-Ea-e])\s*\)\s*(.*)$/) || l.match(/^([A-E])\s*[\.\-–]\s+(.*)$/);
    if (m && ok(m[1].toUpperCase()) >= 0) return { i: ok(m[1].toUpperCase()), resto: m[2] };
    m = l.match(/^[\(\[{]\s*(\S{1,2})\s*[\)\]}]\s*(.*)$/);
    if (m) {
      const c = m[1][0], cand = (LETRA_OCR[c] || c.toUpperCase());
      if (cand.includes(esp)) return { i: L.indexOf(esp), resto: m[2] };
      for (const x of cand) if (ok(x) >= 0) return { i: ok(x), resto: m[2] };
    }
    return null;
  }
}

/* ===================== 4. GABARITO ===================== */
// Devolve blocos {numero: resposta}; um bloco novo começa quando a numeração recomeça.
function parseGabarito(texto) {
  let t = texto.replace(/\r/g, "");
  // formato em tabela: uma linha só com números e, logo abaixo, uma linha só com respostas
  // formato em coluna: linhas só com números seguidas do mesmo número de linhas só com respostas
  {
    const ls0 = t.split("\n").map(x => x.trim()).filter(Boolean), out = []; let i = 0, achou = false;
    const ehN = x => /^\d{1,3}$/.test(x), ehR = x => /^([A-E]|X|\*|C|E|NULA|ANULADA)$/i.test(x);
    while (i < ls0.length) {
      let j = i; while (j < ls0.length && ehN(ls0[j])) j++;
      const k = j - i;
      if (k >= 1 && ls0.slice(j, j + k).length === k && ls0.slice(j, j + k).every(ehR)) { for (let z = 0; z < k; z++) out.push(ls0[i + z] + " " + ls0[j + z]); i = j + k; achou = true; continue; }
      out.push(ls0[i]); i++;
    }
    if (achou) t = out.join("\n");
  }
  const ls = t.split("\n").map(x => x.trim()), pares = []; let tabela = false;
  for (let i = 0; i < ls.length - 1; i++) {
    const ns = ls[i].replace(/^(quest[ãa]o|quest[õo]es|item|itens|n[º°o]\.?)\s+/i, "").split(/\s+/), rs = ls[i + 1].replace(/^(gabarito|resposta|respostas)\s+/i, "").split(/\s+/);
    if (ns.length >= 5 && ns.every(x => /^\d{1,3}$/.test(x)) && rs.length === ns.length && rs.every(x => /^([A-E]|\*|X|NULA|ANULADA)$/i.test(x))) {
      pares.push(ns.map((n, k) => `${n} ${rs[k]}`).join("\n")); ls[i] = ls[i + 1] = ""; i++; tabela = true;
    } else if (/[a-zà-ú]{3}/i.test(ls[i]) && /turno|tipo|cargo|prova|caderno|manh[ãa]|tarde|conhecimentos|m[óo]dulo/i.test(ls[i])) pares.push("\n" + ls[i] + "\n");
  }
  if (tabela) t = pares.join("\n");
  const so = t.replace(/[^A-Za-z*]/g, "");
  if (/^[A-EXx*]{5,}$/.test(so) && !/\d/.test(t)) return [Object.fromEntries(so.toUpperCase().split("").map((c, i) => [i + 1, c]))];
  const re = /(?<![\d\/.,:])(\d{1,3})\s*(?:[-–.:)=]\s*)?(?:resposta\s*)?(anulad[ao]|nula|[A-E]|\*|X)(?![a-zà-ú])/gi;
  const blocos = []; let b = null, ult = 0, m, rotulo = "";
  for (const linha of t.split("\n")) {
    if (/[a-zà-ú]{3}/i.test(linha) && /turno|tipo|prova|cargo|caderno|gabarito|manh[ãa]|tarde|conhecimentos|m[óo]dulo/i.test(linha) && !/^\s*\d{1,3}\s+[A-E*X]\b/.test(linha)) { if (!/data\s+de|publica|hor[áa]rio/i.test(linha)) rotulo = linha.trim().slice(0, 80); continue; }
    re.lastIndex = 0;
    while ((m = re.exec(linha))) {
      const n = +m[1]; let r = m[2].toUpperCase(); if (/^(ANULAD|NULA|\*|X)/.test(r)) r = "X";
      if (!b || n <= ult) { b = {}; Object.defineProperty(b, "_nome", { value: rotulo, enumerable: false }); blocos.push(b); }
      if (n === ult + 1 || !Object.keys(b).length) { b[n] = r; ult = n; }
    }
  }
  return blocos.filter(x => Object.keys(x).length >= 5);
}

/* ===================== 5. TELA ===================== */
const ST = { qs: [], gab: [], arquivos: [] };
const BANCAS = [["Qualquer banca", ""], ["FCC", "concursosfcc.com.br"], ["FGV", "conhecimento.fgv.br"], ["Cebraspe", "cebraspe.org.br"], ["Vunesp", "vunesp.com.br"], ["Cesgranrio", "cesgranrio.org.br"], ["FUNDATEC", "fundatec.org.br"], ["IBFC", "ibfc.org.br"], ["Instituto AOCP", "institutoaocp.org.br"], ["Quadrix", "quadrix.org.br"], ["IDECAN", "idecan.org.br"], ["Consulplan", "institutoconsulplan.org.br"], ["IADES", "iades.com.br"], ["Instituto Verbena", "institutoverbena.ufg.br"], ["Cetro / outras", ""]];
function linksBusca({ banca, orgao, cargo, ano }) {
  const b = BANCAS.find(x => x[0] === banca) || BANCAS[0];
  const nomeBanca = b[1] ? banca : "";
  const termos = [nomeBanca, orgao, cargo, ano].filter(Boolean).join(" ");
  const q = s => encodeURIComponent(s.replace(/\s+/g, " ").trim());
  const g = s => "https://www.google.com/search?q=" + q(s);
  const L = [];
  if (b[1]) L.push({ nome: "Site oficial " + banca, url: g(`site:${b[1]} ${[orgao, cargo, ano].filter(Boolean).join(" ")} prova gabarito`) });
  L.push({ nome: "PDF da prova", url: g(`${termos} prova filetype:pdf`) });
  L.push({ nome: "PDF do gabarito", url: g(`${termos} gabarito definitivo filetype:pdf`) });
  L.push({ nome: "PCI Concursos", url: g(`site:pciconcursos.com.br/provas ${termos}`) });
  L.push({ nome: "Estude Grátis", url: g(`site:estudegratis.com.br/provas ${termos}`) });
  if (orgao) L.push({ nome: "Site do órgão", url: g(`${orgao} concurso ${cargo} ${ano} prova gabarito`) });
  return L;
}
function tela(m) {
  const { esc, $ } = G.APP;
  m.innerHTML = `<div class="head"><div><h1>Importar prova (PDF)</h1><p>Transforme provas anteriores em questões do app, direto no navegador, sem IA e sem custo.</p></div></div>
  <div class="card stack" style="margin-bottom:14px"><h2>Encontrar provas anteriores</h2>
    <p class="small muted">Preencha o que souber e toque numa fonte. A busca abre em outra aba; baixe a prova e o gabarito do <b>mesmo tipo</b> e volte aqui para importar.</p>
    <div class="grid g2">
      <label class="f">Banca<select id="bp-banca">${BANCAS.map(b => `<option value="${b[0]}">${b[0]}</option>`).join("")}</select></label>
      <label class="f">Órgão<input id="bp-orgao" placeholder="Ex.: SEFAZ-PI, TCE-AM"></label>
      <label class="f">Cargo<input id="bp-cargo" placeholder="Ex.: Auditor Fiscal"></label>
      <label class="f">Ano<input id="bp-ano" inputmode="numeric" placeholder="Ex.: 2025"></label>
    </div>
    <div class="row" style="flex-wrap:wrap;gap:8px" id="bp-links"></div>
  </div>
  <div class="grid g2">
    <div class="card stack"><h2>1. Arquivos</h2>
      <label class="f">PDF da prova (pode escolher vários)<input type="file" id="im-prova" accept="application/pdf,.pdf" multiple></label>
      <label class="f">PDF do gabarito (opcional)<input type="file" id="im-gab" accept="application/pdf,.pdf,.txt"></label>
      <label class="f">…ou cole o gabarito<textarea id="im-gabt" rows="3" placeholder="1-E 2-B 3-C …  ou  EBCDA…"></textarea></label>
      <label class="row small"><input type="checkbox" id="im-ocr"> Forçar OCR (use se o texto sair embaralhado)</label>
    </div>
    <div class="card stack"><h2>2. Dados da prova</h2>
      <div class="grid g2">
        <label class="f">Banca<input id="im-banca" value="FCC"></label>
        <label class="f">Ano<input id="im-ano" inputmode="numeric" value="${new Date().getFullYear()}"></label>
        <label class="f">Órgão<input id="im-orgao" placeholder="SEFAZ-CE"></label>
        <label class="f">Cargo<input id="im-cargo" placeholder="Auditor-Fiscal"></label>
        <label class="f">Tipo de questão<select id="im-tipo"><option value="ME5">Múltipla escolha A–E</option><option value="ME4">Múltipla escolha A–D</option><option value="CE">Certo ou Errado (Cebraspe)</option></select></label>
        <label class="f">Nº da 1ª questão<input id="im-ini" inputmode="numeric" value="1"></label>
      </div>
      <label class="f">Disciplina padrão (se a prova não tiver títulos)<input id="im-disc" placeholder="Ex.: Direito Tributário"></label>
      <button class="btn pri" id="im-ler">Ler PDFs e separar questões</button>
      <div id="im-prog" class="small muted" hidden></div>
    </div>
  </div>
  <div id="im-res"></div>`;
  $("#im-ler").onclick = ler;
  const atual = () => { const v = id => $(id).value.trim(); return { banca: v("#bp-banca"), orgao: v("#bp-orgao"), cargo: v("#bp-cargo"), ano: v("#bp-ano") }; };
  const desenha = () => { $("#bp-links").innerHTML = linksBusca(atual()).map(l => `<a class="btn sm" target="_blank" rel="noopener" href="${esc(l.url)}">${esc(l.nome)} ↗</a>`).join(""); };
  ["#bp-banca", "#bp-orgao", "#bp-cargo", "#bp-ano"].forEach(id => $(id).addEventListener("input", desenha)); desenha();
  $("#bp-banca").addEventListener("change", () => { const b = $("#bp-banca").value; if (b !== "Qualquer banca") $("#im-banca").value = b; });
}

async function ler() {
  const { $, toast } = G.APP;
  const provas = [...$("#im-prova").files];
  if (!provas.length) { toast("Escolha o PDF da prova."); return; }
  const btn = $("#im-ler"), pr = $("#im-prog"); btn.disabled = true; pr.hidden = false;
  const prog = (msg, f) => { pr.textContent = `${msg} (${Math.round((f || 0) * 100)}%)`; };
  const tipoSel = $("#im-tipo").value;
  const opt = { tipo: tipoSel === "CE" ? "CE" : "ME", nAlt: tipoSel === "ME4" ? 4 : 5, inicio: +$("#im-ini").value || 1, disciplina: $("#im-disc").value.trim() };
  try {
    let gabTxt = $("#im-gabt").value.trim();
    const gf = $("#im-gab").files[0];
    if (gf) gabTxt += "\n" + (gf.name.toLowerCase().endsWith(".pdf") ? (await lerPdf(gf, prog, $("#im-ocr").checked, true)).join("\n") : await gf.text());
    ST.gab = gabTxt ? parseGabarito(gabTxt) : [];
    ST.arquivos = [];
    for (const f of provas) {
      const pags = await lerPdf(f, prog, $("#im-ocr").checked);
      const texto = limpar(pags, opt.tipo !== "CE");
      let qs = parseQuestoes(texto, opt);
      if (!qs.length && opt.inicio === 1) qs = parseQuestoes(texto, { ...opt, inicio: +((texto.match(/^(\d{1,3})[\.\)]\s/m) || [])[1] || 1) });
      ST.arquivos.push({ nome: f.name, qs, texto, bloco: Math.min(ST.arquivos.length, ST.gab.length - 1) });
    }
    pr.textContent = `Pronto: ${ST.arquivos.reduce((a, x) => a + x.qs.length, 0)} questões encontradas${ST.gab.length ? `, gabarito com ${ST.gab.length} bloco(s)` : ", sem gabarito"}.`;
    mostrar();
  } catch (e) { console.error(e); toast("Não consegui ler: " + e.message); pr.textContent = "Erro: " + e.message; }
  btn.disabled = false;
}

function aplicaGab(arq) {
  const b = ST.gab[arq.bloco] || {};
  for (const q of arq.qs) {
    const r = b[q.n];
    if (q.gabManual !== undefined) { q.gab = q.gabManual; if (q.incluir === undefined) q.incluir = !!q.gab && q.gab !== "X"; continue; }
    if (q.tipo === "CE" || !q.alternativas.length) { q.gab = r === "C" || r === "E" ? r : (r === "X" ? "X" : ""); }
    else q.gab = r === "X" ? "X" : r && "ABCDE".indexOf(r) < q.alternativas.length ? r : "";
    q.incluir = q.incluir === undefined ? q.gab !== "X" : q.incluir;
  }
}
function problemas(q) {
  const p = [];
  if (!q.enunciado || q.enunciado.length < 15) p.push("enunciado curto");
  if (q.alternativas.length && q.alternativas.some(a => !a.trim())) p.push("alternativa vazia");
  if (!q.gab) p.push("sem gabarito");
  if (q.gab === "X") p.push("anulada");
  if (q.falta) p.push(`não achei a questão ${q.falta}: ela pode ter ficado junto desta`);
  return p;
}

function mostrar() {
  const { $, esc } = G.APP;
  const box = $("#im-res");
  const blocoSel = (arq, i) => ST.gab.length > 1 ? `<label class="f small">Bloco do gabarito<select data-bl="${i}">${ST.gab.map((b, j) => `<option value="${j}" ${arq.bloco === j ? "selected" : ""}>${esc(b._nome || "Bloco " + (j + 1))} (${Object.keys(b).length} respostas)</option>`).join("")}</select></label>` : "";
  ST.arquivos.forEach(aplicaGab);
  const total = ST.arquivos.reduce((a, x) => a + x.qs.filter(q => q.incluir).length, 0);
  box.innerHTML = `<div class="card stack" style="margin-top:14px"><div class="row" style="justify-content:space-between"><h2>3. Conferir</h2><span class="small muted">${total} questões marcadas para salvar</span></div>
    <p class="small muted">Questões com aviso em amarelo precisam de atenção. Toque em <b>Editar</b> para corrigir texto, alternativas ou gabarito. Anuladas ficam desmarcadas.</p>
    ${ST.arquivos.map((arq, i) => `<div class="stack"><div class="row" style="justify-content:space-between;align-items:flex-end"><h3 style="margin:0">${esc(arq.nome)} — ${arq.qs.length} questões</h3>${blocoSel(arq, i)}</div>
      <div class="row small"><span>Definir disciplina das questões</span><input data-dde="${i}" inputmode="numeric" style="width:60px" placeholder="de"><input data-date="${i}" inputmode="numeric" style="width:60px" placeholder="até"><input data-dnome="${i}" placeholder="Disciplina" style="flex:1;min-width:140px"><button class="btn sm" data-dap="${i}">Aplicar</button></div>
      ${arq.qs.length ? "" : `<p class="small">Não encontrei questões neste arquivo. Confira o tipo de questão e o nº da 1ª questão, ou marque "Forçar OCR".</p><details><summary class="small">Ver texto lido</summary><pre class="code" style="max-height:300px;overflow:auto">${esc(arq.texto.slice(0, 20000))}</pre></details>`}
      <div class="stack" style="gap:6px">${arq.qs.map((q, k) => {
        const pb = problemas(q);
        return `<div class="card" style="padding:10px;${pb.length ? "border-color:var(--mark)" : ""}">
          <div class="row" style="justify-content:space-between;align-items:flex-start;gap:8px">
            <label class="row small" style="gap:6px"><input type="checkbox" data-inc="${i}:${k}" ${q.incluir ? "checked" : ""}><b>${q.n}</b></label>
            <div style="flex:1;min-width:0"><div class="small muted">${esc(q.disciplina || "sem disciplina")} · Gabarito: <b>${q.gab || "—"}</b>${pb.length ? ` · <span style="color:var(--warn,#b7791f)">${pb.join(", ")}</span>` : ""}</div>
              <div class="small" style="white-space:pre-wrap;max-height:4.5em;overflow:hidden">${esc(q.enunciado.slice(0, 300))}</div></div>
            <button class="btn sm" data-ed="${i}:${k}">Editar</button></div></div>`;
      }).join("")}</div></div>`).join("<hr style='border:0;border-top:1px solid var(--line)'>")}
    <label class="row small"><input type="checkbox" id="im-geral" checked> Banco geral: disponível para todos os alunos</label>
    <div class="row"><button class="btn pri" id="im-salvar" ${total ? "" : "disabled"}>Salvar ${total} questões no app</button><button class="btn" id="im-json" ${total ? "" : "disabled"}>Baixar JSON</button></div>
  </div>`;
  box.querySelectorAll("[data-bl]").forEach(s => s.onchange = () => { const a = ST.arquivos[+s.dataset.bl]; a.bloco = +s.value; a.qs.forEach(q => delete q.incluir); mostrar(); });
  box.querySelectorAll("[data-inc]").forEach(c => c.onchange = () => { const [i, k] = c.dataset.inc.split(":").map(Number); ST.arquivos[i].qs[k].incluir = c.checked; mostrar(); });
  box.querySelectorAll("[data-ed]").forEach(b => b.onclick = () => { const [i, k] = b.dataset.ed.split(":").map(Number); editar(ST.arquivos[i].qs[k]); });
  box.querySelectorAll("[data-dap]").forEach(b => b.onclick = () => {
    const i = +b.dataset.dap, de = +box.querySelector(`[data-dde="${i}"]`).value || 1, ate = +box.querySelector(`[data-date="${i}"]`).value || 999, nome = box.querySelector(`[data-dnome="${i}"]`).value.trim();
    ST.arquivos[i].qs.forEach(q => { if (q.n >= de && q.n <= ate) q.disciplina = nome; }); mostrar();
  });
  const fim = $("#im-salvar"); if (fim) fim.onclick = salvar;
  const js = $("#im-json"); if (js) js.onclick = () => {
    const blob = new Blob([JSON.stringify(montar(), null, 1)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `${($("#im-banca").value || "prova").toLowerCase()}-${$("#im-ano").value}-${($("#im-orgao").value || "orgao").toLowerCase().replace(/\W+/g, "-")}.json`; a.click();
  };
}

function editar(q) {
  const { esc, modal, $ } = G.APP;
  const ME = q.alternativas.length > 0;
  const op = ME ? "ABCDE".slice(0, q.alternativas.length).split("") : ["C", "E"];
  modal(`<h2>Questão ${q.n}</h2>
    <label class="f">Disciplina<input id="ed-d" value="${esc(q.disciplina || "")}"></label>
    <label class="f">Enunciado<textarea id="ed-e" rows="8">${esc(q.enunciado)}</textarea></label>
    ${q.alternativas.map((a, i) => `<label class="f">${"ABCDE"[i]})<textarea data-alt="${i}" rows="2">${esc(a)}</textarea></label>`).join("")}
    <label class="f">Gabarito<select id="ed-g"><option value="">—</option>${op.map(l => `<option ${q.gab === l ? "selected" : ""}>${l}</option>`).join("")}<option value="X" ${q.gab === "X" ? "selected" : ""}>Anulada</option></select></label>
    <div class="row"><button class="btn pri" id="ed-ok">Salvar</button><button class="btn ghost" id="ed-x">Cancelar</button></div>`);
  $("#ed-x").onclick = () => G.APP.closeModal();
  $("#ed-ok").onclick = () => {
    q.disciplina = $("#ed-d").value.trim(); q.enunciado = $("#ed-e").value.trim();
    document.querySelectorAll("#modalbox [data-alt]").forEach(t => q.alternativas[+t.dataset.alt] = t.value.trim());
    q.gab = $("#ed-g").value; q.gabManual = q.gab; q.incluir = q.gab && q.gab !== "X";
    G.APP.closeModal(); mostrar();
  };
}

function montar() {
  const { $ } = G.APP;
  const meta = { banca: $("#im-banca").value.trim(), ano: $("#im-ano").value.trim(), orgao: $("#im-orgao").value.trim(), cargo: $("#im-cargo").value.trim() };
  const out = [];
  for (const arq of ST.arquivos) for (const q of arq.qs) {
    if (!q.incluir || !q.gab || q.gab === "X") continue;
    const ME = q.alternativas.length > 0;
    out.push({ tipo: ME ? "ME" : "CE", enunciado: q.enunciado, alternativas: ME ? q.alternativas : [], gabarito: ME ? "ABCDE".indexOf(q.gab) : q.gab,
      comentario: "", fundamento: "", disciplina: q.disciplina || "", assunto: "", ...meta, origem: "concurso", dificuldade: "média" });
  }
  return out;
}

async function salvar() {
  const { $, toast } = G.APP;
  const lista = montar(); if (!lista.length) return;
  const b = $("#im-salvar"); b.disabled = true; b.textContent = "Salvando…";
  try {
    await G.APP.insertQuestions(lista, $("#im-geral").checked);
    G.APP.renderNav(); if (G.APP.practice) G.APP.practice.list = null;
    toast(`${lista.length} questões salvas no app.`);
    b.textContent = "Salvo ✓";
  } catch (e) { toast("Não consegui salvar: " + e.message); b.disabled = false; b.textContent = "Tentar de novo"; }
}

G.Importador = { tela, linksBusca, parseQuestoes, parseGabarito, limpar, linhasDaPagina };
if (typeof module !== "undefined") module.exports = G.Importador;
})(typeof window !== "undefined" ? window : globalThis);
