const $ = (s) => document.querySelector(s);
const LETTERS = ["A", "B", "C", "D", "E"];
let currentExamId = null;

// ---------- Abas ----------
document.querySelectorAll("nav .tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("nav .tab").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    document.querySelectorAll(".panel").forEach((p) => p.classList.add("hidden"));
    $("#tab-" + btn.dataset.tab).classList.remove("hidden");
    if (btn.dataset.tab === "resultados") { loadSubmissions(); loadResearchRunsTab(); }
    if (btn.dataset.tab === "responder") loadAnswerExams();
    if (btn.dataset.tab === "materias") loadSubjects();
    if (btn.dataset.tab === "seminario") loadSeminars();
    if (btn.dataset.tab === "xray") { initXrayForm(); initXrayXref(); loadXrays(); }
    if (btn.dataset.tab === "smart") { if (!$("#smart-items").children.length) addSmartItem({}); loadResearchHistory(); }
  });
});

async function api(path, opts = {}) {
  const r = await fetch(path, opts);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || "Erro na requisição.");
  return data;
}
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---------- Provas ----------
async function loadExams() {
  const exams = await api("/api/exams");
  $("#exam-list").innerHTML = exams.length
    ? exams.map((e) => `
      <div class="card">
        <h3>${esc(e.title)}</h3>
        <div class="meta">${e.question_count} questão(ões) · criada em ${esc(e.created_at)}</div>
        ${e.description ? `<p>${esc(e.description)}</p>` : ""}
        <div class="row-actions">
          <button class="secondary" onclick="openExam(${e.id})">Ver / adicionar questões</button>
          <button onclick="goAnswer(${e.id})">Responder</button>
          <button class="danger" onclick="deleteExam(${e.id})">Excluir</button>
        </div>
      </div>`).join("")
    : "<p>Nenhuma prova ainda. Crie a primeira abaixo.</p>";
}

$("#exam-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const fd = new FormData(ev.target);
  await api("/api/exams", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: fd.get("title"), description: fd.get("description") }) });
  ev.target.reset();
  loadExams();
});

async function deleteExam(id) {
  if (!confirm("Excluir a prova e todas as suas questões?")) return;
  await api("/api/exams/" + id, { method: "DELETE" });
  if (currentExamId === id) { currentExamId = null; $("#exam-detail").classList.add("hidden"); }
  loadExams();
}

async function openExam(id) {
  currentExamId = id;
  const exam = await api("/api/exams/" + id);
  $("#exam-detail-title").textContent = exam.title;
  $("#question-list").innerHTML = exam.questions.length
    ? exam.questions.map((q, i) => `
      <div class="card question ${q.type}">
        <span class="badge ${q.type}">${q.type === "objetiva" ? "Objetiva" : "Discursiva"}</span>
        <p><strong>${i + 1}.</strong> ${esc(q.statement)}</p>
        ${q.type === "objetiva" ? `<ol type="A">${q.options.map((o) => `<li>${esc(o)}</li>`).join("")}</ol><p><strong>Gabarito:</strong> ${esc(q.answer_key)}</p>` : ""}
        ${q.type === "discursiva" && q.model_answer ? `<p class="meta">Resposta modelo cadastrada.</p>` : ""}
        <div class="row-actions">
          <button class="danger" onclick="deleteQuestion(${q.id})">Excluir questão</button>
        </div>
      </div>`).join("")
    : "<p>Sem questões ainda.</p>";
  $("#exam-detail").classList.remove("hidden");
  $("#exam-detail").scrollIntoView({ behavior: "smooth" });
}

async function deleteQuestion(id) {
  if (!confirm("Excluir esta questão?")) return;
  await api("/api/questions/" + id, { method: "DELETE" });
  openExam(currentExamId);
}

$("#q-type").addEventListener("change", (ev) => {
  const disc = ev.target.value === "discursiva";
  $("#q-objetiva-fields").classList.toggle("hidden", disc);
  $("#q-discursiva-fields").classList.toggle("hidden", !disc);
});

