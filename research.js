// Pesquisa inteligente: busca questões na internet, extrai evidências e sugere respostas.
// Sem dependências externas: usa fetch nativo + DuckDuckGo (fallback: Bing).

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export function normalize(text) {
  return (text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function keywords(text, minLen = 4) {
  return normalize(text)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= minLen);
}

function stripTags(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchText(url, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": UA, "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8" },
      signal: ctrl.signal,
      redirect: "follow",
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } finally {
    clearTimeout(t);
  }
}

function decodeDdg(href) {
  try {
    const m = href.match(/[?&]uddg=([^&]+)/);
    if (m) return decodeURIComponent(m[1]);
    if (href.startsWith("//")) return "https:" + href;
    return href;
  } catch {
    return href;
  }
}

// O Bing passou a embrulhar os resultados em redirects /ck/a com a URL real
// em base64 no parâmetro "u" (prefixo de versão "a1"). Sem decodificar, todos
// os resultados caíam no filtro de bing.com e a busca voltava vazia.
function decodeBing(href) {
  try {
    const raw = String(href).replace(/&amp;/g, "&");
    const m = raw.match(/[?&]u=([^&]+)/);
    if (!m) return href;
    const u = decodeURIComponent(m[1]);
    const tryDecode = (s) => {
      try {
        const dec = Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
        return /^https?:\/\//.test(dec) ? dec : null;
      } catch {
        return null;
      }
    };
    return tryDecode(u) || tryDecode(u.slice(2)) || href;
  } catch {
    return href;
  }
}

async function ddgSearch(query, maxResults) {
  const html = await fetchText(
    "https://html.duckduckgo.com/html/?q=" + encodeURIComponent(query)
  );
  const hrefs = [...html.matchAll(/class="result__a"[^>]*href="([^"]+)"/g)];
  const titles = [...html.matchAll(/class="result__a"[^>]*>([\s\S]*?)<\/a>/g)];
  const snippets = [...html.matchAll(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)];
  const out = [];
  for (let i = 0; i < hrefs.length && out.length < maxResults; i++) {
    const url = decodeDdg(hrefs[i][1]);
    if (!/^https?:\/\//.test(url)) continue;
    out.push({
      title: stripTags(titles[i]?.[1] || "").slice(0, 160),
      url,
      snippet: stripTags(snippets[i]?.[1] || "").slice(0, 400),
    });
  }
  if (!out.length) throw new Error("DDG sem resultados");
  return out;
}

async function bingSearch(query, maxResults) {
  const html = await fetchText(
    "https://www.bing.com/search?q=" + encodeURIComponent(query) + "&setlang=pt-BR"
  );
  const out = [];
  const re =
    /<li class="b_algo"[\s\S]*?<h2>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<div class="b_caption">[\s\S]*?<p>([\s\S]*?)<\/p>)?/g;
  let m;
  while ((m = re.exec(html)) && out.length < maxResults) {
    const url = decodeBing(m[1]);
    if (!/^https?:\/\//.test(url) || /bing\.com|microsoft\.com/.test(url)) continue;
    out.push({
      title: stripTags(m[2]).slice(0, 160),
      url,
      snippet: stripTags(m[3] || "").slice(0, 400),
    });
  }
  if (!out.length) throw new Error("Bing sem resultados");
  return out;
}

export async function searchWeb(query, maxResults = 6) {
  const q = query.length > 300 ? query.slice(0, 300) : query;
  // Caminho confiável: Brave Search API (chave gratuita em https://brave.com/search/api/)
  if (process.env.BRAVE_API_KEY) {
    try {
      return await braveSearch(q, maxResults);
    } catch {
      /* cai para o scraping */
    }
  }
  try {
    return await ddgSearch(q, maxResults);
  } catch (e1) {
    try {
      return await bingSearch(q, maxResults);
    } catch (e2) {
      return [];
    }
  }
}

async function braveSearch(query, maxResults) {
  const r = await fetch(
    "https://api.search.brave.com/res/v1/web/search?q=" +
      encodeURIComponent(query) +
      "&count=" +
      maxResults +
      "&country=BR&search_lang=pt-br",
    {
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": process.env.BRAVE_API_KEY,
      },
    }
  );
  if (!r.ok) throw new Error(`Brave HTTP ${r.status}`);
  const data = await r.json();
  const items = (data.web && data.web.results) || [];
  return items.slice(0, maxResults).map((it) => ({
    title: (it.title || "").slice(0, 160),
    url: it.url,
    snippet: (it.description || "").slice(0, 400),
  }));
}

// Extrai os trechos da página mais relevantes para a pergunta.
export async function pageEvidence(url, queryTokens, maxChars = 900) {
  try {
    const html = await fetchText(url, 12000);
    const text = stripTags(html);
    if (text.length < 200) return "";
    const sentences = text.match(/[^.!?…\n]{20,400}[.!?…]/g) || [];
    // descarta navegação/cabeçalhos de site antes de pontuar
    const JUNK = /min read|back to home|on this page|published by|last updated|skip to content|todos os direitos reservados|all rights reserved|aceitar cookies|faça login|cadastre-se/i;
    const scored = sentences
      .filter((s) => !JUNK.test(s))
      .map((s) => {
        const toks = keywords(s);
        const hits = queryTokens.filter((t) => toks.includes(t)).length;
        return { s: s.trim(), hits };
      })
      .filter((x) => x.hits >= 2)
      .sort((a, b) => b.hits - a.hits)
      .slice(0, 3);
    return scored
      .map((x) => x.s)
      .join(" ")
      .slice(0, maxChars);
  } catch {
    return "";
  }
}

function scoreAlternative(sentences, qTokens, optionText) {
  const toks = [...new Set(keywords(optionText))];
  if (!toks.length) return 0;
  // Pontua ocorrências da alternativa em frases que também contêm termos da pergunta:
  // a resposta certa costuma aparecer JUNTO do assunto (ex.: "pilocarpina ... causa miose").
  let score = 0;
  for (const s of sentences) {
    const stoks = keywords(s);
    const qhits = qTokens.filter((t) => stoks.includes(t)).length;
    if (qhits === 0) continue;
    for (const t of toks) {
      const occ = stoks.filter((x) => x === t).length;
      score += Math.min(occ, 3) * qhits * (t.length >= 6 ? 2 : 1);
    }
  }
  return score / Math.max(toks.length, 1);
}

function splitSentences(text) {
  return (text.match(/[^.!?…\n]{15,500}[.!?…]/g) || [])
    .map((s) =>
      s
        .replace(/<[^>]*>/g, " ")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#0?39;/g, "'")
        .replace(/\s+/g, " ")
        .trim()
    )
    .filter((s) => !/[<>]/.test(s))
    .filter(Boolean);
}

function sentenceSimilarity(a, b) {
  const A = new Set(keywords(a));
  const B = new Set(keywords(b));
  if (!A.size || !B.size) return 0;
  const inter = [...A].filter((t) => B.has(t)).length;
  return inter / Math.min(A.size, B.size);
}

function isDefinitional(sentence) {
  return /(^|\s)(é|são|define-se|consiste em|significa|trata-se de|caracteriza-se por)\s/i.test(sentence);
}

// Redige a resposta como uma explicação humanizada (tom de aluno explicando ao
// professor), costurando as frases mais relevantes das fontes com conectivos.
// opts.boost: termos que ganham prioridade (ex.: focos diferentes de um seminário).
export function humanizeAnswer(questionText, passages, snippets, opts = {}) {
  const qTokens = [...new Set(keywords(questionText))].slice(0, 24);
  const boost = [...new Set((opts.boost || []).flatMap((b) => keywords(b)))];
  const exclude = new Set(opts.exclude || []);
  const candidates = [];
  for (const p of [...passages, ...snippets]) {
    for (const s of splitSentences(p)) {
      const toks = keywords(s);
      if (toks.length < 4) continue;
      if (exclude.has(s.slice(0, 50).toLowerCase())) continue; // frase já usada em outro slide
      // lixo comum de sites (navegação, cookies, avisos)
      if (/pedir cita|ir al contenido|aviso legal|pol.tica de privac|todos los derechos|all rights reserved|cookie policy|aceitar cookies/i.test(s)) continue;
      const hits = qTokens.filter((t) => toks.includes(t)).length;
      if (hits < 2 && !(isDefinitional(s) && hits >= 1)) continue;
      const bHits = boost.filter((t) => toks.includes(t)).length;
      candidates.push({ s, hits, bHits });
    }
  }
  // ordena (definidoras primeiro, depois ênfase do tópico) e remove redundâncias
  const ranked = candidates.sort((a, b) => {
    const ad = isDefinitional(a.s) ? 1 : 0;
    const bd = isDefinitional(b.s) ? 1 : 0;
    return bd - ad || b.bHits - a.bHits || b.hits - a.hits;
  });
  const picked = [];
  for (const c of ranked) {
    if (picked.length >= 6) break;
    if (picked.some((p) => sentenceSimilarity(p.s, c.s) > 0.6)) continue;
    picked.push(c);
  }
  if (!picked.length) return "";
  const ordered = picked.slice(0, 5).map((p) => p.s);
  const connectors = ["Além disso, ", "Isso acontece porque ", "Na prática, ", "Vale destacar que "];
  let out = ordered[0].charAt(0).toUpperCase() + ordered[0].slice(1);
  for (let i = 1; i < ordered.length; i++) {
    let s = ordered[i].charAt(0).toLowerCase() + ordered[i].slice(1);
    if (/^(além disso|isso|na prática|vale)/i.test(s)) {
      out += " " + s.charAt(0).toUpperCase() + s.slice(1);
    } else {
      out += " " + connectors[(i - 1) % connectors.length] + s;
    }
  }
  return out;
}

export async function researchQuestion({ text, type = "discursiva", options = [] }) {
  const clean = (text || "").trim();
  if (!clean) return { error: "Questão vazia." };

  // Na objetiva, incluir as alternativas na busca: queremos páginas que falem delas
  let query = clean;
  if (type === "objetiva" && options.length >= 2) {
    query = `${clean} ${options.join(" ")}`;
  }
  if (query.length > 300) query = query.slice(0, 300);

  let results = await searchWeb(query, 6);

  // Se a busca voltou fraca, tenta de novo só com as palavras mais distintivas
  if (!results.length) {
    const distinctive = [...new Set(keywords(clean))].sort((a, b) => b.length - a.length).slice(0, 8).join(" ");
    if (distinctive) results = await searchWeb(distinctive, 6);
  }
  // Últimas tentativas após pausas progressivas (contorna rate-limit transitório)
  for (const wait of [8000, 20000]) {
    if (results.length) break;
    await sleep(wait);
    results = await searchWeb(query, 6);
  }
  if (!results.length) {
    return { error: "Não foi possível pesquisar na internet agora. Tente novamente." };
  }

  const qTokens = [...new Set(keywords(clean))].slice(0, 24);

  // Aprofunda nos 2 primeiros resultados
  const deep = [];
  for (const r of results.slice(0, 2)) {
    const ev = await pageEvidence(r.url, qTokens);
    if (ev) deep.push({ ...r, passage: ev });
    await sleep(600);
  }

  const evidenceText = [
    ...results.map((r) => `${r.title}. ${r.snippet}`),
    ...deep.map((d) => d.passage),
  ].join("\n");

  const evidence = results.map((r, i) => ({
    title: r.title,
    url: r.url,
    snippet: r.snippet,
    passage: deep.find((d) => d.url === r.url)?.passage || "",
  }));

  if (type === "objetiva" && options.length >= 2) {
    const sentences = splitSentences(evidenceText);
    const scores = options.map((opt, i) => ({
      letter: "ABCDE"[i] || `?${i}`,
      option: opt,
      score: Math.round(scoreAlternative(sentences, qTokens, opt) * 100) / 100,
    }));
    const ranked = [...scores].sort((a, b) => b.score - a.score);
    const top = ranked[0];
    const second = ranked[1];
    let confidence = 0;
    if (top.score > 0) {
      confidence = second.score > 0
        ? Math.min(95, Math.round((top.score / (top.score + second.score)) * 100))
        : 90;
    }
    // Justificativa (padrão de resolução): por que a vencedora está certa,
    // com as frases das fontes que a sustentam — e quais alternativas não
    // tiveram sustentação nenhuma.
    let justification = "";
    if (top.score > 0) {
      const winToks = [...new Set(keywords(top.option))].filter((t) => t.length >= 4);
      const support = sentences
        .filter((s) => {
          const st = new Set(keywords(s));
          return winToks.some((t) => st.has(t)) && qTokens.some((t) => st.has(t));
        })
        .slice(0, 2);
      if (support.length) justification = support.join(" ");
      const zeroed = ranked.filter((r) => r !== top && r.score === 0).map((r) => r.letter);
      if (zeroed.length) {
        justification += (justification ? " " : "") +
          `As alternativas ${zeroed.join(", ")} não tiveram sustentação nas fontes pesquisadas.`;
      }
    }
    return {
      type,
      suggested: top.score > 0 ? top.letter : null,
      suggested_text: top.score > 0 ? top.option : null,
      confidence,
      ranking: ranked,
      justification,
      evidence,
      note:
        top.score > 0
          ? "Sugestão baseada no cruzamento das fontes abaixo. Confira antes de considerar definitivo."
          : "As fontes não foram conclusivas para apontar uma alternativa.",
    };
  }

  // Discursiva: redige uma explicação humanizada (tom de aluno explicando ao
  // professor) a partir das frases mais relevantes das fontes.
  const passages = deep.map((d) => d.passage).filter(Boolean);
  const snippetTexts = results.map((r) => r.snippet).filter(Boolean);
  let bestAnswer = humanizeAnswer(clean, passages, snippetTexts);
  if (!bestAnswer) {
    bestAnswer = [...passages, ...snippetTexts].join("\n\n").slice(0, 1200);
  }
  // Versão curta para decorar: as 2 primeiras frases da resposta elaborada
  const curta = (bestAnswer.match(/[^.!?…]+[.!?…]/g) || [bestAnswer]).slice(0, 2).join(" ").trim();

  return {
    type,
    suggested: bestAnswer ? "resposta-elaborada" : null,
    suggested_text: bestAnswer,
    suggested_short: curta,
    confidence: bestAnswer ? 75 : 0,
    evidence,
    note: "Resposta redigida em linguagem natural a partir das fontes pesquisadas abaixo.",
  };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
