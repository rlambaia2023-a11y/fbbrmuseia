// Geração e exportação de seminários: pesquisa o tema, monta slides com
// imagens e explicações, exporta em PDF ou PowerPoint.
import PDFDocument from "pdfkit";
import pptxgen from "pptxgenjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { searchWeb, pageEvidence, humanizeAnswer, keywords, sleep } from "./research.js";

const UA = "odonto-seminarios/1.0 (estudo)";
const UPLOADS_DIR = process.env.UPLOAD_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), "uploads");

// Busca imagens livres no Wikimedia Commons (sem chave, licenca aberta).
// Testa varias formulacoes (tema completo, tema + "dentistry"/"dental" e as
// palavras-chave do tema isoladas), descarta documentos escaneados e escolhe
// as mais relevantes pelo titulo.
const DENTAL_TOKS = new Set([
  "dental", "dentistry", "dentist", "tooth", "teeth", "odontologia", "odonto",
  "dente", "dentes", "boca", "oral", "syringe", "seringa", "clinic", "clinica",
  "molar", "incisor", "gengiva", "gum",
]);
const DOC_EXT = /\.(pdf|djvu|tiff?)$/i;
// Palavras genericas demais para pontuar sozinhas (todo seminario e de odonto)
const GENERIC = new Set(["odontologia", "odonto", "odontologico", "dental", "dentistry", "dentista", "dentist"]);
// Glossario PT->EN para buscar no Commons (acervo majoritariamente em ingles)
const PT_EN = {
  anestesia: ["anesthesia", "anaesthetic", "anaesthesia"],
  carie: ["caries", "cavity", "decay"], pulpite: ["pulpitis"], periodontite: ["periodontitis"],
  gengivite: ["gingivitis"], gengiva: ["gum", "gingiva"], canal: ["root canal"],
  extracao: ["extraction"], extracoes: ["extraction"], implante: ["implant"], implantes: ["implant"],
  implantodontia: ["implant", "dental implant"],
  protese: ["denture", "prosthesis"], proteses: ["denture", "prosthesis"],
  aparelho: ["braces"], radiografia: ["radiograph", "x-ray"], radiografias: ["radiograph", "x-ray"],
  radiologia: ["radiology", "radiograph"],
  cirurgia: ["surgery"], restauracao: ["restoration", "filling"], restauracoes: ["restoration", "filling"],
  dentistica: ["restorative dentistry", "restoration"],
  endodontia: ["endodontics"], periodontia: ["periodontics"], ortodontia: ["orthodontics"],
  estomatologia: ["oral medicine", "stomatology"], semiologia: ["diagnosis", "oral diagnosis"],
  anatomia: ["anatomy"], anatomia_dental: ["dental anatomy"],
  clareamento: ["whitening", "bleaching"], fluor: ["fluoride"], placa: ["plaque"],
  tartaro: ["tartar", "calculus"], oclusao: ["occlusion"], atm: ["tmj"],
  bruxismo: ["bruxism"], biopsia: ["biopsy"], sutura: ["suture"], anestesico: ["anesthetic"],
  agulha: ["needle"], odontopediatria: ["pediatric dentistry"], urticaria: ["hives"],
};
const STOP = new Set(["de", "da", "do", "das", "dos", "em", "na", "no", "nas", "nos", "para", "com", "uma", "umas", "um", "uns", "e", "o", "a", "os", "as", "local", "tipo", "tipos", "sobre"]);

