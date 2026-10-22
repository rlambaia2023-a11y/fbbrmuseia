// Lógica de correção automática das provas.

const STOPWORDS = new Set(
  ("a ao aos aquela aquelas aquele aqueles as ate com como da das de do dos e ela elas ele eles em entre era eram essa essas esse esses esta estas este estes foi foram ha isso isto mais mas me meu meus minha minhas muito na nas nao nem no nos nossa nossas nosso nossos o os ou para pela pelas pelo pelos por qual quando que quem se sem ser seu seus sua suas sobre tambem tem tendo teve terao uma umas uns voce voces seu da do").split(" ")
);

export function normalize(text) {
  return (text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function tokens(text) {
  return normalize(text)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 4 && !STOPWORDS.has(t));
}

export function extractKeywords(text, max = 12) {
  const freq = new Map();
  for (const t of tokens(text)) freq.set(t, (freq.get(t) || 0) + 1);
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([t]) => t);
}

function letterOf(text) {
  const m = normalize(text).match(/\b([a-e])\b/);
  return m ? m[1].toUpperCase() : normalize(text).trim().charAt(0).toUpperCase();
}

export function gradeObjective(question, responseText) {
  const expected = (question.answer_key || "").trim().toUpperCase();
  const got = letterOf(responseText);
  const correct = got === expected && expected !== "";
  const max = Number(question.weight) || 1;
  return {
    score: correct ? max : 0,
    max_score: max,
    feedback: correct
      ? `Correta. Alternativa ${expected}.`
      : `Incorreta. Você marcou "${got || "—"}"; o gabarito é a alternativa ${expected}.`,
  };
}

export function gradeDiscursive(question, responseText) {
  const max = Number(question.weight) || 1;
  const text = (responseText || "").trim();
  if (!text) {
    return { score: 0, max_score: max, feedback: "Questão em branco: 0 pontos." };
  }
  let expected = [];
  const kw = question.keywords;
  if (Array.isArray(kw)) {
    expected = kw;
  } else {
    try {
      expected = JSON.parse(kw || "[]");
    } catch { /* ignora */ }
  }
  if (!expected.length && question.model_answer) {
    expected = extractKeywords(question.model_answer);
  }
  const normResp = normalize(text);
  const matched = expected.filter((k) => normResp.includes(normalize(k)));
  const missing = expected.filter((k) => !normResp.includes(normalize(k)));
  const coverage = expected.length ? matched.length / expected.length : 0;
  const score = Math.round(max * coverage * 100) / 100;

  let feedback = `Cobertura de conceitos: ${matched.length}/${expected.length} (${Math.round(coverage * 100)}%).`;
  if (matched.length) feedback += ` Conceitos identificados: ${matched.join(", ")}.`;
  if (missing.length) feedback += ` Faltaram: ${missing.join(", ")}.`;
  if (coverage >= 0.8) feedback += " Ótimo nível de completude.";
  else if (coverage >= 0.5) feedback += " Resposta parcial: revise os conceitos faltantes.";
  else feedback += " Resposta insuficiente: compare com a resposta modelo.";
  if (question.model_answer) feedback += `\nResposta modelo: ${question.model_answer}`;

  return { score, max_score: max, feedback };
}

export function gradeQuestion(question, responseText) {
  return question.type === "objetiva"
    ? gradeObjective(question, responseText)
    : gradeDiscursive(question, responseText);
}
