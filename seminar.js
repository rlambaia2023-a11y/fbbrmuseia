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
  protese: ["denture", "prosthesis"], proteses: ["denture", "prosthesis"],
  aparelho: ["braces"], radiografia: ["radiograph", "x-ray"], radiografias: ["radiograph", "x-ray"],
  cirurgia: ["surgery"], restauracao: ["restoration", "filling"], restauracoes: ["restoration", "filling"],
  endodontia: ["endodontics"], periodontia: ["periodontics"], ortodontia: ["orthodontics"],
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

function toBullets(text, max = 4) {
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
  { title: "Na prática clínica", q: (c) => `${c} tratamento aplicação clínica`, boost: ["clínica", "tratamento", "técnica", "procedimento", "indicação"] },
  { title: "Pontos de atenção", q: (c) => `${c} cuidados`, boost: ["cuidado", "atenção", "complicação", "risco", "contraindicação"] },
  { title: "Cuidados e manutenção", q: (c) => `${c} manutenção higiene cuidados`, boost: ["manutenção", "higiene", "cuidado", "durabilidade", "limpeza"] },
  { title: "Avanços e atualidades", q: (c) => `${c} avanços novidades tecnologia`, boost: ["avanço", "novo", "tecnologia", "atual", "inovação"] },
];