export async function commonsImages(query, limit = 4) {
  const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const nq = norm(query);
  const words = [...new Set(nq.split(/[^a-z0-9]+/).filter((t) => t.length >= 4 && !STOP.has(t)))];
  // Monta a versao em ingles do tema com o glossario
  const enWords = [];
  for (const w of words) {
    if (GENERIC.has(w)) continue;
    if (PT_EN[w]) enWords.push(...PT_EN[w]);
    else if (w.length >= 5) enWords.push(w);
  }
  const enQuery = [...new Set(enWords)].join(" ");
  const variants = [query];
  if (enQuery) variants.push(enQuery);
  if (enWords.length) variants.push(`${enWords[0]} dental`);
  variants.push(...words.filter((w) => w.length >= 6 && !GENERIC.has(w)));
  const themeToks = new Set(words.filter((w) => !GENERIC.has(w)));
  const enToks = new Set(enQuery.split(/[^a-z0-9]+/).filter((t) => t.length >= 4));
  const seen = new Set();
  const scored = [];
  for (const q of variants) {
    if (scored.length >= 30) break;
    try {
      const url =
        "https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search" +
        "&gsrsearch=" + encodeURIComponent(q) +
        "&gsrnamespace=6&gsrlimit=10&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=900";
      const r = await fetch(url, { headers: { "User-Agent": UA } });
      if (!r.ok) continue;
      const data = await r.json();
      const pages = (data.query && data.query.pages) || {};
      for (const p of Object.values(pages)) {
        const info = (p.imageinfo || [])[0] || {};
        const imgUrl = info.thumburl || info.url;
        if (!imgUrl || seen.has(imgUrl)) continue;
        if (!/\.(jpe?g|png)(\?|$)/i.test(imgUrl)) continue;
        seen.add(imgUrl);
        const title = (p.title || "").replace(/^File:/, "");
        if (DOC_EXT.test(title)) continue; // documento escaneado, nao e foto
        const tt = norm(title);
        let score = 0, hasTopic = false, hasDental = false;
        for (const t of themeToks) if (tt.includes(t)) { score += 3; hasTopic = true; }
        for (const t of enToks) if (tt.includes(t)) { score += 3; hasTopic = true; }
        for (const t of DENTAL_TOKS) if (tt.includes(t)) { score += 1; hasDental = true; }
        if (hasTopic && hasDental) score += 3; // combina o tema com o contexto odontologico
        if (score >= 3) scored.push({ score, img: { url: imgUrl, page: info.descriptionurl || "", title } });
      }
    } catch { /* tenta a proxima variacao */ }
    await sleep(350);
  }
  scored.sort((a, b) => b.score - a.score);
  const best = [];
  for (const s of scored) {
    if (best.length >= limit) break;
    if (best.some((b) => b.img.url === s.img.url)) continue;
    best.push(s);
  }
  return best.map((s) => s.img);
}

async function fetchImage(url) {
  // Ilustração gerada empacotada (data URI do catálogo infantil)
  if (url.startsWith("data:image/")) {
    const m = url.match(/^data:(image\/(?:jpeg|png));base64,(.+)$/);
    if (!m) throw new Error("ilustração inválida");
    return { buf: Buffer.from(m[2], "base64"), mime: m[1] };
  }
  // Imagem local (ex.: /uploads/gerada-pela-ia.jpg): le do disco
  if (url.startsWith("/uploads/")) {
    const abs = path.join(UPLOADS_DIR, path.basename(url));
    const buf = fs.readFileSync(abs);
    const head = buf.subarray(0, 4).toString("latin1");
    const mime = /^\x89PNG/.test(head) ? "image/png" : "image/jpeg";
    return { buf, mime };
  }
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`img HTTP ${r.status}`);
  const ct = (r.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  const buf = Buffer.from(await r.arrayBuffer());
  if (!/image\/(jpeg|png)/.test(ct) && !/^\x89PNG|^\xff\xd8/.test(buf.subarray(0, 4).toString("latin1"))) {
    throw new Error("formato de imagem não suportado");
  }
  const mime = ct.includes("png") ? "image/png" : "image/jpeg";
  return { buf, mime };
}

function toBullets(text, max = 5) {
  const parts = (text.match(/[^.!?…]+[.!?…]/g) || [text])
    .map((s) => s.trim())
    .filter((s) => s.length > 20)
    .slice(0, max);
  return parts.length ? parts : [text.slice(0, 300)];
}

export const SEMINAR_STYLES = ["moderno", "formal", "animado"];
export const SEMINAR_STYLE_LABELS = {
  moderno: "Moderno e leve",
  formal: "Formal e elegante",
  animado: "Animado e divertido",
};

// Secoes intermediarias possiveis (Introducao abre, Conclusao fecha)
const MIDDLE_SECTIONS = [
  { title: "Principais aspectos", q: (c) => `${c} características principais`, boost: ["característica", "principal", "aspecto", "tipo", "classificação"] },
  { title: "Tipos e classificação", q: (c) => `${c} tipos classificação`, boost: ["tipo", "classificação", "classifica", "categoria", "divide"] },
  { title: "Técnicas e procedimentos", q: (c) => `${c} técnicas procedimentos`, boost: ["técnica", "procedimento", "passo", "etapa", "protocolo"] },
  { title: "Diagnóstico e avaliação", q: (c) => `${c} diagnóstico avaliação`, boost: ["diagnóstico", "avaliação", "sintoma", "sinal", "exame"] },
  { title: "Na prática clínica", q: (c) => `${c} tratamento aplicação clínica`, boost: ["clínica", "tratamento", "técnica", "procedimento", "indicação"] },
  { title: "Pontos de atenção", q: (c) => `${c} cuidados`, boost: ["cuidado", "atenção", "complicação", "risco", "contraindicação"] },
  { title: "Cuidados e manutenção", q: (c) => `${c} manutenção higiene cuidados`, boost: ["manutenção", "higiene", "cuidado", "durabilidade", "limpeza"] },
  { title: "Prevenção e orientação", q: (c) => `${c} prevenção orientação paciente`, boost: ["prevenção", "orientação", "educação", "hábito", "evitar"] },
  { title: "Erros comuns e como evitá-los", q: (c) => `${c} erros comuns evitar`, boost: ["erro", "comum", "evitar", "falha", "cuidado"] },
  { title: "Avanços e atualidades", q: (c) => `${c} avanços novidades tecnologia`, boost: ["avanço", "novo", "tecnologia", "atual", "inovação"] },
];