$("#question-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  if (!currentExamId) { alert("Abra uma prova primeiro."); return; }
  const fd = new FormData(ev.target);
  const type = fd.get("type");
  const body = {
    type,
    statement: fd.get("statement"),
    weight: Number(fd.get("weight")) || 1,
    options: type === "objetiva" ? String(fd.get("options") || "").split("\n").map((s) => s.trim()).filter(Boolean) : [],
    answer_key: type === "objetiva" ? fd.get("answer_key") : "",
    model_answer: type === "discursiva" ? fd.get("model_answer") : "",
    keywords: type === "discursiva" ? String(fd.get("keywords") || "").split(",").map((s) => s.trim()).filter(Boolean) : [],
  };
  try {
    await api(`/api/exams/${currentExamId}/questions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    ev.target.reset();
    openExam(currentExamId);
  } catch (e) { alert(e.message); }
});

// ---------- Responder ----------
async function loadAnswerExams() {
  const exams = await api("/api/exams");
  $("#answer-exam").innerHTML = exams.map((e) => `<option value="${e.id}">${esc(e.title)} (${e.question_count} questões)</option>`).join("");
  if (exams.length) renderAnswerForm(exams[0].id);
}
$("#answer-exam").addEventListener("change", (ev) => renderAnswerForm(Number(ev.target.value)));

function goAnswer(id) {
  document.querySelector('[data-tab="responder"]').click();
  loadAnswerExams().then(() => { $("#answer-exam").value = id; renderAnswerForm(id); });
}

async function renderAnswerForm(examId) {
  const exam = await api("/api/exams/" + examId);
  $("#answer-questions").innerHTML = exam.questions.map((q, i) => `
    <div class="card question ${q.type}" data-qid="${q.id}">
      <span class="badge ${q.type}">${q.type === "objetiva" ? "Objetiva" : "Discursiva"}</span>
      <p><strong>${i + 1}.</strong> ${esc(q.statement)}</p>
      ${q.type === "objetiva"
        ? `<div class="alternatives">${q.options.map((o, j) => `
            <label><input type="radio" name="q_${q.id}" value="${LETTERS[j]}"> <strong>${LETTERS[j]}</strong>) ${esc(o)}</label>`).join("")}
          </div>`
        : `<textarea class="answer-text" id="text_${q.id}" placeholder="Digite sua resposta..."></textarea>
           <div class="row-actions">
             <label style="font-weight:400">📷 Foto da resposta <input type="file" id="img_${q.id}" accept="image/*" style="display:inline;width:auto"></label>
             <button type="button" class="secondary" onclick="ocrImage(${q.id})">Ler imagem (OCR)</button>
           </div>
           <div class="ocr-status" id="ocr_${q.id}"></div>
           <img id="prev_${q.id}" class="img-preview hidden">`}
    </div>`).join("");
  $("#submit-answers").classList.toggle("hidden", !exam.questions.length);
  $("#answer-result").innerHTML = "";
  // preview das imagens
  exam.questions.forEach((q) => {
    const inp = $("#img_" + q.id);
    if (inp) inp.addEventListener("change", () => {
      const f = inp.files[0];
      if (f) { const img = $("#prev_" + q.id); img.src = URL.createObjectURL(f); img.classList.remove("hidden"); }
    });
  });
}

async function ocrImage(qid) {
  const inp = $("#img_" + qid);
  const status = $("#ocr_" + qid);
  const file = inp && inp.files[0];
  if (!file) { status.textContent = "Selecione uma imagem primeiro."; return; }
  if (typeof Tesseract === "undefined") { status.textContent = "OCR indisponível (sem conexão com o CDN). Digite a resposta."; return; }
  status.textContent = "Lendo imagem... aguarde.";
  try {
    const { data } = await Tesseract.recognize(file, "por", {
      logger: (m) => { if (m.status === "recognizing text") status.textContent = `Lendo imagem... ${Math.round(m.progress * 100)}%`; },
    });
    $("#text_" + qid).value = (data.text || "").trim();
    status.textContent = data.text.trim() ? "Texto extraído! Revise antes de enviar." : "Nenhum texto reconhecido na imagem.";
  } catch (e) {
    status.textContent = "Falha no OCR. Digite a resposta manualmente.";
  }
}

$("#submit-answers").addEventListener("click", async () => {
  const examId = Number($("#answer-exam").value);
  const exam = await api("/api/exams/" + examId);
  const fd = new FormData();
  fd.append("exam_id", examId);
  fd.append("student_name", $("#answer-name").value || "");
  const answers = {};
  for (const q of exam.questions) {
    if (q.type === "objetiva") {
      const sel = document.querySelector(`input[name="q_${q.id}"]:checked`);
      answers[q.id] = sel ? sel.value : "";
    } else {
      answers[q.id] = $("#text_" + q.id).value || "";
      const f = $("#img_" + q.id).files[0];
      if (f) fd.append("image_" + q.id, f);
    }
  }
  fd.append("answers", JSON.stringify(answers));
  const btn = $("#submit-answers");
  btn.disabled = true; btn.textContent = "Corrigindo...";
  try {
    const sub = await api("/api/submissions", { method: "POST", body: fd });
    showResult(sub);
    loadSubmissions();
  } catch (e) { alert(e.message); }
  btn.disabled = false; btn.textContent = "Enviar e corrigir";
});

function showResult(sub) {
  const pct = sub.max_score ? Math.round((sub.total_score / sub.max_score) * 100) : 0;
  const cls = pct >= 70 ? "good" : pct >= 50 ? "mid" : "bad";
  $("#answer-result").innerHTML = `
    <div class="card">
      <h3>Resultado da correção</h3>
      <div class="score ${cls}">${sub.total_score} / ${sub.max_score} (${pct}%)</div>
      ${sub.answers.map((a, i) => {
        const qpct = a.max_score ? a.score / a.max_score : 0;
        const qc = qpct >= 1 ? "correct" : qpct > 0 ? "partial" : "wrong";
        return `<div class="card result-q ${qc}">
          <p><strong>${i + 1}.</strong> ${esc(a.statement)} <span class="meta">(${a.score}/${a.max_score})</span></p>
          ${a.response_text ? `<p><strong>Sua resposta:</strong> ${esc(a.response_text)}</p>` : "<p><em>Sem resposta.</em></p>"}
          ${a.image_path ? `<img src="${esc(a.image_path)}" class="img-preview">` : ""}
          <div class="feedback">${esc(a.feedback)}</div>
        </div>`;
      }).join("")}
    </div>`;
  $("#answer-result").scrollIntoView({ behavior: "smooth" });
}

// ---------- Resultados ----------
async function loadSubmissions() {
  const subs = await api("/api/submissions");
  $("#submission-list").innerHTML = subs.length
    ? subs.map((s) => `
      <div class="card">
        <h4>${esc(s.student_name || "Sem nome")} — ${s.total_score}/${s.max_score}</h4>
        <div class="meta">${esc(s.created_at)}</div>
        <div class="row-actions">
          <button class="secondary" onclick="openSubmission(${s.id})">Ver correção</button>
          <button class="danger" onclick="deleteSubmission(${s.id})">Excluir</button>
        </div>
      </div>`).join("")
    : "<p>Nenhuma correção realizada ainda.</p>";
}

async function openSubmission(id) {
  const sub = await api("/api/submissions/" + id);
  const pct = sub.max_score ? Math.round((sub.total_score / sub.max_score) * 100) : 0;
  $("#submission-detail").innerHTML = `
    <div class="card">
      <h3>${esc(sub.exam.title)} — ${esc(sub.student_name || "Sem nome")}</h3>
      <div class="score ${pct >= 70 ? "good" : pct >= 50 ? "mid" : "bad"}">${sub.total_score} / ${sub.max_score} (${pct}%)</div>
      ${sub.answers.map((a, i) => `
        <div class="card result-q">
          <p><strong>${i + 1}.</strong> ${esc(a.statement)} <span class="meta">(${a.score}/${a.max_score})</span></p>
          ${a.response_text ? `<p><strong>Resposta:</strong> ${esc(a.response_text)}</p>` : ""}
          ${a.image_path ? `<img src="${esc(a.image_path)}" class="img-preview">` : ""}
          <div class="feedback">${esc(a.feedback)}</div>
        </div>`).join("")}
    </div>`;
  $("#submission-detail").scrollIntoView({ behavior: "smooth" });
}

async function deleteSubmission(id) {
  if (!confirm("Excluir esta correção?")) return;
  await api("/api/submissions/" + id, { method: "DELETE" });
  $("#submission-detail").innerHTML = "";
  loadSubmissions();
}

// ---------- init ----------
loadExams();

// ---------- Correção inteligente ----------
let smartN = 0;

function addSmartItem(prefill = {}) {
  const n = smartN++;
  const div = document.createElement("div");
  div.className = "card question";
  div.dataset.smart = n;
  div.innerHTML = `
    <div class="row-actions" style="justify-content:flex-end">
      <button type="button" class="danger" onclick="this.closest('[data-smart]').remove()">Remover</button>
    </div>
    <label style="font-weight:600">Questão <textarea class="smart-q-text" rows="3" placeholder="Digite ou cole o enunciado...">${esc(prefill.text || "")}</textarea></label>
    <label>Tipo
      <select class="smart-q-type">
        <option value="discursiva">Discursiva</option>
        <option value="objetiva" ${prefill.type === "objetiva" ? "selected" : ""}>Objetiva</option>
      </select>
    </label>
    <label class="smart-q-options-wrap" style="${prefill.type === "objetiva" ? "" : "display:none"}">Alternativas (uma por linha)
      <textarea class="smart-q-options" rows="4" placeholder="Atropina&#10;Pilocarpina&#10;...">${esc((prefill.options || []).join("\n"))}</textarea>
    </label>
    <div class="row-actions">
      <label style="font-weight:400">🖼️ Imagem <input type="file" class="smart-q-img" accept="image/*" style="display:inline;width:auto"></label>
      <select class="smart-q-kind" style="width:auto">
        <option value="foto">Foto de questão</option>
        <option value="raio-x">Raio-X</option>
      </select>
      <button type="button" class="secondary smart-q-ocr">Ler imagem (OCR)</button>
    </div>
    <div class="ocr-status smart-q-status"></div>
    <img class="img-preview hidden smart-q-prev">`;
  $("#smart-items").appendChild(div);

  const typeSel = div.querySelector(".smart-q-type");
  typeSel.addEventListener("change", () => {
    div.querySelector(".smart-q-options-wrap").style.display = typeSel.value === "objetiva" ? "" : "none";
  });
  const kindSel = div.querySelector(".smart-q-kind");
  const ocrBtn = div.querySelector(".smart-q-ocr");
  const syncKind = () => {
    const isXray = kindSel.value === "raio-x";
    ocrBtn.style.display = isXray ? "none" : "";
    div.querySelector(".smart-q-status").textContent = isXray ? "Raio-X anexado como referência visual (sem OCR)." : "";
  };
  kindSel.addEventListener("change", syncKind);

  const fileInp = div.querySelector(".smart-q-img");
  fileInp.addEventListener("change", () => {
    const f = fileInp.files[0];
    if (f) { const img = div.querySelector(".smart-q-prev"); img.src = URL.createObjectURL(f); img.classList.remove("hidden"); }
  });
  ocrBtn.addEventListener("click", async () => {
    const f = fileInp.files[0];
    const status = div.querySelector(".smart-q-status");
    if (!f) { status.textContent = "Selecione uma imagem primeiro."; return; }
    if (typeof Tesseract === "undefined") { status.textContent = "OCR indisponível (sem conexão). Digite a questão."; return; }
    ocrBtn.disabled = true;
    status.textContent = "Lendo imagem...";
    try {
      const { data } = await Tesseract.recognize(f, "por", {
        logger: (m) => { if (m.status === "recognizing text") status.textContent = `Lendo imagem... ${Math.round(m.progress * 100)}%`; },
      });
      const t = (data.text || "").trim();
      if (t) { div.querySelector(".smart-q-text").value = cleanInstructionNoise(t) || t; status.textContent = "Texto extraído! Revise antes de pesquisar."; }
      else status.textContent = "Nenhum texto reconhecido.";
    } catch { status.textContent = "Falha no OCR. Digite a questão."; }
    ocrBtn.disabled = false;
  });
}

$("#smart-add").addEventListener("click", () => addSmartItem({}));

// ---------- Modo automático: multi-foto -> OCR -> dividir -> pesquisar -> resultado ----------
async function ocrFile(file, onProgress) {
  if (typeof Tesseract === "undefined") throw new Error("OCR indisponível (sem conexão com a internet).");
  const { data } = await Tesseract.recognize(file, "por", {
    logger: (m) => { if (m.status === "recognizing text" && onProgress) onProgress(Math.round(m.progress * 100)); },
  });
  return (data.text || "").trim();
}

function splitIntoQuestions(text) {
  let parts = text.split(new RegExp("\\n(?=\\s*" + QNUM_RE + ")")).map((s) => s.trim()).filter((s) => s.length > 10);
  if (parts.length <= 1) {
    // O OCR às vezes devolve tudo numa linha só: tenta dividir por número após fim de frase
    parts = text.split(new RegExp("(?<=[.?!…]\\s|\\n|^)(?=" + QNUM_RE + ")")).map((s) => s.trim()).filter((s) => s.length > 10);
  }
  const chunks = parts.length ? parts : [text.trim()];
  return chunks.filter(Boolean);
}

// Início de questão: número + pontuação ("6)", "7-") ou número + espaço + maiúscula.
// A segunda forma tolera OCR que perde a pontuação ("8 Um paciente...").
const QNUM_RE = "\\d{1,2}\\s*(?:[.)\\-–]\\s*|\\s+[A-ZÀ-Ú])";
const QNUM_START_RE = new RegExp("^\\s*" + QNUM_RE);

// O trecho tem cara de questão? (número, interrogação ou alternativas)
// Trechos de OCR sem nenhum marcador (ex.: cabeçalho mal lido) são descartados.
function hasQuestionMarkers(text) {
  if (QNUM_START_RE.test(text)) return true;
  if (/\?/.test(text)) return true;
  if (/^\s*\(?[A-Ea-e]\)?\s*[.)\-–:]\s*.+/m.test(text)) return true;
  return false;
}

// Detecta trechos que NÃO são questões e devem ser ignorados:
// - INSTRUÇÕES da prova (regras de conduta: "aparelhos eletrônicos desligados", "banheiro não permitido"...)
// - CABEÇALHO da prova (dados do aluno: curso, disciplina, professor, matrícula, assinatura, nota...)
const INSTRUCTION_HINTS = [
  "aparelhos eletronicos", "aparelho eletronico", "anulacao da prova", "anular a prova",
  "banheiro", "bebedouro", "rascunho", "folha de rascunho", "permanencia",
  "correcao gramatical", "uso culto da linguagem", "textos claros",
  "saida apos", "nao sera permitida", "devera ser devolvida",
  "ao professor", "juntamente com a prova", "realizacao da prova", "durante a prova",
  "desligados e guardados", "sujeito a anulacao",
  "bacharelado em odontologia", "curso: bacharelado", "disciplina:", "disciplina protese",
  "professor(a)", "semestre:", "numero de matricula", "aluno(a)", "assinatura",
];
function normTxt(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}
// Uma linha é "ruído" (instrução/cabeçalho) se carrega marcadores típicos.
// Linhas de questão (numerada com ? ou alternativa A–E) nunca são ruído.
function isNoiseLine(line) {
  const t = line.trim();
  if (!t) return true;
  if (/^\s*\d{1,2}\s*[.)\-–]/.test(t) && /\?/.test(t)) return false;
  if (/^\s*\(?[A-Ea-e]\)?\s*[.)\-–:]\s*.+/.test(t)) return false;
  const n = normTxt(t);
  const hits = INSTRUCTION_HINTS.filter((h) => n.includes(h)).length;
  if (hits >= 2) return true;
  if (hits === 1 && t.length < 140) return true;
  return false;
}
// Remove as linhas de instrução/cabeçalho preservando as questões do bloco
function cleanInstructionNoise(text) {
  return String(text || "").split("\n").filter((ln) => !isNoiseLine(ln)).join("\n").trim();
}
function isInstructionBlock(text) {
  const cleaned = cleanInstructionNoise(text);
  if (cleaned.length < 15) return true;
  // bloco inteiro com cara de regra numerada, sem interrogação
  const n = normTxt(cleaned);
  const hits = INSTRUCTION_HINTS.filter((h) => n.includes(h)).length;
  if (/^\s*\d{1,2}\s*[.)\-–]/.test(cleaned) && !/\?/.test(cleaned) && hits >= 1) return true;
  return false;
}

let autoRunning = false;
$("#auto-imgs").addEventListener("change", () => {
  const files = [...$("#auto-imgs").files];
  if (!files.length) return;
  $("#auto-thumbs").innerHTML = files.map((f) => `
    <div class="thumb"><img src="${URL.createObjectURL(f)}"></div>`).join("");
  // dispara sozinho assim que as imagens terminam de carregar
  setTimeout(() => { runAutoFlow(); }, 400);
});

// Envia as questões em lotes de 5, reaproveitando o mesmo run_id.
// O progresso parcial fica salvo no histórico: se um lote falhar, nada do que
// já foi pesquisado se perde — e nenhuma questão é silenciosamente descartada.
async function submitResearchBatches({ title, items, getFile, prog }) {
  const BATCH = 5;
  let runId = 0, run = null;
  for (let s = 0; s < items.length; s += BATCH) {
    const batch = items.slice(s, s + BATCH);
    const fd = new FormData();
    fd.append("title", title);
    if (runId) fd.append("run_id", String(runId));
    fd.append("index_base", String(s));
    fd.append("items", JSON.stringify(batch));
    batch.forEach((it, i) => {
      const f = getFile ? getFile(s + i) : null;
      if (f) fd.append("image_" + (s + i), f);
    });
    if (prog) prog.textContent = `Pesquisando questões ${s + 1}–${Math.min(s + BATCH, items.length)} de ${items.length} na internet...`;
    try {
      run = await api("/api/research", { method: "POST", body: fd });
      runId = run.id;
    } catch (e) {
      if (runId) loadResearchHistory();
      throw new Error(`Falha no lote das questões ${s + 1}–${s + batch.length}: ${e.message} O que já foi pesquisado está salvo no histórico.`);
    }
  }
  return run;
}

async function runAutoFlow() {
  if (autoRunning) return;
  const btn = $("#auto-go"), prog = $("#auto-progress");
  const files = [...$("#auto-imgs").files];
  const pasted = $("#auto-text").value.trim();
  if (!files.length && !pasted) { alert("Selecione ao menos uma foto ou cole o texto das questões."); return; }
  autoRunning = true;
  btn.disabled = true;
  $("#smart-result").innerHTML = "";
  try {
    const kind = ($("#auto-kind") || {}).value === "raio-x" ? "raio-x" : "foto";
    // 1. OCR de todas as fotos (raio-X não passa por OCR: é referência visual)
    const fileTexts = [];
    if (kind === "foto") {
      for (let i = 0; i < files.length; i++) {
        prog.textContent = `Lendo imagem ${i + 1} de ${files.length}...`;
        const t = await ocrFile(files[i], (p) => { prog.textContent = `Lendo imagem ${i + 1} de ${files.length}... ${p}%`; });
        if (t) fileTexts.push({ file: files[i], text: t });
      }
      if (pasted) fileTexts.push({ file: null, text: pasted });
      if (!fileTexts.length) {
        prog.textContent = "";
        alert("Nenhum texto reconhecido nas fotos. Tente fotos mais nítidas ou cole o texto.");
        autoRunning = false; btn.disabled = false;
        return;
      }
    } else {
      if (!pasted) {
        prog.textContent = "";
        alert("No modo raio-X, cole o texto das questões na caixa abaixo — as imagens serão anexadas como referência visual.");
        autoRunning = false; btn.disabled = false;
        return;
      }
      fileTexts.push({ file: null, text: pasted });
    }
    // 2. Dividir em questões (ignorando instruções/cabeçalho da prova)
    prog.textContent = "Dividindo em questões...";
    await new Promise((r) => setTimeout(r, 60));
    const rawChunks = [];
    for (const ft of fileTexts) {
      for (const c of splitIntoQuestions(ft.text)) rawChunks.push({ text: c, file: ft.file });
    }
    const dropped = rawChunks.filter((c) => isInstructionBlock(c.text)).length;
    // limpa linhas de instrução/cabeçalho grudadas nas questões e preserva o resto
    const cleaned = rawChunks
      .map((c) => ({ text: cleanInstructionNoise(c.text), file: c.file, pasted: !c.file }))
      .filter((c) => c.text.length >= 15);
    // descarta trechos de OCR sem cara de questão (ex.: cabeçalho mal lido pelo OCR);
    // texto colado manualmente passa direto
    let unmarked = 0;
    const chunks = cleaned.filter((c) => {
      if (!c.pasted && !hasQuestionMarkers(c.text)) { unmarked++; return false; }
      return true;
    });
    // ordena pela numeração detectada (padrão de resolução, item 1)
    chunks.forEach((c, i) => (c._i = i));
    chunks.sort((a, b) => {
      const na = questionNum(a.text), nb = questionNum(b.text);
      if (na != null && nb != null) return na - nb;
      if (na != null) return -1;
      if (nb != null) return 1;
      return a._i - b._i;
    });
    if (!chunks.length) {
      prog.textContent = "";
      alert("Só foram encontrados trechos de instruções/cabeçalho — nenhuma questão para analisar.");
      autoRunning = false; btn.disabled = false;
      return;
    }
    // 3. Montar itens (detecta objetivas) — cada questão carrega a foto de origem
    const title = $("#smart-title").value || "Correção automática";
    const items = chunks.map((c) => {
      const opts = detectOptions(c.text);
      const isObj = opts.length >= 2;
      const cleanText = isObj
        ? c.text.split("\n").filter((ln) => !ln.match(/^\s*\(?[A-Ea-e]\)?\s*[.)\-–:]\s*.+/)).join("\n").trim()
        : c.text;
      return { text: cleanText, type: isObj ? "objetiva" : "discursiva", options: opts.map((o) => o.text), image_kind: kind };
    });
    // No modo raio-X, distribui as imagens nas questões (1ª imagem -> 1ª questão, etc.)
    const getFile = kind === "raio-x"
      ? (gi) => files[gi] || null
      : (gi) => (chunks[gi] && chunks[gi].file) || null;
    // 4. Pesquisar em lotes (nenhuma questão fica de fora)
    const run = await submitResearchBatches({ title, items, getFile, prog });
    renderSmartRun(run);
    loadResearchHistory();
    const nob = items.filter((it) => it.type === "objetiva").length;
    let doneMsg = `Pronto! ${items.length} questão(ões): ${nob} objetiva(s), ${items.length - nob} subjetiva(s).`;
    if (dropped) doneMsg += ` ${dropped} trecho(s) de instruções/cabeçalho da prova foram ignorados.`;
    if (unmarked) doneMsg += ` ${unmarked} trecho(s) sem cara de questão foram ignorados.`;
    prog.textContent = doneMsg;
  } catch (e) { prog.textContent = ""; alert(e.message); }
  autoRunning = false;
  btn.disabled = false;
}
$("#auto-go").addEventListener("click", runAutoFlow);

function detectOptions(qtext) {
  const opts = [];
  for (const ln of qtext.split("\n")) {
    const m = ln.match(/^\s*\(?([A-Ea-e])\)?\s*[.)\-–:]\s*(.+)$/);
    if (m && m[2].trim().length > 1) opts.push({ letter: m[1].toUpperCase(), text: m[2].trim() });
  }
  return opts;
}

// Extrai o texto de todas as fotos dos cartões manuais de uma vez.
// Preenche enunciado, detecta o tipo (objetiva/discursiva) e as alternativas.
$("#smart-extract-all").addEventListener("click", async () => {
  const cards = [...document.querySelectorAll("#smart-items [data-smart]")];
  const targets = cards.filter((div) =>
    div.querySelector(".smart-q-img").files[0] && div.querySelector(".smart-q-kind").value === "foto");
  const prog = $("#smart-extract-progress");
  if (!targets.length) { alert("Nenhum cartão com foto de questão para extrair. Anexe as fotos nos cartões primeiro."); return; }
  const btn = $("#smart-extract-all");
  btn.disabled = true;
  let ok = 0, fail = 0, skipped = 0;
  for (let i = 0; i < targets.length; i++) {
    const div = targets[i];
    const num = cards.indexOf(div) + 1;
    prog.textContent = `Extraindo questão ${num} (${i + 1}/${targets.length})...`;
    const ta = div.querySelector(".smart-q-text");
    if (ta.value.trim()) { skipped++; continue; }
    try {
      const t = await ocrFile(div.querySelector(".smart-q-img").files[0]);
      if (t) {
        ta.value = cleanInstructionNoise(t) || t;
        const opts = detectOptions(t);
        if (opts.length >= 2) {
          const typeSel = div.querySelector(".smart-q-type");
          typeSel.value = "objetiva";
          typeSel.dispatchEvent(new Event("change"));
          div.querySelector(".smart-q-options").value = opts.map((o) => o.text).join("\n");
        }
        ok++;
      } else { fail++; }
    } catch { fail++; }
  }
  prog.textContent = `Extração concluída: ${ok} preenchida(s)` +
    (skipped ? `, ${skipped} já estavam preenchidas` : "") +
    (fail ? `, ${fail} falharam (tente foto mais nítida ou digite)` : "") +
    ". Revise e clique em \"Pesquisar na internet e corrigir\".";
  btn.disabled = false;
});

// Envio para pesquisa
$("#smart-submit").addEventListener("click", async () => {
  const cards = [...document.querySelectorAll("#smart-items [data-smart]")];
  // Validação: TODAS as questões precisam estar preenchidas — nenhuma fica de fora em silêncio
  const emptyNums = [];
  cards.forEach((div, i) => {
    if (!div.querySelector(".smart-q-text").value.trim()) emptyNums.push(i + 1);
  });
  if (!cards.length) { alert("Adicione ao menos uma questão."); return; }
  if (emptyNums.length) {
    alert(`As questões ${emptyNums.join(", ")} estão sem texto. Preencha todas antes de analisar — use o botão "📷 Extrair texto de todas as fotos" ou digite o enunciado.`);
    return;
  }
  const items = [];
  const filesByIdx = {};
  cards.forEach((div, idx) => {
    const text = div.querySelector(".smart-q-text").value.trim();
    const type = div.querySelector(".smart-q-type").value;
    const options = type === "objetiva"
      ? div.querySelector(".smart-q-options").value.split("\n").map((s) => s.trim()).filter(Boolean)
      : [];
    const kind = div.querySelector(".smart-q-kind").value;
    items.push({ text, type, options, image_kind: kind });
    const f = div.querySelector(".smart-q-img").files[0];
    if (f) filesByIdx[idx] = f;
  });

  const btn = $("#smart-submit"), prog = $("#smart-progress");
  btn.disabled = true;
  $("#smart-result").innerHTML = "";
  try {
    const run = await submitResearchBatches({
      title: $("#smart-title").value || "Pesquisa inteligente",
      items,
      getFile: (gi) => filesByIdx[gi] || null,
      prog,
    });
    renderSmartRun(run);
    loadResearchHistory();
    prog.textContent = `Pronto! ${items.length} questão(ões) analisadas — nenhuma ficou de fora.`;
  } catch (e) { prog.textContent = ""; alert(e.message); }
  btn.disabled = false;
});

function smartItemHtml(it, i) {
  return `
        <div class="card result-q">
          <p><strong>${i + 1}.</strong> ${esc(it.question_text)}</p>
          ${it.image_path ? `<img src="${esc(it.image_path)}" class="img-preview">` : ""}
          ${it.error ? `<p><em>${esc(it.error)}</em></p>` : `
            ${it.qtype === "objetiva" && it.suggested ? `
              <p style="font-size:1.15rem">✅ Resposta: <strong style="font-size:1.7rem">${esc(it.suggested)}</strong> — ${esc(it.suggested_text)}</p>
              <p class="meta">Confiança: <strong class="${smartConfClass(it.confidence)}">${it.confidence}% (${smartConfLabel(it.confidence)})</strong></p>
              ${it.justification ? `<p><strong>Por quê:</strong> ${esc(it.justification)}</p>` : ""}` : ""}
            ${it.qtype === "discursiva" && it.suggested_text ? `
              <p><strong>Resposta elaborada:</strong></p>
              ${it.suggested_short ? `<p><strong>Versão curta (para decorar):</strong></p><div class="feedback">${esc(it.suggested_short)}</div>` : ""}
              <p><strong>Versão completa:</strong></p>
              <div class="feedback">${esc(it.suggested_text)}</div>` : ""}
            ${it.note ? `<p class="meta">ℹ️ ${esc(it.note)}</p>` : ""}
            ${it.evidence && it.evidence.length ? `
              <p><strong>Fontes:</strong></p>
              <ul>${it.evidence.map((e) => `<li><a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.title || e.url)}</a>${e.snippet ? `<br><span class="meta">${esc(e.snippet.slice(0, 160))}…</span>` : ""}</li>`).join("")}</ul>` : ""}
          `}
        </div>`;
}

function smartConfClass(c) { return c >= 70 ? "good" : c >= 40 ? "mid" : "bad"; }
function smartConfLabel(c) { return c >= 75 ? "alta" : c >= 50 ? "média" : "baixa"; }

// Número da questão no início do enunciado ("1.", "2)", "8 Um..."), para ordenar e montar o gabarito
function questionNum(text) {
  const m = String(text || "").match(/^\s*(\d{1,2})\s*(?:[.)\-–]|\s+(?=[A-ZÀ-Ú]))/);
  return m ? Number(m[1]) : null;
}

function renderSmartRun(run, target = "#smart-result") {
  const obj = run.items.filter((it) => it.qtype === "objetiva");
  const subj = run.items.filter((it) => it.qtype !== "objetiva");
  // Gabarito final no padrão: 1-A, 2-C, 3-discursiva, 4-? ("?" = sem base para responder)
  const gabarito = run.items.map((it, i) => {
    const n = questionNum(it.question_text) ?? (i + 1);
    const v = it.qtype === "objetiva" ? (it.suggested || "?") : "discursiva";
    return `${n}-${v}`;
  }).join(", ");
  $(target).innerHTML = `
    <div class="card">
      <h3>${esc(run.title)} <span class="meta">(${run.items.length} questão(ões))</span></h3>
      ${obj.length ? `<h4>QUESTÕES OBJETIVAS:</h4>${obj.map((it, i) => smartItemHtml(it, i)).join("")}` : ""}
      ${subj.length ? `<h4>QUESTÕES SUBJETIVAS:</h4>${subj.map((it, i) => smartItemHtml(it, i)).join("")}` : ""}
      <div class="card result-q">
        <p><strong>Gabarito para assinalar:</strong> ${esc(gabarito)}</p>
        <p class="meta">Sem garantia de 100% de acerto: cada resposta mostra a confiança e a fonte para conferência.</p>
      </div>
    </div>`;
  $(target).scrollIntoView({ behavior: "smooth" });
}

async function loadResearchHistory() {
  const runs = await api("/api/research");
  $("#research-history").innerHTML = runs.length
    ? runs.map((r) => `
      <div class="card">
        <h4>${esc(r.title || "Pesquisa")}</h4>
        <div class="meta">${esc(r.created_at)}</div>
        <div class="row-actions">
          <button class="secondary" onclick="openResearch(${r.id})">Ver</button>
          <button class="danger" onclick="deleteResearch(${r.id})">Excluir</button>
        </div>
      </div>`).join("")
    : "<p>Nenhuma pesquisa ainda.</p>";
}

async function openResearch(id, target = "#smart-result") {
  const run = await api("/api/research/" + id);
  renderSmartRun(run, target);
}

// Lista de pesquisas inteligentes dentro da aba "Correções realizadas"
async function loadResearchRunsTab() {
  const runs = await api("/api/research");
  $("#research-list-tab").innerHTML = runs.length
    ? runs.map((r) => `
      <div class="card">
        <h4>${esc(r.title || "Pesquisa")}</h4>
        <div class="meta">${esc(r.created_at)}</div>
        <div class="row-actions">
          <button type="button" class="secondary" onclick="openResearch(${r.id}, '#research-detail-tab')">Ver</button>
          <button type="button" class="danger" onclick="deleteResearchTab(${r.id})">Excluir</button>
        </div>
      </div>`).join("")
    : "<p class='meta'>Nenhuma pesquisa inteligente ainda.</p>";
  $("#research-detail-tab").innerHTML = "";
}

async function deleteResearchTab(id) {
  if (!confirm("Excluir esta pesquisa?")) return;
  await api("/api/research/" + id, { method: "DELETE" });
  loadResearchRunsTab();
}

async function deleteResearch(id) {
  if (!confirm("Excluir esta pesquisa?")) return;
  await api("/api/research/" + id, { method: "DELETE" });
  loadResearchHistory();
}

// ---------- 📚 Matérias (biblioteca de apoio ao estudo) ----------
let currentSubjectId = null;

$("#go-materias").addEventListener("click", (ev) => {
  ev.preventDefault();
  document.querySelector('[data-tab="materias"]').click();
});

async function loadSubjects() {
  const subjects = await api("/api/subjects");
  $("#subject-grid").innerHTML = subjects.length
    ? subjects.map((s) => `
      <div class="card">
        <h4>${esc(s.name)}</h4>
        <p class="meta">${esc(s.description || "")}</p>
        <div class="meta">${s.question_count} questão(ões) · ${s.material_count} material(is)</div>
        <div class="row-actions">
          <button type="button" class="secondary" onclick="openSubject(${s.id})">Abrir</button>
        </div>
      </div>`).join("")
    : "<p>Nenhuma matéria cadastrada.</p>";
  $("#subject-detail").innerHTML = "";
  currentSubjectId = null;
}

async function openSubject(id) {
  currentSubjectId = id;
  const s = await api("/api/subjects/" + id);
  $("#subject-detail").innerHTML = `
    <div class="card">
      <div class="row-actions" style="justify-content:flex-start">
        <button type="button" class="secondary" onclick="loadSubjects()">← Todas as matérias</button>
      </div>
      <h3>${esc(s.name)}</h3>
      <p class="meta">${esc(s.description || "")}</p>

      <h4>Questões (${s.questions.length})
        <button type="button" class="secondary" id="sq-toggle">+ Adicionar questão</button>
      </h4>
      <form id="sq-form" class="card form hidden">
        <label>Enunciado <textarea id="sq-statement" rows="3" placeholder="Digite o enunciado da questão..."></textarea></label>
        <label>Tipo
          <select id="sq-type">
            <option value="objetiva">Objetiva (múltipla escolha)</option>
            <option value="discursiva">Discursiva</option>
          </select>
        </label>
        <label id="sq-options-wrap">Alternativas (uma por linha)
          <textarea id="sq-options" rows="3" placeholder="Opção A&#10;Opção B&#10;..."></textarea>
        </label>
        <label>Resposta / gabarito <input id="sq-answer" placeholder="Ex.: B, ou o texto da resposta"></label>
        <label>Explicação <textarea id="sq-explanation" rows="3" placeholder="Por que essa é a resposta..."></textarea></label>
        <label>Fonte <input id="sq-source" placeholder="Ex.: livro, site, aula..."></label>
        <div class="row-actions"><button type="submit">Salvar questão</button></div>
      </form>
      <div id="sq-list">
        ${s.questions.length ? s.questions.map((q) => `
          <div class="card question ${q.type}">
            <span class="badge ${q.type}">${q.type === "objetiva" ? "Objetiva" : "Discursiva"}</span>
            <p>${esc(q.statement)}</p>
            ${q.type === "objetiva" && q.options.length ? `<ol type="A">${q.options.map((o) => `<li>${esc(o)}</li>`).join("")}</ol>` : ""}
            <div class="row-actions">
              <button type="button" class="secondary" onclick="toggleStudyAnswer(${q.id})">Ver resposta</button>
              <button type="button" class="danger" onclick="deleteStudyQuestion(${q.id})">Excluir</button>
            </div>
            <div id="sans_${q.id}" class="hidden">
              ${q.answer ? `<p><strong>Resposta:</strong> ${esc(q.answer)}</p>` : ""}
              ${q.explanation ? `<div class="feedback">${esc(q.explanation)}</div>` : ""}
              ${q.source ? `<p class="meta">Fonte: ${esc(q.source)}</p>` : ""}
              ${!q.answer && !q.explanation ? `<p class="meta">Sem resposta cadastrada.</p>` : ""}
            </div>
          </div>`).join("") : "<p class='meta'>Nenhuma questão salva ainda.</p>"}
      </div>

      <h4>Materiais de apoio (${s.materials.length})</h4>
      <div class="card form">
        <p class="meta">Anexe um <strong>PDF</strong> ou <strong>imagem</strong>: o sistema lê o texto e salva como material de apoio.</p>
        <label>Arquivo <input type="file" id="sm-file" accept=".pdf,application/pdf,image/*"></label>
        <div class="row-actions">
          <button type="button" id="sm-upload">Ler e salvar material</button>
        </div>
        <div class="ocr-status" id="sm-progress"></div>
      </div>
      <div id="sm-list">
        ${s.materials.length ? s.materials.map((m) => `
          <div class="card">
            <h4>${m.file_type === "pdf" ? "📄" : "🖼️"} ${esc(m.filename)}</h4>
            <div class="meta">${esc(m.created_at)}</div>
            <div class="row-actions">
              <button type="button" class="secondary" onclick="window.open('${esc(m.file_path)}','_blank')">Abrir arquivo</button>
              <button type="button" class="secondary" onclick="toggleMaterialText(${m.id})">Ver texto extraído</button>
              <button type="button" class="danger" onclick="deleteStudyMaterial(${m.id})">Excluir</button>
            </div>
            <div id="smtext_${m.id}" class="hidden"><div class="feedback" style="max-height:300px;overflow:auto"></div></div>
          </div>`).join("") : "<p class='meta'>Nenhum material anexado ainda.</p>"}
      </div>
    </div>`;
  $("#subject-detail").scrollIntoView({ behavior: "smooth" });

  $("#sq-toggle").addEventListener("click", () => $("#sq-form").classList.toggle("hidden"));
  $("#sq-type").addEventListener("change", (ev) => {
    $("#sq-options-wrap").style.display = ev.target.value === "objetiva" ? "" : "none";
  });
  $("#sq-form").addEventListener("submit", submitStudyQuestion);
  $("#sm-upload").addEventListener("click", uploadStudyMaterial);
}

async function submitStudyQuestion(ev) {
  ev.preventDefault();
  const type = $("#sq-type").value;
  const body = {
    type,
    statement: $("#sq-statement").value.trim(),
    options: type === "objetiva" ? $("#sq-options").value.split("\n").map((s) => s.trim()).filter(Boolean) : [],
    answer: $("#sq-answer").value.trim(),
    explanation: $("#sq-explanation").value.trim(),
    source: $("#sq-source").value.trim(),
  };
  if (!body.statement) { alert("Digite o enunciado da questão."); return; }
  try {
    await api(`/api/subjects/${currentSubjectId}/questions`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    openSubject(currentSubjectId);
  } catch (e) { alert(e.message); }
}

function toggleStudyAnswer(id) {
  $("#sans_" + id).classList.toggle("hidden");
}

async function deleteStudyQuestion(id) {
  if (!confirm("Excluir esta questão?")) return;
  await api("/api/study-questions/" + id, { method: "DELETE" });
  openSubject(currentSubjectId);
}

// Extrai o texto de um PDF no navegador (via pdf.js)
async function extractPdfText(file, onProgress) {
  if (typeof pdfjsLib === "undefined") throw new Error("Leitor de PDF indisponível (sem conexão com o CDN).");
  pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const maxPages = Math.min(pdf.numPages, 80);
  let out = "";
  for (let i = 1; i <= maxPages; i++) {
    const page = await pdf.getPage(i);
    const tc = await page.getTextContent();
    out += tc.items.map((it) => it.str).join(" ") + "\n\n";
    if (onProgress) onProgress(Math.round((i / maxPages) * 100), pdf.numPages);
  }
  if (pdf.numPages > maxPages) out += `\n[... ${pdf.numPages - maxPages} página(s) além do limite de ${maxPages} não incluídas]`;
  return out.trim();
}

async function uploadStudyMaterial() {
  const inp = $("#sm-file");
  const prog = $("#sm-progress");
  const f = inp && inp.files[0];
  if (!f) { prog.textContent = "Escolha um PDF ou imagem primeiro."; return; }
  const isPdf = f.type === "application/pdf" || /\.pdf$/i.test(f.name);
  const btn = $("#sm-upload");
  btn.disabled = true;
  let text = "";
  try {
    if (isPdf) {
      prog.textContent = "Lendo PDF...";
      text = await extractPdfText(f, (p, total) => { prog.textContent = `Lendo PDF... ${p}% (${total} páginas)`; });
    } else {
      text = await ocrFile(f, (p) => { prog.textContent = `Lendo imagem... ${p}%`; });
    }
  } catch (e) { prog.textContent = e.message; btn.disabled = false; return; }
  if (!text.trim()) prog.textContent = "Nenhum texto reconhecido — o arquivo será salvo mesmo assim.";
  else prog.textContent = "Salvando material...";
  const fd = new FormData();
  fd.append("file", f);
  fd.append("extracted_text", text);
  try {
    await api(`/api/subjects/${currentSubjectId}/materials`, { method: "POST", body: fd });
    prog.textContent = "Material salvo como apoio ao estudo!";
    inp.value = "";
    openSubject(currentSubjectId);
  } catch (e) { prog.textContent = e.message; }
  btn.disabled = false;
}

async function toggleMaterialText(id) {
  const box = $("#smtext_" + id);
  const inner = box.querySelector(".feedback");
  if (box.classList.contains("hidden")) {
    if (!inner.dataset.loaded) {
      inner.textContent = "Carregando texto...";
      try {
        const r = await api("/api/study-materials/" + id + "/text");
        inner.textContent = r.text || "(nenhum texto extraído deste arquivo)";
        inner.dataset.loaded = "1";
      } catch (e) { inner.textContent = e.message; }
    }
    box.classList.remove("hidden");
  } else box.classList.add("hidden");
}

async function deleteStudyMaterial(id) {
  if (!confirm("Excluir este material (arquivo e texto)?")) return;
  await api("/api/study-materials/" + id, { method: "DELETE" });
  openSubject(currentSubjectId);
}

let studySearchTimer = null;
$("#study-search").addEventListener("input", (ev) => {
  clearTimeout(studySearchTimer);
  studySearchTimer = setTimeout(() => runStudySearch(ev.target.value.trim()), 400);
});

async function runStudySearch(term) {
  const box = $("#study-search-result");
  if (term.length < 2) { box.innerHTML = ""; return; }
  box.innerHTML = "<p class='meta'>Buscando...</p>";
  try {
    const r = await api("/api/study-search?q=" + encodeURIComponent(term));
    box.innerHTML = `
      ${r.questions.length ? `<p><strong>Questões (${r.questions.length}):</strong></p>` + r.questions.map((q) => `
        <div class="card"><p>${esc(q.statement.slice(0, 140))}${q.statement.length > 140 ? "…" : ""}</p>
        <div class="meta">${esc(q.subject_name)} · ${q.type}</div>
        <div class="row-actions"><button type="button" class="secondary" onclick="openSubject(${q.subject_id})">Abrir matéria</button></div></div>`).join("") : ""}
      ${r.materials.length ? `<p><strong>Materiais (${r.materials.length}):</strong></p>` + r.materials.map((m) => `
        <div class="card"><h4>${m.file_type === "pdf" ? "📄" : "🖼️"} ${esc(m.filename)}</h4>
        <div class="meta">${esc(m.subject_name)}${m.snippet ? " · " + esc(m.snippet.slice(0, 120)) + "…" : ""}</div>
        <div class="row-actions"><button type="button" class="secondary" onclick="openSubject(${m.subject_id})">Abrir matéria</button></div></div>`).join("") : ""}
      ${!r.questions.length && !r.materials.length ? "<p class='meta'>Nada encontrado.</p>" : ""}`;
  } catch (e) { box.innerHTML = `<p class="meta">${esc(e.message)}</p>`; }
}

// ---------- 💡 Resposta sintetizada (na aba Responder) ----------
$("#quick-ask").addEventListener("click", async () => {
  const q = $("#quick-q").value.trim();
  if (!q) { alert("Digite sua dúvida."); return; }
  const btn = $("#quick-ask"), prog = $("#quick-prog");
  btn.disabled = true;
  prog.textContent = "Pesquisando e sintetizando...";
  $("#quick-result").innerHTML = "";
  try {
    const fd = new FormData();
    fd.append("transient", "1");
    fd.append("title", "Resposta sintetizada");
    fd.append("items", JSON.stringify([{ text: q, type: "discursiva", options: [] }]));
    const r = await api("/api/research", { method: "POST", body: fd });
    const it = r.items[0];
    if (!it || it.error) {
      $("#quick-result").innerHTML = `<p><em>${esc((it && it.error) || "Sem resposta.")}</em></p>`;
    } else {
      $("#quick-result").innerHTML = `
        <div class="card result-q">
          <p><strong>Em resumo:</strong></p>
          <div class="feedback">${esc(it.suggested_short || it.suggested_text)}</div>
          <div class="row-actions">
            <button type="button" class="secondary" id="quick-more">Ver resposta completa e fontes</button>
          </div>
          <div id="quick-full" class="hidden">
            <div class="feedback">${esc(it.suggested_text)}</div>
            ${it.evidence && it.evidence.length ? `<p><strong>Fontes:</strong></p><ul>${it.evidence.map((e) => `<li><a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.title || e.url)}</a></li>`).join("")}</ul>` : ""}
          </div>
          <div class="row-actions" style="margin-top:8px">
            <label style="font-weight:400">Salvar na matéria
              <select id="quick-subject" style="width:auto"></select>
            </label>
            <button type="button" class="secondary" id="quick-save">📚 Salvar como questão</button>
          </div>
        </div>`;
      const subjects = await api("/api/subjects");
      $("#quick-subject").innerHTML = subjects.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join("");
      $("#quick-more").addEventListener("click", () => $("#quick-full").classList.toggle("hidden"));
      $("#quick-save").addEventListener("click", async () => {
        try {
          await api(`/api/subjects/${$("#quick-subject").value}/questions`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type: "discursiva", statement: q, answer: "", explanation: it.suggested_text, source: "Resposta sintetizada" }),
          });
          alert("Questão salva na matéria!");
        } catch (e) { alert(e.message); }
      });
    }
    prog.textContent = "";
  } catch (e) { prog.textContent = ""; alert(e.message); }
  btn.disabled = false;
});

// ---------- 🎓 Seminário ----------
let currentSeminar = null;

async function loadSeminars() {
  const list = await api("/api/seminars");
  $("#sem-list").innerHTML = list.length
    ? list.map((s) => `
      <div class="card">
        <h4>${esc(s.theme)}</h4>
        <div class="meta">${s.status === "aprovado" ? "Aprovado" : "Rascunho"} · ${esc(s.created_at)}${s.style ? ` · ${s.style === "moderno" ? "Moderno" : s.style === "formal" ? "Formal" : "Animado"}` : ""}</div>
        <div class="row-actions">
          <button type="button" class="secondary" onclick="openSeminar(${s.id})">Abrir / editar</button>
          <button type="button" class="danger" onclick="deleteSeminar(${s.id})">Excluir</button>
        </div>
      </div>`).join("")
    : "<p class='meta'>Nenhum seminário ainda. Digite um tema acima para gerar o primeiro.</p>";
  if (!currentSeminar) $("#sem-editor").innerHTML = "";
}

const SEM_FONT_OPTS = [["padrao", "Padrão (sem serifa)"], ["serifada", "Serifada (Times)"], ["georgia", "Georgia (serifada elegante)"], ["verdana", "Verdana (larga e legível)"], ["courier", "Monoespaçada (Courier)"], ["comic", "Divertida (Comic Sans)"]];
const SEM_BG_OPTS = [["padrao", "Padrão do estilo"], ["roxo", "Roxo"], ["azul", "Azul escuro"], ["verde", "Verde"], ["vinho", "Vinho"], ["cinza", "Cinza escuro"], ["claro", "Claro (lilás)"],
  ["infantil-1", "Infantil 1: dentes felizes e escovas coloridas no lilás"],
  ["infantil-2", "Infantil 2: céu com nuvens e arco-íris"],
  ["infantil-3", "Infantil 3: bichinhos escovando dentes no verde menta"],
  ["infantil-4", "Infantil 4: rosa com balões e lanchinhos saudáveis"],
  ["infantil-5", "Infantil 5: amarelo com sol sorrindo e dentes de óculos de sol"],
  ["infantil-6", "Infantil 6: fundo do mar com peixinhos e dente mergulhador"],
  ["infantil-7", "Infantil 7: dinossauros fofos escovando os dentes no laranja"],
  ["infantil-8", "Infantil 8: espaço roxo com dente astronauta"],
  ["infantil-9", "Infantil 9: floresta encantada com bichinhos"],
  ["infantil-10", "Infantil 10: mundo dos doces com dente super-herói"]];
// Dados da capa: o usuário preenche em branco; tudo sai em maiúsculas
function semMetaPayload(prefix) {
  const up = (id) => { const el = $(id); return el ? el.value.toUpperCase() : ""; };
  return {
    institution: up(prefix + "institution"),
    students: up(prefix + "students"),
    subject: up(prefix + "subject"),
    teacher: up(prefix + "teacher"),
    font: $(prefix + "font") ? $(prefix + "font").value : "padrao",
    bg: $(prefix + "bg") ? $(prefix + "bg").value : "padrao",
  };
}

$("#sem-infantil").addEventListener("change", (e) => {
  if (e.target.checked) $("#sem-style").value = "animado";
});

$("#sem-generate").addEventListener("click", async () => {
  const theme = $("#sem-theme").value.trim();
  if (theme.length < 3) { alert("Digite o tema do seminário."); return; }
  const btn = $("#sem-generate"), prog = $("#sem-prog");
  btn.disabled = true;
  prog.textContent = "Pesquisando o tema, buscando imagens e montando os slides... pode levar de 1 a 2 minutos.";
  try {
    const slideCount = Math.min(14, Math.max(4, parseInt($("#sem-pages").value, 10) || 7));
    const style = $("#sem-style").value || "moderno";
    const infantil = !!($("#sem-infantil") && $("#sem-infantil").checked);
    const s = await api("/api/seminars/generate", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ theme, slideCount, style, infantil, ...semMetaPayload("#sem-") }),
    });
    prog.textContent = "";
    $("#sem-theme").value = "";
    loadSeminars();
    openSeminar(s.id);
  } catch (e) { prog.textContent = ""; alert(e.message); }
  btn.disabled = false;
});

async function openSeminar(id) {
  const s = await api("/api/seminars/" + id);
  currentSeminar = s;
  renderSeminarEditor(s);
  $("#sem-editor").scrollIntoView({ behavior: "smooth" });
}

async function deleteSeminar(id) {
  if (!confirm("Excluir este seminário?")) return;
  await api("/api/seminars/" + id, { method: "DELETE" });
  if (currentSeminar && currentSeminar.id === id) { currentSeminar = null; $("#sem-editor").innerHTML = ""; }
  loadSeminars();
}

function slideEditorHtml(sl, i) {
  if (sl.type === "title") return `
    <div class="card" data-slide="${i}" data-slidetype="title">
      <p class="meta">Slide ${i + 1} — Título</p>
      <label>Título <input class="sl-title" value="${esc(sl.title || "")}"></label>
      <label>Subtítulo <input class="sl-sub" value="${esc(sl.subtitle || "")}"></label>
    </div>`;
  if (sl.type === "refs") return `
    <div class="card" data-slide="${i}" data-slidetype="refs">
      <p class="meta">Slide ${i + 1} — Referências (automáticas)</p>
      <ul>${(sl.refs || []).map((r) => `<li><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.title || r.url)}</a></li>`).join("")}</ul>
    </div>`;
  return `
    <div class="card" data-slide="${i}" data-slidetype="content">
      <p class="meta">Slide ${i + 1}</p>
      <label>Título <input class="sl-title" value="${esc(sl.title || "")}"></label>
      ${sl.image && sl.image.url ? `<img src="${esc(sl.image.url)}" class="img-preview"><label style="font-weight:400"><input type="checkbox" class="sl-noimg"> Remover esta imagem</label>` : ""}
      <label>Conteúdo (um tópico por linha) <textarea class="sl-bullets" rows="5">${esc((sl.bullets || []).join("\n"))}</textarea></label>
      <div class="row-actions"><button type="button" class="danger" onclick="this.closest('[data-slide]').remove()">Excluir slide</button></div>
    </div>`;
}

function collectSlides() {
  const slides = [];
  document.querySelectorAll("#sem-slides [data-slide]").forEach((div) => {
    const type = div.dataset.slidetype;
    const origIdx = div.dataset.slide;
    const orig = /^\d+$/.test(origIdx) && currentSeminar ? currentSeminar.slides[Number(origIdx)] : null;
    if (type === "title") {
      slides.push({ type, title: div.querySelector(".sl-title").value, subtitle: div.querySelector(".sl-sub").value });
    } else if (type === "refs") {
      slides.push(orig || { type: "refs", title: "Referências", refs: [] });
    } else {
      const noImg = div.querySelector(".sl-noimg");
      slides.push({
        type: "content",
        title: div.querySelector(".sl-title").value,
        bullets: div.querySelector(".sl-bullets").value.split("\n").map((x) => x.trim()).filter(Boolean),
        image: noImg && noImg.checked ? null : (orig && orig.image) || null,
      });
    }
  });
  return slides;
}

function renderSeminarEditor(s) {
  $("#sem-editor").innerHTML = `
    <div class="card">
      <h3>Tema: <input id="sem-ed-theme" value="${esc(s.theme)}" style="width:60%" maxlength="120"></h3>
      <p class="meta">Status: <strong>${s.status === "aprovado" ? "Aprovado" : "Rascunho"}</strong>
        &nbsp;·&nbsp; Estilo: <select id="sem-ed-style">
          ${["moderno", "formal", "animado"].map((v) => `<option value="${v}"${(s.style || "moderno") === v ? " selected" : ""}>${v === "moderno" ? "Moderno e leve" : v === "formal" ? "Formal e elegante" : "Animado e divertido"}</option>`).join("")}
        </select></p>
      <div class="card form" style="margin-top:10px">
        <h4>Dados da capa (em maiúsculas)</h4>
        <label>Nome da instituição <input id="sem-ed-institution" class="upper" value="${esc(s.institution || "")}" maxlength="120"></label>
        <label>Nome dos alunos <input id="sem-ed-students" class="upper" value="${esc(s.students || "")}" maxlength="300"></label>
        <label>Nome da matéria <input id="sem-ed-subject" class="upper" value="${esc(s.subject || "")}" maxlength="120"></label>
        <label>Nome do professor(a) <input id="sem-ed-teacher" class="upper" value="${esc(s.teacher || "")}" maxlength="120"></label>
        <div class="sem-opts">
          <label>Fonte <select id="sem-ed-font">
            ${SEM_FONT_OPTS.map(([v, l]) => `<option value="${v}"${(s.font || "padrao") === v ? " selected" : ""}>${l}</option>`).join("")}
          </select></label>
          <label>Fundo <select id="sem-ed-bg">
            ${SEM_BG_OPTS.map(([v, l]) => `<option value="${v}"${(s.bg || "padrao") === v ? " selected" : ""}>${l}</option>`).join("")}
          </select></label>
        </div>
        <div id="sem-ed-preview-wrap"></div>
      </div>
      <div id="sem-slides">${s.slides.map((sl, i) => slideEditorHtml(sl, i)).join("")}</div>
      <div class="row-actions">
        <button type="button" class="secondary" id="sem-add-slide">+ Adicionar slide</button>
      </div>
      <hr>
      <div class="row-actions">
        <button type="button" id="sem-save">Salvar ajustes</button>
        ${s.status !== "aprovado" ? `<button type="button" id="sem-approve" class="primary">Aprovar seminário</button>` : ""}
      </div>
      <hr>
      <div class="card" style="margin-top:10px">
        <h4>🎬 Vídeo narrado</h4>
        <p class="meta">Cria um vídeo com a narração completa dos slides em português. A voz gratuita atual é única (Google); com chave OpenAI, vale a escolha masculina/feminina.</p>
        <div class="row-actions">
          <label>Voz <select id="sem-video-voice">
            <option value="feminina">Feminina</option>
            <option value="masculina">Masculina</option>
          </select></label>
          <button type="button" id="sem-video">Criar vídeo narrado</button>
        </div>
        <div class="ocr-status" id="sem-video-prog"></div>
        <div id="sem-video-preview"></div>
        <div id="sem-video-download"></div>
      </div>
      ${s.status === "aprovado" ? `
        <div class="row-actions">
          <button type="button" id="sem-pdf">Exportar PDF</button>
          <button type="button" id="sem-pptx">Exportar PowerPoint</button>
        </div>
        <div class="ocr-status" id="sem-export-prog"></div>
        <div id="sem-download"></div>
      ` : `<p class="meta">Aprove o seminário para liberar a exportação em PDF ou PowerPoint.</p>`}
    </div>`;

  let newCount = 0;
  $("#sem-add-slide").addEventListener("click", () => {
    const div = document.createElement("div");
    div.innerHTML = slideEditorHtml({ type: "content", title: "Novo slide", bullets: [] }, "new" + (newCount++));
    $("#sem-slides").appendChild(div.firstElementChild);
  });
  $("#sem-save").addEventListener("click", async () => {
    try {
      const slides = collectSlides();
      const theme = $("#sem-ed-theme").value.trim();
      const style = $("#sem-ed-style").value;
      const updated = await api("/api/seminars/" + s.id, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ theme, slides, style, ...semMetaPayload("#sem-ed-") }),
      });
      currentSeminar = updated;
      renderSeminarEditor(updated);
      loadSeminars();
      alert("Ajustes salvos!");
    } catch (e) { alert(e.message); }
  });
  const apBtn = $("#sem-approve");
  if (apBtn) apBtn.addEventListener("click", async () => {
    try {
      const slides = collectSlides();
      const theme = $("#sem-ed-theme").value.trim();
      const style = $("#sem-ed-style").value;
      const updated = await api("/api/seminars/" + s.id, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ theme, slides, style, status: "aprovado", ...semMetaPayload("#sem-ed-") }),
      });
      currentSeminar = updated;
      renderSeminarEditor(updated);
      loadSeminars();
    } catch (e) { alert(e.message); }
  });
  const pdfBtn = $("#sem-pdf"), pptxBtn = $("#sem-pptx");
  if (pdfBtn) pdfBtn.addEventListener("click", () => exportSeminar("pdf"));
  if (pptxBtn) pptxBtn.addEventListener("click", () => exportSeminar("pptx"));
  const videoBtn = $("#sem-video");
  if (videoBtn) videoBtn.addEventListener("click", createNarratedVideo);
  renderSemOptionPreviews("#sem-ed-");
}

async function exportSeminar(format) {
  const prog = $("#sem-export-prog");
  prog.textContent = format === "pdf" ? "Gerando PDF..." : "Gerando PowerPoint...";
  $("#sem-download").innerHTML = "";
  try {
    const r = await api(`/api/seminars/${currentSeminar.id}/export`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ format }),
    });
    $("#sem-download").innerHTML = `<p><a href="${esc(r.path)}" target="_blank" rel="noopener"><strong>Baixar ${format === "pdf" ? "PDF" : "PowerPoint"}</strong></a></p>`;
    prog.textContent = "";
  } catch (e) { prog.textContent = e.message; }
}

// ---------- 🎬 Vídeo narrado do seminário ----------
// O servidor gera o áudio (OpenAI TTS) por slide; o navegador monta o vídeo:
// desenha cada slide num canvas, toca o áudio e grava tudo com MediaRecorder.
function wrapCanvasText(ctx, text, x, y, maxW, lineH) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  let line = "", yy = y;
  for (const w of words) {
    const test = line ? line + " " + w : w;
    if (ctx.measureText(test).width > maxW && line) { ctx.fillText(line, x, yy); yy += lineH; line = w; }
    else line = test;
  }
  if (line) { ctx.fillText(line, x, yy); yy += lineH; }
  return yy;
}
function drawNarratedSlide(ctx, sl, idx, total) {
  const W = 1280, H = 720;
  ctx.fillStyle = "#2a0a33"; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#8e24aa"; ctx.fillRect(0, 0, W, 14);
  ctx.fillStyle = "#ffffff"; ctx.font = "bold 56px sans-serif";
  let y = wrapCanvasText(ctx, sl.title || "Seminário", 90, 140, W - 180, 68);
  y += 30;
  if (sl.type === "title" && sl.subtitle) {
    ctx.fillStyle = "#e9d5ff"; ctx.font = "32px sans-serif";
    wrapCanvasText(ctx, sl.subtitle, 90, y, W - 180, 44);
  } else if (sl.type === "refs") {
    ctx.fillStyle = "#e9d5ff"; ctx.font = "30px sans-serif";
    wrapCanvasText(ctx, "As fontes consultadas estão listadas neste slide.", 90, y, W - 180, 42);
  } else if (Array.isArray(sl.bullets)) {
    ctx.fillStyle = "#f3e5f5"; ctx.font = "30px sans-serif";
    for (const b of sl.bullets) {
      y = wrapCanvasText(ctx, "• " + b, 90, y, W - 180, 42);
      y += 14;
      if (y > H - 90) break;
    }
  }
  ctx.fillStyle = "#c4b5fd"; ctx.font = "24px sans-serif";
  ctx.fillText((idx + 1) + " / " + total, W - 150, H - 40);
}
function narratedAudio(src, ctx, dest) {
  const a = new Audio(src);
  const node = ctx.createMediaElementSource(a);
  node.connect(dest);
  node.connect(ctx.destination);
  const done = new Promise((resolve, reject) => {
    a.onended = resolve;
    a.onerror = () => reject(new Error("Falha ao tocar o áudio da narração."));
  });
  return { audio: a, done };
}
async function createNarratedVideo() {
  const prog = $("#sem-video-prog"), btn = $("#sem-video");
  const voice = $("#sem-video-voice").value;
  prog.textContent = "Gerando narração...";
  $("#sem-video-download").innerHTML = "";
  $("#sem-video-preview").innerHTML = "";
  btn.disabled = true;
  try {
    const slides = collectSlides();
    const r = await api(`/api/seminars/${currentSeminar.id}/narrate`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ voice, slides }),
    });
    const parts = r.parts || [];
    if (!parts.length) throw new Error("Nenhum áudio gerado.");
    const canvas = document.createElement("canvas");
    canvas.width = 1280; canvas.height = 720;
    const ctx = canvas.getContext("2d");
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    await audioCtx.resume();
    const dest = audioCtx.createMediaStreamDestination();
    const canvasStream = canvas.captureStream(30);
    const mixed = new MediaStream([...canvasStream.getVideoTracks(), ...dest.stream.getAudioTracks()]);
    const mime = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", ""].find((m) => !m || MediaRecorder.isTypeSupported(m));
    const rec = new MediaRecorder(mixed, mime ? { mimeType: mime } : undefined);
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    const stopped = new Promise((resolve) => { rec.onstop = resolve; });
    rec.start();
    for (let p = 0; p < parts.length; p++) {
      const part = parts[p];
      prog.textContent = `Gravando vídeo... slide ${part.slide + 1} de ${slides.length} (${p + 1}/${parts.length})`;
      drawNarratedSlide(ctx, slides[part.slide] || {}, part.slide, slides.length);
      const { audio, done } = narratedAudio(part.audio, audioCtx, dest);
      await audio.play();
      await done;
    }
    await new Promise((r2) => setTimeout(r2, 1000));
    rec.stop();
    await stopped;
    audioCtx.close();
    const blob = new Blob(chunks, { type: "video/webm" });
    const url = URL.createObjectURL(blob);
    $("#sem-video-preview").innerHTML = `<video controls src="${url}" style="width:100%;max-width:720px"></video>`;
    $("#sem-video-download").innerHTML = `<p><a href="${url}" download="seminario-${currentSeminar.id}-narrado.webm"><strong>Baixar vídeo narrado</strong></a></p>`;
    prog.textContent = r.provider === "openai" ? `Vídeo pronto! Voz: OpenAI (${r.voice}).` : "Vídeo pronto! Voz gratuita (Google).";
  } catch (e) { prog.textContent = e.message; }
  btn.disabled = false;
}

// ---------- 🩻 Análise de Raio-X ----------
const XRAY_QUALITY = ["Contraste adequado", "Imagem superexposta (clara)", "Imagem subexposta (escura)", "Posicionamento adequado", "Sobreposição de estruturas", "Artefato de movimento"];
const XRAY_REGIONS = ["Coroas dentárias", "Raízes e canais radiculares", "Região periapical", "Crista óssea alveolar e periodonto", "Seio maxilar e estruturas adjacentes", "Outras estruturas (ATM, canal mandibular etc.)"];
const XRAY_FINDINGS = ["Cárie", "Lesão periapical", "Perda óssea / doença periodontal", "Cálculo dental", "Restauração / prótese / implante", "Tratamento endodôntico", "Dente ausente / não erupcionado", "Reabsorção radicular", "Fratura", "Outro"];
let xrayImagePath = "";
let xrayFormInit = false;

function initXrayForm() {
  if (xrayFormInit) return;
  xrayFormInit = true;
  $("#xray-quality").innerHTML = XRAY_QUALITY.map((q, i) => `<label style="font-weight:400"><input type="checkbox" class="xq" value="${esc(q)}"> ${esc(q)}</label>`).join("<br>");
  $("#xray-regions").innerHTML = XRAY_REGIONS.map((r, i) => `
    <div class="card" style="margin:6px 0;padding:8px">
      <strong>${esc(r)}</strong><br>
      <label style="font-weight:400">Estado
        <select class="xr-status" data-i="${i}" style="width:auto">
          <option>Normal</option><option>Alterado</option><option>Não avaliável</option>
        </select>
      </label>
      <input class="xr-obs" data-i="${i}" placeholder="Observação (opcional)" style="margin-top:4px">
    </div>`).join("");
  $("#xray-findings").innerHTML = XRAY_FINDINGS.map((f) => `<label style="font-weight:400"><input type="checkbox" class="xf" value="${esc(f)}"> ${esc(f)}</label>`).join("<br>");
}

function xrayViewerApply() {
  const img = $("#xray-img");
  const z = $("#xray-zoom").value, c = $("#xray-contrast").value, b = $("#xray-bright").value;
  const inv = $("#xray-invert").checked ? "invert(100%)" : "";
  img.style.filter = `contrast(${c}%) brightness(${b}%) ${inv}`;
  img.style.transform = `scale(${z})`;
  img.style.transformOrigin = "top left";
}

$("#xray-file").addEventListener("change", async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const prog = $("#xray-prog");
  prog.textContent = "Enviando imagem...";
  try {
    const fd = new FormData();
    fd.append("image", f);
    const r = await api("/api/xray/upload", { method: "POST", body: fd });
    xrayImagePath = r.image_path;
    $("#xray-img").src = r.image_path;
    $("#xray-viewer-wrap").classList.remove("hidden");
    $("#xray-form-card").classList.remove("hidden");
    xrayViewerApply();
    prog.textContent = "";
    runXrayAutoAnalysis();
  } catch (err) { prog.textContent = ""; alert(err.message); }
  e.target.value = "";
});

// Análise técnica automática: roda no servidor assim que a imagem chega.
let xrayAuto = null;
async function runXrayAutoAnalysis() {
  const box = $("#xray-auto");
  box.innerHTML = `<p class="meta">Analisando a imagem automaticamente...</p>`;
  xrayAuto = null;
  try {
    const a = await api("/api/xray/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image_path: xrayImagePath }),
    });
    xrayAuto = a;
    const bars = (a.histograma || []).map((v) =>
      `<div style="flex:1;background:#2b7cd3;height:${Math.max(2, Math.round(v * 56))}px;border-radius:2px" title="${v}"></div>`
    ).join("");
    const pill = (ok) => ok ? "background:#e6f4ea;color:#1a7f37" : "background:#fdecea;color:#b3261e";
    const expOk = a.exposicao === "adequada";
    const conOk = a.contraste === "adequado";
    const nitOk = a.nitidez === "adequada";
    box.innerHTML = `
      <div class="card result-q" style="margin-top:10px">
        <h4>Análise técnica automática</h4>
        <p><span class="badge" style="${pill(expOk)}">Exposição: ${esc(a.exposicao)}</span>
        <span class="badge" style="${pill(conOk)}">Contraste: ${esc(a.contraste)}</span>
        <span class="badge" style="${pill(nitOk)}">Nitidez: ${esc(a.nitidez)}</span></p>
        <p class="meta">${a.largura} × ${a.altura}px · brilho médio ${a.brilho_medio} · índice de nitidez ${a.nitidez_score}</p>
        <div style="display:flex;align-items:flex-end;gap:2px;height:60px;margin:6px 0" aria-hidden="true">${bars}</div>
        <p class="meta">Avalia a qualidade técnica da imagem (exposição, contraste e nitidez). Não interpreta achados clínicos — a leitura segue no roteiro abaixo.</p>
      </div>`;
    autoCheckXrayQuality(a);
  } catch (err) {
    box.innerHTML = `<p class="meta">Análise automática indisponível no momento (${esc(err.message)}). Siga o roteiro de leitura abaixo.</p>`;
  }
}

// Marca sozinho os itens de qualidade técnica conforme a análise automática.
function autoCheckXrayQuality(a) {
  const want = new Set();
  if (/subexposta/.test(a.exposicao)) want.add("Imagem subexposta (escura)");
  if (/superexposta/.test(a.exposicao)) want.add("Imagem superexposta (clara)");
  if (a.contraste === "adequado") want.add("Contraste adequado");
  if (/baixa/.test(a.nitidez)) want.add("Artefato de movimento");
  document.querySelectorAll(".xq").forEach((c) => { c.checked = want.has(c.value); });
}

for (const id of ["xray-zoom", "xray-contrast", "xray-bright", "xray-invert"]) {
  document.querySelector("#" + id).addEventListener("input", xrayViewerApply);
}
$("#xray-reset").addEventListener("click", () => {
  $("#xray-zoom").value = 1; $("#xray-contrast").value = 100; $("#xray-bright").value = 100;
  $("#xray-invert").checked = false; xrayViewerApply();
});

function collectXray() {
  return {
    image_path: xrayImagePath,
    exam_type: $("#xray-type").value,
    quality: [...document.querySelectorAll(".xq:checked")].map((c) => c.value),
    regions: XRAY_REGIONS.map((label, i) => ({
      label,
      status: document.querySelector(`.xr-status[data-i="${i}"]`).value,
      obs: document.querySelector(`.xr-obs[data-i="${i}"]`).value.trim(),
    })),
    findings: [...document.querySelectorAll(".xf:checked")].map((c) => c.value),
    notes: $("#xray-notes").value.trim(),
  };
}

function buildXrayReport(d) {
  const L = [];
  L.push("ANÁLISE RADIOGRÁFICA — MATERIAL DE ESTUDO");
  L.push("Data: " + new Date().toLocaleDateString("pt-BR"));
  L.push("Tipo de exame: " + d.exam_type);
  if (xrayAuto) {
    L.push("");
    L.push("ANÁLISE TÉCNICA AUTOMÁTICA:");
    L.push(`- Exposição: ${xrayAuto.exposicao} (brilho médio ${xrayAuto.brilho_medio})`);
    L.push(`- Contraste: ${xrayAuto.contraste} (desvio-padrão ${xrayAuto.contraste_dp})`);
    L.push(`- Nitidez: ${xrayAuto.nitidez} (índice ${xrayAuto.nitidez_score})`);
    L.push(`- Dimensões: ${xrayAuto.largura} × ${xrayAuto.altura}px`);
  }
  L.push("Qualidade técnica: " + (d.quality.join("; ") || "não informada"));
  L.push("");
  L.push("AVALIAÇÃO POR REGIÃO:");
  d.regions.forEach((r) => L.push(`- ${r.label}: ${r.status}${r.obs ? " — " + r.obs : ""}`));
  L.push("");
  L.push("ACHADOS ASSINALADOS: " + (d.findings.join(", ") || "nenhum"));
  L.push("");
  L.push("IMPRESSÃO DESCRITIVA:");
  L.push(d.notes || "—");
  L.push("");
  L.push("Material de estudo — não constitui laudo diagnóstico. Na dúvida, consulte um radiologista.");
  return L.join("\n");
}

$("#xray-report-btn").addEventListener("click", () => {
  if (!xrayImagePath) { alert("Envie a imagem do raio-X primeiro."); return; }
  const d = collectXray();
  const report = buildXrayReport(d);
  $("#xray-report-view").innerHTML = `
    <div class="card result-q">
      <h4>Relatório (pré-visualização)</h4>
      <div class="feedback" style="white-space:pre-wrap">${esc(report)}</div>
      <div class="row-actions"><button type="button" class="secondary" id="xray-copy">Copiar relatório</button></div>
    </div>`;
  $("#xray-copy").addEventListener("click", () => {
    navigator.clipboard.writeText(report).then(() => alert("Relatório copiado!"));
  });
  $("#xray-report-view").dataset.report = report;
});

$("#xray-save").addEventListener("click", async () => {
  if (!xrayImagePath) { alert("Envie a imagem do raio-X primeiro."); return; }
  const d = collectXray();
  d.report = $("#xray-report-view").dataset.report || buildXrayReport(d);
  try {
    await api("/api/xray", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(d) });
    alert("Análise salva!");
    loadXrays();
  } catch (e) { alert(e.message); }
});

async function loadXrays() {
  const list = await api("/api/xray");
  $("#xray-list").innerHTML = list.length
    ? list.map((a) => `
      <div class="card">
        <img src="${esc(a.image_path)}" class="img-preview" style="max-height:120px">
        <div class="meta">${esc(a.exam_type)} · ${esc(a.created_at)}</div>
        <div class="row-actions">
          <button type="button" class="secondary" onclick="openXray(${a.id})">Ver</button>
          <button type="button" class="danger" onclick="deleteXray(${a.id})">Excluir</button>
        </div>
      </div>`).join("")
    : "<p class='meta'>Nenhuma análise salva ainda.</p>";
  $("#xray-detail").innerHTML = "";
}

async function openXray(id) {
  const a = await api("/api/xray/" + id);
  $("#xray-detail").innerHTML = `
    <div class="card">
      <h3>${esc(a.exam_type)} <span class="meta">(${esc(a.created_at)})</span></h3>
      <img src="${esc(a.image_path)}" class="img-preview" style="max-height:420px">
      <div class="feedback" style="white-space:pre-wrap">${esc(a.report)}</div>
    </div>`;
  $("#xray-detail").scrollIntoView({ behavior: "smooth" });
}

// ---------- ⚖️ Cruzamento de softwares ----------
// Dados verificados em 2026-10-22 (sites oficiais e registros do FDA).
const XRAY_AI_SOFT = [
  { nome: "Pearl — Second Opinion", site: "https://www.hellopearl.com/products/second-opinion",
    faz: "Detecta até 18 achados: cárie (inicial e avançada), perda óssea medida em mm, cálculo, radiolucidez periapical, margens de restauração defeituosas; identifica coroas, restaurações, implantes e canais.",
    exames: ["Periapical", "Interproximal (bite-wing)", "Panorâmica"],
    reg: "FDA 510(k) K210365 (2022) + ampliações; Second Opinion 3D p/ CBCT",
    custo: "Assinatura por consultório" },
  { nome: "Overjet", site: "https://www.overjet.com/",
    faz: "Detecta e contorna cárie, mede nível ósseo com precisão milimétrica, detecta cálculo e radiolucidez periapical; gera imagens anotadas para apresentar ao paciente.",
    exames: ["Periapical", "Interproximal (bite-wing)"],
    reg: "12 liberações FDA (Caries Assist, Dental Assist, Calculus, Periapical, CBCT Assist)",
    custo: "Assinatura (clínicas e redes)" },
  { nome: "VideaHealth", site: "https://www.videa.ai/",
    faz: "Detecta cárie (nos estudos p/ o FDA, reduziu em 43% as lesões não percebidas); suporte pediátrico a partir de 3 anos.",
    exames: ["Periapical", "Interproximal (bite-wing)"],
    reg: "FDA 510(k) K213795 (2022) + ampliações",
    custo: "Assinatura por consultório" },
  { nome: "Denti.AI", site: "https://www.denti.ai/",
    faz: "Detecta cárie e radiolucidez periapical, mede nível ósseo mesial/distal; o Auto-Chart numera dentes e identifica restaurações, coroas e implantes.",
    exames: ["Periapical", "Interproximal (bite-wing)", "Panorâmica"],
    reg: "FDA 510(k) K230144 (2023) — 1ª liberada p/ panorâmica + intraoral",
    custo: "Assinatura por consultório" },
];
const XRAY_VIEWERS = [
  { nome: "Weasis", site: "https://weasis.org",
    faz: "Abre DICOM 2D e 3D, MPR, reconstrução 3D, conecta ao PACS; funciona no desktop ou no navegador.",
    exames: ["Panorâmica", "Periapical", "Interproximal (bite-wing)", "Oclusal", "Telerradiografia"],
    reg: "Não certificado p/ diagnóstico primário (uso secundário/ensino)",
    custo: "Grátis, código aberto — Windows, macOS e Linux" },
  { nome: "3D Slicer", site: "https://www.slicer.org/",
    faz: "Segmentação, registro e reconstrução 3D; o melhor da lista para estudo, pesquisa e tomografias.",
    exames: ["Panorâmica", "Periapical", "Interproximal (bite-wing)", "Oclusal", "Telerradiografia"],
    reg: "Plataforma de pesquisa — não é estação clínica certificada",
    custo: "Grátis, código aberto — Windows, macOS e Linux" },
  { nome: "Horos", site: "https://horosproject.org",
    faz: "Visualizador completo com MPR e 3D, banco local de estudos e plugins.",
    exames: ["Panorâmica", "Periapical", "Interproximal (bite-wing)", "Oclusal", "Telerradiografia"],
    reg: "Não liberado p/ diagnóstico primário",
    custo: "Grátis, código aberto — macOS" },
  { nome: "RadiAnt", site: "https://radiantviewer.com",
    faz: "Rápido e completo: MPR oblíquo, medições (ROI, Cobb), importa o CD do exame.",
    exames: ["Panorâmica", "Periapical", "Interproximal (bite-wing)", "Oclusal", "Telerradiografia"],
    reg: "Não liberado p/ diagnóstico primário nos EUA",
    custo: "Teste grátis; licença anual — Windows" },
  { nome: "MicroDicom", site: "https://www.microdicom.com/",
    faz: "Leve: zoom, janela, medições de distância/ângulo/área, MPR básico.",
    exames: ["Panorâmica", "Periapical", "Interproximal (bite-wing)", "Oclusal", "Telerradiografia"],
    reg: "Versão grátis p/ uso não comercial",
    custo: "Grátis (não comercial) — Windows" },
];

function renderXrayXref() {
  const tipo = $("#xray-xref-type").value;
  const row = (s) => {
    const ok = s.exames.includes(tipo);
    return `<tr${ok ? "" : ' style="opacity:.55"'}>
      <td><strong>${esc(s.nome)}</strong><br><a href="${s.site}" target="_blank" rel="noopener">Site oficial</a></td>
      <td>${ok ? "✓ aceita" : "—"}</td>
      <td>${esc(s.faz)}</td>
      <td>${esc(s.reg)}</td>
      <td>${esc(s.custo)}</td>
    </tr>`;
  };
  const table = (list, titulo) => `
    <h4>${titulo}</h4>
    <div style="overflow-x:auto"><table class="tbl">
      <tr><th>Software</th><th>${esc(tipo)}</th><th>O que faz com a imagem</th><th>Aprovação regulatória</th><th>Custo / plataforma</th></tr>
      ${list.map(row).join("")}
    </table></div>`;
  $("#xray-xref").innerHTML =
    table(XRAY_AI_SOFT, "IA para radiografias odontológicas") +
    table(XRAY_VIEWERS, "Visualizadores DICOM (abrem .dcm)") +
    `<p class="meta">As IAs são serviços pagos integrados ao software de imagem da clínica — não dá para enviar sua imagem por aqui; use os sites oficiais para testar. Os visualizadores abrem o exame em formato DICOM (.dcm).</p>`;
}

function initXrayXref() {
  const sel = $("#xray-xref-type");
  if (!sel || sel.dataset.init) return;
  sel.dataset.init = "1";
  sel.value = $("#xray-type").value;
  sel.addEventListener("change", renderXrayXref);
  $("#xray-type").addEventListener("change", () => { sel.value = $("#xray-type").value; renderXrayXref(); });
  renderXrayXref();
}

async function deleteXray(id) {
  if (!confirm("Excluir esta análise?")) return;
  await api("/api/xray/" + id, { method: "DELETE" });
  loadXrays();
}

// ---------- Redesign: atalhos, busca do topo, estatísticas ----------
// (código próprio; apenas a linguagem visual foi inspirada no ident.com.br)
function activateTab(name) {
  const btn = document.querySelector('[data-tab="' + name + '"]');
  if (btn) btn.click();
}

$("#hero-smart").addEventListener("click", () => activateTab("smart"));
$("#hero-materias").addEventListener("click", () => activateTab("materias"));

// Sugestões clicáveis da Correção inteligente: preenchem o campo de texto
document.querySelectorAll(".sug-chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    const box = $("#auto-text");
    box.value = chip.dataset.sug || "";
    box.scrollIntoView({ behavior: "smooth", block: "center" });
    box.focus();
  });
});

// Busca global do topo: leva para Matérias e executa a busca de estudos
$("#top-search").addEventListener("keydown", (ev) => {
  if (ev.key !== "Enter") return;
  const q = ev.target.value.trim();
  activateTab("materias");
  const box = $("#study-search");
  box.value = q;
  box.dispatchEvent(new Event("input", { bubbles: true }));
  setTimeout(() => box.scrollIntoView({ behavior: "smooth", block: "center" }), 150);
});

// Faixa de estatísticas do início
async function loadStats() {
  try {
    const [exams, subjects, research] = await Promise.all([
      api("/api/exams"), api("/api/subjects"), api("/api/research"),
    ]);
    $("#stat-exams").textContent = exams.length;
    $("#stat-questions").textContent = exams.reduce((s, e) => s + (e.question_count || 0), 0);
    $("#stat-subjects").textContent = subjects.length;
    $("#stat-research").textContent = research.length;
  } catch (e) { /* mantém "–" até a API responder */ }
}
document.querySelector('[data-tab="provas"]').addEventListener("click", loadStats);
loadStats();

// ---------- Weasis: gerador de link para análise no Weasis (DICOMweb) ----------
// Modelos oficiais da integração do dcm4chee-arc-light com o Weasis
// (IID_PATIENT_URL / IID_STUDY_URL). Os {{placeholders}} são preenchidos abaixo.
const WEASIS_TPL_PATIENT = 'weasis://?$dicom:rs --url "{{qidoBaseURL}}{{qidoBasePath}}" -r "patientID={{patientID}}" --query-ext "&includedefaults=false" -H "Authorization: Bearer {{access_token}}"';
const WEASIS_TPL_STUDY = 'weasis://?$dicom:rs --url "{{qidoBaseURL}}{{qidoBasePath}}" -r "studyUID={{studyUID}}" --query-ext "&includedefaults=false" -H "Authorization: Bearer {{access_token}}"';

$("#weasis-kind").addEventListener("change", (ev) => {
  const byStudy = ev.target.value === "study";
  $("#weasis-patient-wrap").classList.toggle("hidden", byStudy);
  $("#weasis-study-wrap").classList.toggle("hidden", !byStudy);
});

$("#weasis-gen").addEventListener("click", () => {
  const out = $("#weasis-out");
  const base = $("#weasis-base").value.trim().replace(/\/+$/, "");
  const token = $("#weasis-token").value.trim();
  const byStudy = $("#weasis-kind").value === "study";
  const idVal = byStudy ? $("#weasis-study").value.trim() : $("#weasis-patient").value.trim();
  if (!base || !idVal) {
    out.innerHTML = '<p class="meta">Preencha a URL base e o ' + (byStudy ? "UID do estudo." : "ID do paciente.") + "</p>";
    return;
  }
  let url = (byStudy ? WEASIS_TPL_STUDY : WEASIS_TPL_PATIENT)
    .replace("{{qidoBaseURL}}", base)
    .replace("{{qidoBasePath}}", "")
    .replace(byStudy ? "{{studyUID}}" : "{{patientID}}", idVal);
  if (token) url = url.replace("{{access_token}}", token);
  else url = url.replace(/ -H "Authorization: Bearer \{\{access_token\}\}"/, "");
  out.innerHTML =
    '<p class="meta">Link gerado:</p>' +
    '<p><a class="weasis-link" href="' + esc(url) + '">Abrir no Weasis</a></p>' +
    '<div class="row-actions"><button type="button" class="secondary" id="weasis-copy">Copiar link</button></div>';
  $("#weasis-copy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(url); $("#weasis-copy").textContent = "Copiado!"; }
    catch (e) { $("#weasis-copy").textContent = "Não copiou — selecione o link acima"; }
  });
});

/* ---------- Calculadora de anestesia (odontologia) ----------
   Referência: doses máximas recomendadas (Malamed, Manual de Anestesia Local).
   Tubete padrão de 1,8 mL. Valores para estudo — confirmar na bula. */
const ANESTHETICS = [
  { id: "lido-epi",   name: "Lidocaína 2% + epinefrina 1:100.000",  conc: 2,   mgkg: 7.0, maxmg: 500, epiCart: 0.018, note: "Anestésico mais usado na clínica; bom equilíbrio entre potência e segurança." },
  { id: "lido-plain", name: "Lidocaína 2% sem vasoconstritor",      conc: 2,   mgkg: 4.4, maxmg: 300, epiCart: 0,     note: "Sem vasoconstritor a absorção é mais rápida: dose máxima menor e duração mais curta." },
  { id: "mepi-epi",   name: "Mepivacaína 2% + epinefrina 1:100.000", conc: 2,  mgkg: 6.6, maxmg: 400, epiCart: 0.018, note: "Alternativa à lidocaína; vasoconstrição discreta mesmo sem vasoconstritor associado." },
  { id: "mepi-plain", name: "Mepivacaína 3% sem vasoconstritor",    conc: 3,   mgkg: 6.6, maxmg: 400, epiCart: 0,     note: "Útil quando o vasoconstritor é contraindicado; duração pulpar em torno de 20 a 40 min." },
  { id: "arti",       name: "Articaína 4% + epinefrina 1:100.000",  conc: 4,   mgkg: 7.0, maxmg: 500, epiCart: 0.018, note: "Alta difusão tecidual; evitar em menores de 4 anos (bula)." },
  { id: "prilo",      name: "Prilocaína 4% com felipressina",       conc: 4,   mgkg: 6.0, maxmg: 400, epiCart: 0,     note: "Risco de metemoglobinemia: cautela em crianças pequenas, gestantes e anêmicos." },
  { id: "bupi",       name: "Bupivacaína 0,5% + epinefrina 1:200.000", conc: 0.5, mgkg: 2.0, maxmg: 90, epiCart: 0.009, note: "Longa duração (anestesia pulpar de até 8 h): orientar o paciente contra mordedura de lábio e língua." },
];
const fmtBR = (n, d = 1) => Number(n).toFixed(d).replace(".", ",").replace(/,0$/, "");

function anCalc() {
  const peso = Math.max(3, parseFloat($("#an-peso").value) || 0);
  const idade = parseFloat($("#an-idade").value) || 0;
  const cardio = $("#an-cardio").checked;
  const a = ANESTHETICS.find(x => x.id === $("#an-agente").value) || ANESTHETICS[0];
  const mgCart = a.conc * 10 * 1.8;                       // mg por tubete (1,8 mL)
  const doseMg = Math.min(peso * a.mgkg, a.maxmg);         // dose máxima em mg
  const cartsDose = Math.floor(doseMg / mgCart);           // tubetes pelo anestésico
  const epiMax = cardio ? 0.04 : 0.2;                     // mg de epinefrina
  const cartsEpi = a.epiCart > 0 ? Math.floor(epiMax / a.epiCart + 1e-9) : Infinity;
  const carts = Math.max(0, Math.min(cartsDose, cartsEpi));
  const totalMg = carts * mgCart;
  const totalEpi = carts * a.epiCart;
  const limitante = a.epiCart > 0 && cartsEpi < cartsDose
    ? "vasoconstritor (epinefrina)" : "dose do anestésico";

  $("#an-dose").textContent = fmtBR(doseMg, 0) + " mg";
  $("#an-carts").textContent = carts + (carts === 1 ? " tubete" : " tubetes");
  $("#an-mgcart").textContent = fmtBR(mgCart, mgCart % 1 ? 1 : 0) + " mg";
  $("#an-epi").textContent = a.epiCart > 0 ? fmtBR(totalEpi, 3) + " mg" : "—";

  let info = `<div class="feedback">Para ${fmtBR(peso, peso % 1 ? 1 : 0)} kg, o limite é de <strong>${carts} ${carts === 1 ? "tubete" : "tubetes"}</strong> `
    + `(${fmtBR(totalMg, 0)} mg), limitado pela ${limitante}. Cada tubete de 1,8 mL contém ${fmtBR(mgCart, mgCart % 1 ? 1 : 0)} mg do anestésico.`;
  if (a.epiCart > 0) info += ` Epinefrina total: ${fmtBR(totalEpi, 3)} mg (limite ${fmtBR(epiMax, 2)} mg).`;
  info += `</div><div class="feedback">${a.note}</div>`;
  $("#an-info").innerHTML = info;

  const warns = [];
  if (cardio && a.epiCart > 0) warns.push("Paciente cardiopata: a epinefrina foi limitada a 0,04 mg no total. Monitore pressão e frequência cardíaca.");
  if (a.id === "arti" && idade < 4) warns.push("Articaína: bula contraindica o uso em menores de 4 anos.");
  if (a.id === "prilo") warns.push("Prilocaína: risco de metemoglobinemia. Evite doses altas e cautela em crianças pequenas, gestantes e pacientes anêmicos.");
  if (a.id === "bupi") warns.push("Bupivacaína: anestesia muito prolongada. Oriente o paciente a não morder lábio, língua ou bochecha enquanto durar a dormência.");
  if (carts === 0) warns.push("Peso muito baixo para este anestésico: nenhum tubete completo cabe na dose máxima. Reavalie a escolha do anestésico.");
  $("#an-warnings").innerHTML = warns.map(w => `<div class="feedback">⚠️ ${w}</div>`).join("");
}

(function anInit() {
  const tb = document.querySelector("#an-table tbody");
  if (!tb) return;
  tb.innerHTML = ANESTHETICS.map(a => {
    const mgCart = a.conc * 10 * 1.8;
    return `<tr><td>${a.name}</td><td>${fmtBR(a.mgkg, 1)} mg/kg</td><td>${a.maxmg} mg</td>`
      + `<td>${fmtBR(mgCart, mgCart % 1 ? 1 : 0)} mg</td>`
      + `<td>${a.epiCart > 0 ? fmtBR(a.epiCart, 3) + " mg" : "—"}</td></tr>`;
  }).join("");
  ["an-peso", "an-idade", "an-agente"].forEach(id => $("#" + id).addEventListener("input", anCalc));
  $("#an-cardio").addEventListener("change", anCalc);
  anCalc();
})();

/* ---------- Hamburger (mobile): abre/recolhe o menu por completo ---------- */
(function menuInit() {
  const btn = $("#menu-btn");
  if (!btn) return;
  btn.addEventListener("click", () => {
    const open = document.body.classList.toggle("menu-open");
    btn.setAttribute("aria-expanded", String(open));
    btn.textContent = open ? "✕" : "☰";
    btn.setAttribute("aria-label", open ? "Fechar menu" : "Abrir menu");
  });
  document.querySelectorAll("nav .tab").forEach(t => t.addEventListener("click", () => {
    if (document.body.classList.contains("menu-open")) btn.click();
  }));
})();

/* ---------- Prévias de estilo, fonte e fundo do seminário ----------
   Cada opção ganha uma miniatura clicável; o painel mostra o slide com a
   combinação escolhida (fundo + fonte + estilo), igual ao que sai no PDF/PPTX. */
const SEM_FONT_CSS = { padrao: "Nunito, system-ui, sans-serif", serifada: "'Times New Roman', serif", georgia: "Georgia, serif", verdana: "Verdana, sans-serif", courier: "'Courier New', monospace", comic: "'Comic Sans MS', cursive" };
const SEM_BG_COLOR = { roxo: "#6d28d9", azul: "#1e40af", verde: "#166534", vinho: "#881337", cinza: "#374151", claro: "#e9d5ff" };
const SEM_STYLE_COLORS = {
  moderno: { primary: "#0e7f8f", accent: "#f5a623", label: "Moderno e leve" },
  formal: { primary: "#1a365d", accent: "#c9a227", label: "Formal e elegante" },
  animado: { primary: "#6d28d9", accent: "#fb7185", label: "Animado e divertido" },
};
let semFundosCache = null;
async function semFundos() {
  if (!semFundosCache) {
    try { semFundosCache = await (await fetch("/fundos.json")).json(); }
    catch { semFundosCache = {}; }
  }
  return semFundosCache;
}

async function renderSemOptionPreviews(prefix) {
  const wrap = $(prefix + "preview-wrap");
  if (!wrap) return;
  const fundos = await semFundos();
  const bgThumb = ([v, l]) => {
    if (v.startsWith("infantil-")) {
      const uri = fundos[v] || "";
      return `<button type="button" class="sem-opt" data-kind="bg" data-val="${v}" title="${esc(l)}"><div class="sem-opt-thumb" style="background-image:url('${uri}')"></div><div class="sem-opt-label">${esc(l.replace(/^Infantil \d+: /, ""))}</div></button>`;
    }
    const c = v === "padrao" ? "linear-gradient(135deg,#0e7f8f,#0a4f5c)" : (SEM_BG_COLOR[v] || "#ccc");
    return `<button type="button" class="sem-opt" data-kind="bg" data-val="${v}" title="${esc(l)}"><div class="sem-opt-thumb" style="background:${c}"></div><div class="sem-opt-label">${esc(l)}</div></button>`;
  };
  wrap.innerHTML = `
    <div class="sem-preview" data-pv>
      <div class="sem-preview-inner">
        <div class="sem-preview-title">Título do slide</div>
        <div class="sem-preview-text">Exemplo de texto com a fonte e o fundo escolhidos. O título sai em negrito e o conteúdo fica legível sobre o fundo.</div>
      </div>
    </div>
    <p class="meta" style="margin-top:12px">Prévia do estilo — toque para escolher:</p>
    <div class="sem-opt-row">
      ${Object.entries(SEM_STYLE_COLORS).map(([v, s]) => `
        <button type="button" class="sem-opt sem-style-card" data-kind="style" data-val="${v}" title="${s.label}">
          <div class="sem-style-head" style="background:${s.primary}"></div>
          <div class="sem-style-bar" style="background:${s.accent}"></div>
          <div class="sem-style-body"><b>Título</b><div></div><div style="width:70%"></div></div>
          <div class="sem-opt-label">${s.label}</div>
        </button>`).join("")}
    </div>
    <p class="meta" style="margin-top:12px">Prévia da fonte — toque para escolher:</p>
    <div class="sem-opt-row">
      ${SEM_FONT_OPTS.map(([v, l]) => `
        <button type="button" class="sem-opt sem-opt-font" data-kind="font" data-val="${v}" style="font-family:${SEM_FONT_CSS[v]}" title="${l}">Texto de exemplo<div class="sem-opt-label">${l}</div></button>`).join("")}
    </div>
    <p class="meta" style="margin-top:12px">Prévia do fundo — toque para escolher:</p>
    <div class="sem-opt-row">${SEM_BG_OPTS.map(bgThumb).join("")}</div>`;
  const sync = () => updateSemPreview(prefix);
  wrap.querySelectorAll("[data-kind]").forEach(btn => btn.addEventListener("click", () => {
    const sel = $(prefix + (btn.dataset.kind === "style" ? "style" : btn.dataset.kind === "font" ? "font" : "bg"));
    if (sel) sel.value = btn.dataset.val;
    sync();
  }));
  ["style", "font", "bg"].forEach(k => {
    const sel = $(prefix + k);
    if (sel) sel.addEventListener("change", sync);
  });
  sync();
}

async function updateSemPreview(prefix) {
  const wrap = $(prefix + "preview-wrap");
  if (!wrap) return;
  const pv = wrap.querySelector("[data-pv]");
  if (!pv) return;
  const style = $(prefix + "style") ? $(prefix + "style").value : "moderno";
  const font = $(prefix + "font") ? $(prefix + "font").value : "padrao";
  const bg = $(prefix + "bg") ? $(prefix + "bg").value : "padrao";
  const inner = pv.querySelector(".sem-preview-inner");
  inner.style.fontFamily = SEM_FONT_CSS[font] || SEM_FONT_CSS.padrao;
  if (bg && bg.startsWith("infantil-")) {
    const fundos = await semFundos();
    pv.style.backgroundImage = fundos[bg] ? `url("${fundos[bg]}")` : "";
    pv.style.backgroundColor = "";
  } else if (bg && SEM_BG_COLOR[bg]) {
    pv.style.backgroundImage = "";
    pv.style.backgroundColor = SEM_BG_COLOR[bg];
  } else {
    pv.style.backgroundImage = "";
    pv.style.backgroundColor = (SEM_STYLE_COLORS[style] || SEM_STYLE_COLORS.moderno).primary;
  }
  wrap.querySelectorAll("[data-kind]").forEach(btn => {
    const cur = btn.dataset.kind === "style" ? style : btn.dataset.kind === "font" ? font : bg;
    btn.classList.toggle("sel", btn.dataset.val === cur);
  });
}

// Prévias do formulário de geração do seminário
renderSemOptionPreviews("#sem-");