export async function generateSeminar(theme, opts = {}) {
  const clean = String(theme || "").trim();
  if (clean.length < 3) throw new Error("Informe um tema para o seminário.");
  const style = SEMINAR_STYLES.includes(opts.style) ? opts.style : "moderno";
  const total = Math.min(10, Math.max(4, parseInt(opts.slideCount, 10) || 7));
  const contentCount = total - 2; // sem capa e sem referências

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
  const addSection = (title, q, boost) => {
    const text = humanizeAnswer(q, passages, snippets, { boost, exclude: [...usedSentences] });
    (text.match(/[^.!?…]+[.!?…]/g) || []).forEach((s) => usedSentences.add(s.slice(0, 50).toLowerCase()));
    slides.push({
      type: "content",
      title,
      bullets: toBullets(text || "Conteúdo em elaboração a partir das fontes pesquisadas."),
      style,
    });
  };
  addSection("Introdução", `o que é ${clean}`, ["é", "define", "conceito", "consiste"]);
  for (const m of MIDDLE_SECTIONS.slice(0, Math.max(0, contentCount - 2))) {
    addSection(m.title, m.q(clean), m.boost);
  }
  addSection("Conclusão", `${clean} importância`, ["importância", "conclusão", "portanto", "fundamental"]);
  const images = await commonsImages(clean, Math.min(5, contentCount));
  const nContent = slides.length - 1;
  images.forEach((img, i) => {
    const si = 1 + (i % nContent);
    if (!slides[si].image) slides[si].image = img;
  });
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
  const s = seminar && seminar.style;
  return THEMES[s] || THEMES.moderno;
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
  const W = 841.89, H = 595.28; // A4 paisagem em pontos
  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 0 });
  const stream = fs.createWriteStream(destPath);
  doc.pipe(stream);
  const footer = (n) => {
    doc.fillColor(T.faint).fontSize(9)
      .text(`${n} / ${slides.length}`, W - 100, H - 30, { width: 60, align: "right" });
    doc.fillColor("#000000");
  };
  for (let i = 0; i < slides.length; i++) {
    const s = slides[i];
    if (i > 0) doc.addPage();
    if (s.type === "title") {
      // Capa: degradê teal com círculos decorativos
      const grad = doc.linearGradient(0, 0, W, H);
      grad.stop(0, T.primary).stop(1, T.dark);
      doc.rect(0, 0, W, H).fill(grad);
      doc.opacity(0.07).fillColor("#ffffff");
      doc.circle(W - 100, 110, 190).fill();
      doc.circle(110, H - 90, 130).fill();
      doc.circle(W - 320, H - 60, 70).fill();
      doc.opacity(1);
      doc.fillColor("#ffffff").fontSize(50)
        .text(s.title || "", 60, H / 2 - 110, { width: W - 120, align: "center" });
      doc.roundedRect(W / 2 - 40, H / 2 - 20, 80, 6, 3).fill(T.accent);
      doc.fillColor(T.subtitle).fontSize(20)
        .text(s.subtitle || "Seminário — Odontologia", 60, H / 2 + 10, { width: W - 120, align: "center" });
      doc.fillColor("#000000");
    } else if (s.type === "refs") {
      doc.fillColor(T.primary).fontSize(30).text(s.title || "Referências", 60, 48, { width: W - 120 });
      doc.roundedRect(60, 96, 72, 6, 3).fill(T.accent);
      let y = 130;
      for (const r of s.refs || []) {
        doc.fillColor(T.link).fontSize(12).text(`${r.title || r.url}`, 60, y, { link: r.url, underline: true, width: W - 120 });
        y = doc.y + 3;
        doc.fillColor(T.lightGray).fontSize(9).text(r.url, 60, y, { link: r.url, width: W - 120 });
        y = doc.y + 12;
        if (y > H - 60) break;
      }
      doc.fillColor("#000000");
      footer(i + 1);
    } else {
      // Título em teal sobre fundo claro, sem faixa pesada
      doc.fillColor(T.primary).fontSize(32).text(s.title || "", 60, 44, { width: W - 120 });
      doc.roundedRect(60, 96, 72, 6, 3).fill(T.accent);
      const hasImg = !!(s.image && s.image.url);
      const textW = hasImg ? W - 480 : W - 120;
      let imgBuf = null;
      if (hasImg) {
        try { imgBuf = (await fetchImage(s.image.url)).buf; } catch { /* sem imagem */ }
      }
      if (imgBuf) roundImagePdf(doc, imgBuf, W - 400, 140, 340, 340, 22);
      let y = 140;
      doc.fontSize(14);
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
  const pptx = new pptxgen();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "Odontologia";
  const footer = (slide, n) => {
    slide.addText(`${n} / ${slides.length}`, { x: 12.1, y: 6.85, w: 1, h: 0.3, fontSize: 9, color: T.faint.slice(1), align: "right" });
  };
  const accentBar = (slide, x, y, w) => {
    slide.addText("", { x, y, w, h: 0.09, fill: { color: T.accent.slice(1) } });
  };
  for (let idx = 0; idx < slides.length; idx++) {
    const s = slides[idx];
    const n = idx + 1;
    const slide = pptx.addSlide();
    if (s.type === "title") {
      slide.background = { color: T.primary.slice(1) };
      slide.addText(s.title || "", { x: 0.5, y: 1.9, w: 12.33, h: 1.8, fontSize: 46, bold: true, align: "center", color: "FFFFFF" });
      accentBar(slide, 6.16, 3.75, 1.0);
      slide.addText(s.subtitle || "Seminário — Odontologia", { x: 0.5, y: 4.05, w: 12.33, h: 0.8, fontSize: 20, align: "center", color: T.subtitle.slice(1) });
    } else if (s.type === "refs") {
      slide.background = { color: "FFFFFF" };
      slide.addText(s.title || "Referências", { x: 0.6, y: 0.35, w: 12, h: 0.8, fontSize: 30, bold: true, color: T.primary.slice(1) });
      accentBar(slide, 0.6, 1.18, 1.0);
      const items = (s.refs || []).map((r) => ({
        text: r.title || r.url,
        options: { hyperlink: { url: r.url }, fontSize: 13, color: T.link.slice(1) },
      }));
      if (items.length) slide.addText(items, { x: 0.6, y: 1.6, w: 12.1, h: 5, valign: "top", lineSpacingMultiple: 1.25, color: T.gray.slice(1) });
      footer(slide, n);
    } else {
      slide.background = { color: "FFFFFF" };
      slide.addText(s.title || "", { x: 0.6, y: 0.35, w: 12, h: 0.8, fontSize: 30, bold: true, color: T.primary.slice(1) });
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
        paras.push({ text: "\u2022  ", options: { color: T.accent.slice(1), fontSize: 15 } });
        paras.push({ text: b, options: { color: T.gray.slice(1), fontSize: 15, breakLine: true, paragraphGap: 12 } });
      }
      if (paras.length) slide.addText(paras, { x: 0.6, y: 1.6, w: textW, h: 5.1, valign: "top" });
      footer(slide, n);
    }
  }
  await pptx.writeFile({ fileName: destPath });
}