// Temas infantis: o seminário usa ilustrações geradas (sem foto clínica).
// A detecção é pelo tema ou pela opção marcada no formulário.
const INFANTIL_WORDS = ["infantil", "crianca", "criancas", "pediatria", "pediatrico", "pediatrica", "odontopediatria", "bebe", "bebes", "primeira infancia", "dente de leite", "infancia", "kids"];
const normKey = (s) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
function isInfantilTheme(clean, opts) {
  if (opts && opts.infantil) return true;
  const n = normKey(clean);
  return INFANTIL_WORDS.some((w) => n.includes(w));
}
let _ilustraCache = null;
function ilustracoesInfantis() {
  try {
    if (!_ilustraCache) {
      const p = path.join(path.dirname(fileURLToPath(import.meta.url)), "public", "ilustracoes-infantis.json");
      _ilustraCache = JSON.parse(fs.readFileSync(p, "utf8"));
    }
    return _ilustraCache;
  } catch { return {}; }
}
// Escolhe a ilustração com mais afinidade com o slide (título + bullets);
// cada ilustração é usada no máximo uma vez por seminário.
function pickIlustracao(slide, usedKeys) {
  const cat = ilustracoesInfantis();
  const keys = Object.keys(cat).filter((k) => !usedKeys.has(k));
  if (!keys.length) return null;
  const hay = normKey(slide.title + " " + (slide.bullets || []).join(" "));
  let best = keys[0], bestScore = -1;
  for (const k of keys) {
    const sc = (cat[k].tags || []).filter((t) => hay.includes(normKey(t))).length;
    if (sc > bestScore) { bestScore = sc; best = k; }
  }
  usedKeys.add(best);
  return { url: cat[best].data, page: "", title: cat[best].label };
}
// Rede de segurança: frases do material pesquisado com maior sobreposição
// de palavras-chave com a pergunta da seção (sem inventar conteúdo).
function bestOverlapSentences(pool, queryTokens, count, exclude) {
  const wordSet = (s) => new Set(keywords(s));
  const scored = [];
  for (const p of pool) {
    for (const s of (String(p).match(/[^.!?…]+[.!?…]/g) || [])) {
      const t = s.trim();
      if (t.length < 25) continue;
      const key = t.slice(0, 50).toLowerCase();
      if (exclude.has(key)) continue;
      const toks = wordSet(t);
      const hits = queryTokens.filter((q) => toks.has(q)).length;
      if (hits >= 1) scored.push({ s: t, hits, toks });
    }
  }
  scored.sort((a, b) => b.hits - a.hits);
  const out = [];
  for (const c of scored) {
    if (out.length >= count) break;
    const dup = out.some((o) => {
      const ow = wordSet(o);
      let inter = 0;
      for (const w of c.toks) if (ow.has(w)) inter++;
      return inter / Math.max(1, c.toks.size) > 0.6;
    });
    if (!dup) out.push(c.s);
  }
  return out;
}

export async function generateSeminar(theme, opts = {}) {
  const clean = String(theme || "").trim();
  if (clean.length < 3) throw new Error("Informe um tema para o seminário.");
  const style = SEMINAR_STYLES.includes(opts.style) ? opts.style : "moderno";
  const total = Math.min(14, Math.max(4, parseInt(opts.slideCount, 10) || 7));
  const contentCount = total - 2; // sem capa e sem referências
  const infantil = isInfantilTheme(clean, opts);

  const results = await searchWeb(`${clean} odontologia`, 8);
  if (!results.length) throw new Error("Não foi possível pesquisar o tema na internet agora.");

  const qTokens = [...new Set(keywords(clean))].slice(0, 24);
  const deep = [];
  for (const r of results.slice(0, 3)) {
    const ev = await pageEvidence(r.url, qTokens);
    if (ev) deep.push({ ...r, passage: ev });
    await sleep(600);
  }
  const passages = deep.map((d) => d.passage).filter(Boolean);
  // prefere o texto extraído das páginas; usa títulos/snippets só como complemento
  let snippets = results.map((r) => `${r.title}. ${r.snippet}`).filter(Boolean);
  if (passages.length >= 3) snippets = snippets.slice(0, 2);

  const slides = [{ type: "title", title: clean, subtitle: "Seminário — Odontologia", style }];
  const usedSentences = new Set(); // cada slide usa frases diferentes
  const markUsed = (text) => {
    (text.match(/[^.!?…]+[.!?…]/g) || []).forEach((s) => usedSentences.add(s.slice(0, 50).toLowerCase()));
  };
  const sections = [];
  // Monta uma seção; se ficar vazia ou rala com o material comum, faz uma
  // pesquisa dedicada ao tema da seção e, em último caso, completa com as
  // frases mais afins do material pesquisado. Nenhuma seção sai vazia.
  const buildSection = async (title, q, boost) => {
    let text = humanizeAnswer(q, passages, snippets, { boost, exclude: [...usedSentences] });
    let bullets = text ? toBullets(text) : [];
    if (text) markUsed(text);
    if (bullets.length < 3) {
      try {
        const r2 = await searchWeb(q, 5);
        const toks2 = [...new Set(keywords(q))].slice(0, 24);
        const p2 = [];
        for (const r of r2.slice(0, 2)) {
          const ev = await pageEvidence(r.url, toks2);
          if (ev) p2.push(ev);
          await sleep(400);
        }
        const s2 = r2.map((r) => `${r.title}. ${r.snippet}`).filter(Boolean);
        const text2 = humanizeAnswer(q, [...p2, ...passages], [...s2, ...snippets], { boost, exclude: [...usedSentences] });
        if (text2) {
          bullets = toBullets(text2);
          markUsed(text2);
          passages.push(...p2);
          snippets.push(...s2);
        }
      } catch { /* segue para a rede de segurança */ }
    }
    if (bullets.length < 3) {
      const extra = bestOverlapSentences([...passages, ...snippets], keywords(q), 3 - bullets.length, usedSentences);
      bullets.push(...extra);
    }
    if (!bullets.length) bullets = ["Conteúdo em elaboração a partir das fontes pesquisadas."];
    const slide = { type: "content", title, bullets, style };
    slides.push(slide);
    sections.push({ slide, query: q });
    return slide;
  };
  await buildSection("Introdução", `o que é ${clean}`, ["é", "define", "conceito", "consiste"]);
  for (const m of MIDDLE_SECTIONS.slice(0, Math.max(0, contentCount - 2))) {
    await buildSection(m.title, m.q(clean), m.boost);
  }
  // Conclusão por síntese: recapitula o que o próprio seminário ensinou
  // (introdução + prática + pontos de atenção), soma a importância
  // pesquisada e fecha. Nunca sai genérica ou vazia.
  const byTitle = (t) => sections.find((s) => s.slide.title === t)?.slide;
  const lowerFirst = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : "");
  const conclBullets = [];
  const intro = byTitle("Introdução");
  if (intro?.bullets[0]) conclBullets.push(`Ao longo do seminário, vimos que ${lowerFirst(intro.bullets[0])}`);
  const clin = byTitle("Na prática clínica") || byTitle("Técnicas e procedimentos");
  if (clin?.bullets[0]) conclBullets.push(`Na prática, ${lowerFirst(clin.bullets[0])}`);
  const aten = byTitle("Pontos de atenção");
  if (aten?.bullets[0]) conclBullets.push(aten.bullets[0]);
  const conclText = humanizeAnswer(`${clean} importância`, passages, snippets, { boost: ["importância", "conclusão", "portanto", "fundamental"], exclude: [...usedSentences] });
  if (conclText) conclBullets.push(...toBullets(conclText).slice(0, 2));
  conclBullets.push(infantil
    ? "Cuidar dos dentinhos desde cedo garante sorrisos saudáveis para a vida toda."
    : `Por isso, ${clean} é um tema fundamental na odontologia, unindo conhecimento teórico e cuidado com o paciente.`);
  slides.push({ type: "content", title: "Conclusão", bullets: conclBullets.slice(0, 5), style });
  // Imagens: tema infantil usa as ilustrações geradas; os demais usam o Commons.
  const contentSlides = slides.filter((s) => s.type === "content");
  if (infantil) {
    const usedKeys = new Set();
    for (const sl of contentSlides) {
      const img = pickIlustracao(sl, usedKeys);
      if (img) sl.image = img;
    }
  } else {
    const images = await commonsImages(clean, Math.min(5, contentCount));
    const nContent = slides.length - 1;
    images.forEach((img, i) => {
      const si = 1 + (i % nContent);
      if (!slides[si].image) slides[si].image = img;
    });
  }
  slides.push({
    type: "refs",
    title: "Referências",
    style,
    refs: results.slice(0, 6).map((r) => ({ title: r.title || r.url, url: r.url })),
  });
  return slides;
}

// Temas visuais do seminário
const THEMES = {
  moderno: {
    primary: "#0e7f8f", dark: "#0a4f5c", accent: "#f5a623",
    gray: "#2f3a40", lightGray: "#5b6b72", faint: "#9fb3b8",
    subtitle: "#ffe9c4", link: "#1565c0",
  },
  formal: {
    primary: "#1a365d", dark: "#122a4a", accent: "#c9a227",
    gray: "#333333", lightGray: "#666666", faint: "#999999",
    subtitle: "#e8d9a0", link: "#1a56db",
  },
  animado: {
    primary: "#6d28d9", dark: "#4c1d95", accent: "#fb7185",
    gray: "#2f3a40", lightGray: "#5b6b72", faint: "#b9a8e0",
    subtitle: "#ffe4ec", link: "#7c3aed",
  },
};
function themeOf(seminar) {
  const base = THEMES[seminar && seminar.style] || THEMES.moderno;
  const bg = seminar && seminar.bg && SEMINAR_BACKGROUNDS[seminar.bg];
  if (!bg) return { ...base, coverText: "#ffffff" };
  if (bg.image) return { ...INFANTIL_THEME };
  if (!bg.primary) return { ...base, coverText: "#ffffff" };
  return { ...base, primary: bg.primary, dark: bg.dark, accent: bg.accent, subtitle: bg.subtitle, coverText: bg.coverText };
}

// Fontes disponíveis: o PDF usa as fontes embutidas do PDFKit (a mais
// próxima quando o nome exato não existe embutido); o PPTX usa o nome da
// fonte, que o PowerPoint aplica se estiver instalada na máquina.
export const SEMINAR_FONTS = {
  padrao:   { label: "Padrão (sem serifa)", pdf: "Helvetica", pdfBold: "Helvetica-Bold", pptx: "Calibri" },
  serifada: { label: "Serifada (Times)", pdf: "Times-Roman", pdfBold: "Times-Bold", pptx: "Times New Roman" },
  georgia:  { label: "Georgia (serifada elegante)", pdf: "Times-Roman", pdfBold: "Times-Bold", pptx: "Georgia" },
  verdana:  { label: "Verdana (larga e legível)", pdf: "Helvetica", pdfBold: "Helvetica-Bold", pptx: "Verdana" },
  courier:  { label: "Monoespaçada (Courier)", pdf: "Courier", pdfBold: "Courier-Bold", pptx: "Courier New" },
  comic:    { label: "Divertida (Comic Sans)", pdf: "Helvetica", pdfBold: "Helvetica-Bold", pptx: "Comic Sans MS" },
};
function fontOf(seminar) {
  return SEMINAR_FONTS[seminar && seminar.font] || SEMINAR_FONTS.padrao;
}

// Fundos da apresentação: substituem as cores do estilo na capa e nos
// detalhes (barras, títulos). "Padrão do estilo" mantém as cores do estilo.
// Os fundos infantis usam as imagens geradas (public/fundos.json, data URI)
// como fundo da capa e marca d'água nos demais slides.
export const SEMINAR_BACKGROUNDS = {
  padrao: { label: "Padrão do estilo" },
  roxo:   { label: "Roxo", primary: "#6d28d9", dark: "#4c1d95", accent: "#f59e0b", subtitle: "#ede9fe", coverText: "#ffffff" },
  azul:   { label: "Azul escuro", primary: "#1e40af", dark: "#172554", accent: "#f59e0b", subtitle: "#dbeafe", coverText: "#ffffff" },
  verde:  { label: "Verde", primary: "#166534", dark: "#14532d", accent: "#facc15", subtitle: "#dcfce7", coverText: "#ffffff" },
  vinho:  { label: "Vinho", primary: "#881337", dark: "#4c0519", accent: "#fbbf24", subtitle: "#ffe4e6", coverText: "#ffffff" },
  cinza:  { label: "Cinza escuro", primary: "#374151", dark: "#111827", accent: "#f59e0b", subtitle: "#e5e7eb", coverText: "#ffffff" },
  claro:  { label: "Claro (lilás)", primary: "#e9d5ff", dark: "#d8b4fe", accent: "#8e24aa", subtitle: "#581c87", coverText: "#2a0a33" },
  "infantil-1":  { label: "Infantil 1: dentes felizes e escovas coloridas no lilás", image: "infantil-1" },
  "infantil-2":  { label: "Infantil 2: céu com nuvens e arco-íris", image: "infantil-2" },
  "infantil-3":  { label: "Infantil 3: bichinhos escovando dentes no verde menta", image: "infantil-3" },
  "infantil-4":  { label: "Infantil 4: rosa com balões e lanchinhos saudáveis", image: "infantil-4" },
  "infantil-5":  { label: "Infantil 5: amarelo com sol sorrindo e dentes de óculos de sol", image: "infantil-5" },
  "infantil-6":  { label: "Infantil 6: fundo do mar com peixinhos e dente mergulhador", image: "infantil-6" },
  "infantil-7":  { label: "Infantil 7: dinossauros fofos escovando os dentes no laranja", image: "infantil-7" },
  "infantil-8":  { label: "Infantil 8: espaço roxo com dente astronauta", image: "infantil-8" },
  "infantil-9":  { label: "Infantil 9: floresta encantada com bichinhos", image: "infantil-9" },
  "infantil-10": { label: "Infantil 10: mundo dos doces com dente super-herói", image: "infantil-10" },
};

// Paleta legível usada com os fundos infantis (títulos em negrito escuro,
// para o texto ficar visível sobre a ilustração)
const INFANTIL_THEME = {
  primary: "#4a148c", dark: "#2a0a33", accent: "#8e24aa",
  gray: "#2f3a40", lightGray: "#5b6b72", faint: "#9fb3b8",
  subtitle: "#6a1b9a", link: "#1565c0", coverText: "#2a0a33",
};

let _fundosCache = null;
function bgImageDataUri(seminar) {
  const key = seminar && seminar.bg;
  if (!key || !String(key).startsWith("infantil-")) return null;
  try {
    if (!_fundosCache) {
      const p = path.join(path.dirname(fileURLToPath(import.meta.url)), "public", "fundos.json");
      _fundosCache = JSON.parse(fs.readFileSync(p, "utf8"));
    }
    return _fundosCache[key] || null;
  } catch { return null; }
}
function bgImageBuffer(seminar) {
  const uri = bgImageDataUri(seminar);
  if (!uri) return null;
  try { return Buffer.from(uri.split(",")[1], "base64"); } catch { return null; }
}

function roundImagePdf(doc, buf, x, y, w, h, r) {
  doc.save();
  doc.roundedRect(x, y, w, h, r).clip();
  try { doc.image(buf, x, y, { cover: [w, h] }); } catch { doc.image(buf, x, y, { fit: [w, h] }); }
  doc.restore();
}

export async function exportSeminarPdf(seminar, destPath) {
  const slides = seminar.slides || [];
  const T = themeOf(seminar);
  const F = fontOf(seminar);
  const coverText = T.coverText || "#ffffff";
  const bgImg = bgImageBuffer(seminar);
  const W = 841.89, H = 595.28; // A4 paisagem em pontos
  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 0 });
  const stream = fs.createWriteStream(destPath);
  doc.pipe(stream);
  const footer = (n) => {
    doc.font(F.pdf).fillColor(T.faint).fontSize(9)
      .text(`${n} / ${slides.length}`, W - 100, H - 30, { width: 60, align: "right" });
    doc.fillColor("#000000");
  };
  for (let i = 0; i < slides.length; i++) {
    const s = slides[i];
    if (i > 0) doc.addPage();
    doc.font(F.pdf);
    if (s.type === "title") {
      if (bgImg) {
        // Capa com fundo infantil: ilustração em tela cheia + cartão branco
        // translúcido no centro, para o texto ficar legível e organizado
        doc.image(bgImg, 0, 0, { cover: [W, H] });
        doc.opacity(0.85).fillColor("#ffffff").roundedRect(60, 60, W - 120, H - 120, 24).fill();
        doc.opacity(1);
        if (seminar.institution) {
          doc.font(F.pdfBold).fillColor(T.coverText).fontSize(16)
            .text(seminar.institution, 60, 80, { width: W - 120, align: "center" });
        }
        doc.font(F.pdfBold).fillColor(T.coverText).fontSize(50)
          .text(s.title || "", 60, H / 2 - 110, { width: W - 120, align: "center" });
        doc.roundedRect(W / 2 - 40, H / 2 - 20, 80, 6, 3).fill(T.accent);
        doc.font(F.pdf).fillColor(T.subtitle).fontSize(20)
          .text(s.subtitle || "Seminário — Odontologia", 60, H / 2 + 10, { width: W - 120, align: "center" });
        let yMeta = H / 2 + 70;
        if (seminar.subject) {
          doc.font(F.pdfBold).fillColor(T.coverText).fontSize(15)
            .text(`MATÉRIA: ${seminar.subject}`, 60, yMeta, { width: W - 120, align: "center" });
          yMeta += 28;
        }
        if (seminar.students) {
          doc.font(F.pdf).fillColor(T.coverText).fontSize(13)
            .text(seminar.students, 60, H - 140, { width: W - 120, align: "center" });
        }
        if (seminar.teacher) {
          doc.font(F.pdf).fillColor(T.coverText).fontSize(13)
            .text(`PROFESSOR(A): ${seminar.teacher}`, 60, H - 110, { width: W - 120, align: "center" });
        }
        doc.fillColor("#000000");
      } else {
        // Capa: degradê com círculos decorativos + dados da capa (maiúsculas)
        const grad = doc.linearGradient(0, 0, W, H);
        grad.stop(0, T.primary).stop(1, T.dark);
        doc.rect(0, 0, W, H).fill(grad);
        doc.opacity(0.07).fillColor("#ffffff");
        doc.circle(W - 100, 110, 190).fill();
        doc.circle(110, H - 90, 130).fill();
        doc.circle(W - 320, H - 60, 70).fill();
        doc.opacity(1);
        if (seminar.institution) {
          doc.font(F.pdfBold).fillColor(coverText).fontSize(16)
            .text(seminar.institution, 60, 56, { width: W - 120, align: "center" });
        }
        doc.font(F.pdfBold).fillColor(coverText).fontSize(50)
          .text(s.title || "", 60, H / 2 - 110, { width: W - 120, align: "center" });
        doc.roundedRect(W / 2 - 40, H / 2 - 20, 80, 6, 3).fill(T.accent);
        doc.font(F.pdf).fillColor(T.subtitle).fontSize(20)
          .text(s.subtitle || "Seminário — Odontologia", 60, H / 2 + 10, { width: W - 120, align: "center" });
        let yMeta = H / 2 + 70;
        if (seminar.subject) {
          doc.font(F.pdfBold).fillColor(coverText).fontSize(15)
            .text(`MATÉRIA: ${seminar.subject}`, 60, yMeta, { width: W - 120, align: "center" });
          yMeta += 28;
        }
        if (seminar.students) {
          doc.font(F.pdf).fillColor(coverText).fontSize(13)
            .text(seminar.students, 60, H - 92, { width: W - 120, align: "center" });
        }
        if (seminar.teacher) {
          doc.font(F.pdf).fillColor(coverText).fontSize(13)
            .text(`PROFESSOR(A): ${seminar.teacher}`, 60, H - 62, { width: W - 120, align: "center" });
        }
        doc.fillColor("#000000");
      }
    } else if (s.type === "refs") {
      if (bgImg) { doc.opacity(0.12); doc.image(bgImg, 0, 0, { cover: [W, H] }); doc.opacity(1); }
      doc.font(F.pdfBold).fillColor(T.primary).fontSize(30).text(s.title || "Referências", 60, 48, { width: W - 120 });
      doc.roundedRect(60, 96, 72, 6, 3).fill(T.accent);
      let y = 130;
      for (const r of s.refs || []) {
        doc.font(F.pdf).fillColor(T.link).fontSize(12).text(`${r.title || r.url}`, 60, y, { link: r.url, underline: true, width: W - 120 });
        y = doc.y + 3;
        doc.fillColor(T.lightGray).fontSize(9).text(r.url, 60, y, { link: r.url, width: W - 120 });
        y = doc.y + 12;
        if (y > H - 60) break;
      }
      doc.fillColor("#000000");
      footer(i + 1);
    } else {
      // Slide de conteúdo: fundo infantil vira marca d'água, para o texto
      // (título em negrito) ficar legível e a leitura organizada
      if (bgImg) { doc.opacity(0.12); doc.image(bgImg, 0, 0, { cover: [W, H] }); doc.opacity(1); }
      doc.font(F.pdfBold).fillColor(T.primary).fontSize(32).text(s.title || "", 60, 44, { width: W - 120 });
      doc.roundedRect(60, 96, 72, 6, 3).fill(T.accent);
      const hasImg = !!(s.image && s.image.url);
      const textW = hasImg ? W - 480 : W - 120;
      let imgBuf = null;
      if (hasImg) {
        try { imgBuf = (await fetchImage(s.image.url)).buf; } catch { /* sem imagem */ }
      }
      if (imgBuf) roundImagePdf(doc, imgBuf, W - 400, 140, 340, 340, 22);
      let y = 140;
      doc.font(F.pdf).fontSize(14);
      for (const b of s.bullets || []) {
        doc.fillColor(T.accent).text("\u2022", 60, y);
        doc.fillColor(T.gray).text(b, 88, y, { width: textW - 60 });
        y = doc.y + 16;
        if (y > H - 70) break;
      }
      doc.fillColor("#000000");
      footer(i + 1);
    }
  }
  doc.end();
  await new Promise((res, rej) => { stream.on("finish", res); stream.on("error", rej); });
}

export async function exportSeminarPptx(seminar, destPath) {
  const slides = seminar.slides || [];
  const T = themeOf(seminar);
  const F = fontOf(seminar);
  const coverText = (T.coverText || "#ffffff").slice(1);
  const bgUri = bgImageDataUri(seminar);
  const pptx = new pptxgen();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "Odontologia";
  const footer = (slide, n) => {
    slide.addText(`${n} / ${slides.length}`, { x: 12.1, y: 6.85, w: 1, h: 0.3, fontSize: 9, fontFace: F.pptx, color: T.faint.slice(1), align: "right" });
  };
  const accentBar = (slide, x, y, w) => {
    slide.addText("", { x, y, w, h: 0.09, fill: { color: T.accent.slice(1) } });
  };
  // Fundo infantil em tela cheia + véu branco, para o texto ficar legível
  const bgWatermark = (slide, transparency) => {
    if (!bgUri) return;
    slide.addImage({ data: bgUri, x: 0, y: 0, w: 13.33, h: 7.5 });
    slide.addShape(pptx.shapes.RECTANGLE, { x: 0, y: 0, w: 13.33, h: 7.5, fill: { color: "FFFFFF", transparency }, line: { type: "none" } });
  };
  for (let idx = 0; idx < slides.length; idx++) {
    const s = slides[idx];
    const n = idx + 1;
    const slide = pptx.addSlide();
    if (s.type === "title") {
      if (bgUri) {
        slide.addImage({ data: bgUri, x: 0, y: 0, w: 13.33, h: 7.5 });
        slide.addShape(pptx.shapes.ROUNDED_RECTANGLE, { x: 0.7, y: 0.6, w: 11.93, h: 6.3, fill: { color: "FFFFFF", transparency: 15 }, line: { type: "none" } });
      } else {
        slide.background = { color: T.primary.slice(1) };
      }
      if (seminar.institution) {
        slide.addText(seminar.institution, { x: 0.5, y: 0.4, w: 12.33, h: 0.6, fontSize: 16, bold: true, fontFace: F.pptx, align: "center", color: coverText });
      }
      slide.addText(s.title || "", { x: 0.5, y: 1.9, w: 12.33, h: 1.8, fontSize: 46, bold: true, fontFace: F.pptx, align: "center", color: coverText });
      accentBar(slide, 6.16, 3.75, 1.0);
      slide.addText(s.subtitle || "Seminário — Odontologia", { x: 0.5, y: 4.05, w: 12.33, h: 0.8, fontSize: 20, fontFace: F.pptx, align: "center", color: T.subtitle.slice(1) });
      if (seminar.subject) {
        slide.addText(`MATÉRIA: ${seminar.subject}`, { x: 0.5, y: 5.0, w: 12.33, h: 0.5, fontSize: 15, bold: true, fontFace: F.pptx, align: "center", color: coverText });
      }
      if (seminar.students) {
        slide.addText(seminar.students, { x: 0.5, y: 6.2, w: 12.33, h: 0.4, fontSize: 13, fontFace: F.pptx, align: "center", color: coverText });
      }
      if (seminar.teacher) {
        slide.addText(`PROFESSOR(A): ${seminar.teacher}`, { x: 0.5, y: 6.55, w: 12.33, h: 0.4, fontSize: 13, fontFace: F.pptx, align: "center", color: coverText });
      }
    } else if (s.type === "refs") {
      if (bgUri) bgWatermark(slide, 25);
      else slide.background = { color: "FFFFFF" };
      slide.addText(s.title || "Referências", { x: 0.6, y: 0.35, w: 12, h: 0.8, fontSize: 30, bold: true, fontFace: F.pptx, color: T.primary.slice(1) });
      accentBar(slide, 0.6, 1.18, 1.0);
      const items = (s.refs || []).map((r) => ({
        text: r.title || r.url,
        options: { hyperlink: { url: r.url }, fontSize: 13, fontFace: F.pptx, color: T.link.slice(1) },
      }));
      if (items.length) slide.addText(items, { x: 0.6, y: 1.6, w: 12.1, h: 5, valign: "top", lineSpacingMultiple: 1.25, color: T.gray.slice(1) });
      footer(slide, n);
    } else {
      if (bgUri) bgWatermark(slide, 25);
      else slide.background = { color: "FFFFFF" };
      slide.addText(s.title || "", { x: 0.6, y: 0.35, w: 12, h: 0.8, fontSize: 30, bold: true, fontFace: F.pptx, color: T.primary.slice(1) });
      accentBar(slide, 0.6, 1.18, 1.0);
      let textW = 12.1;
      if (s.image && s.image.url) {
        try {
          const { buf, mime } = await fetchImage(s.image.url);
          slide.addImage({ data: `${mime};base64,${buf.toString("base64")}`, x: 8.9, y: 1.6, w: 3.8, h: 3.8 });
          textW = 7.9;
        } catch { /* segue sem a imagem */ }
      }
      const paras = [];
      for (const b of s.bullets || []) {
        paras.push({ text: "\u2022  ", options: { color: T.accent.slice(1), fontSize: 15, fontFace: F.pptx } });
        paras.push({ text: b, options: { color: T.gray.slice(1), fontSize: 15, fontFace: F.pptx, breakLine: true, paragraphGap: 12 } });
      }
      if (paras.length) slide.addText(paras, { x: 0.6, y: 1.6, w: textW, h: 5.1, valign: "top" });
      footer(slide, n);
    }
  }
  await pptx.writeFile({ fileName: destPath });
}
