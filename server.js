import express from "express";
import multer from "multer";
import crypto from "node:crypto";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { db, row, all, run } from "./db.js";
import { gradeQuestion } from "./grade.js";
import { researchQuestion, sleep } from "./research.js";
import { generateSeminar, exportSeminarPdf, exportSeminarPptx } from "./seminar.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || ".png";
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\//.test(file.mimetype)) cb(null, true);
    else cb(new Error("Apenas arquivos de imagem são aceitos."));
  },
});

const app = express();
app.use(express.json({ limit: "2mb" }));

// Proteção por senha (HTTP Basic). Ativa quando APP_PASSWORD está definida.
// Proteção por senha (HTTP Basic) — reativada em 2026-10-22 a pedido do usuário,
// junto com o Funnel público. Usa as credenciais já configuradas no PC via setx
// (APP_USER/APP_PASSWORD). Sem elas definidas, o sistema abre sem senha.
const APP_PASSWORD = process.env.APP_PASSWORD || "";
const APP_USER = process.env.APP_USER || "";
app.use((req, res, next) => {
  if (!APP_PASSWORD) return next();
  const header = req.headers.authorization || "";
  const [scheme, encoded] = header.split(" ");
  let user = "";
  let provided = "";
  if (scheme === "Basic" && encoded) {
    try {
      const decoded = Buffer.from(encoded, "base64").toString("utf8");
      const i = decoded.indexOf(":");
      user = decoded.slice(0, i);
      provided = decoded.slice(i + 1);
    } catch { /* ignora */ }
  }
  const a = Buffer.from(provided);
  const b = Buffer.from(APP_PASSWORD);
  const passOk = a.length === b.length && crypto.timingSafeEqual(a, b);
  const userOk = !APP_USER || user === APP_USER;
  if (!passOk || !userOk) {
    res.set("WWW-Authenticate", 'Basic realm="Correcao de Provas"');
    return res.status(401).json({ error: "Informe usuário e senha para acessar." });
  }
  next();
});

// Erros fora das rotas (ex.: JSON inválido) também voltam em JSON para a API
app.use("/api", (err, req, res, next) => {
  console.error("API error:", err && err.message);
  res.status(err.status || 500).json({ error: (err && err.message) || "Erro interno." });
});

app.use("/uploads", express.static(UPLOAD_DIR));
app.use(express.static(path.join(__dirname, "public")));

// ---------- Provas ----------
app.get("/api/exams", (req, res) => {
  const exams = all(
    `SELECT e.*, (SELECT COUNT(*) FROM questions q WHERE q.exam_id = e.id) AS question_count
     FROM exams e ORDER BY e.id DESC`
  );
  res.json(exams);
});

app.post("/api/exams", (req, res) => {
  const { title, description } = req.body || {};
  if (!title || !String(title).trim()) {
    return res.status(400).json({ error: "Título da prova é obrigatório." });
  }
  const r = run("INSERT INTO exams (title, description) VALUES (?, ?)", String(title).trim(), String(description || "").trim());
  res.status(201).json(row("SELECT * FROM exams WHERE id = ?", r.lastInsertRowid));
});

app.get("/api/exams/:id", (req, res) => {
  const exam = row("SELECT * FROM exams WHERE id = ?", req.params.id);
  if (!exam) return res.status(404).json({ error: "Prova não encontrada." });
  exam.questions = all("SELECT * FROM questions WHERE exam_id = ? ORDER BY position, id", exam.id).map(parseQuestion);
  res.json(exam);
});

app.delete("/api/exams/:id", (req, res) => {
  run("DELETE FROM exams WHERE id = ?", req.params.id);
  res.json({ ok: true });
});

// ---------- Questões ----------
app.post("/api/exams/:id/questions", (req, res) => {
  const exam = row("SELECT id FROM exams WHERE id = ?", req.params.id);
  if (!exam) return res.status(404).json({ error: "Prova não encontrada." });
  const { type, statement, options, answer_key, model_answer, keywords, weight } = req.body || {};
  if (!["objetiva", "discursiva"].includes(type)) {
    return res.status(400).json({ error: "Tipo deve ser 'objetiva' ou 'discursiva'." });
  }
  if (!statement || !String(statement).trim()) {
    return res.status(400).json({ error: "Enunciado é obrigatório." });
  }
  if (type === "objetiva") {
    const opts = Array.isArray(options) ? options.filter((o) => String(o).trim()) : [];
    if (opts.length < 2) return res.status(400).json({ error: "Questão objetiva precisa de ao menos 2 alternativas." });
    if (!/^[A-Ea-e]$/.test(String(answer_key || "").trim())) {
      return res.status(400).json({ error: "Gabarito deve ser uma letra de A a E." });
    }
  }
  const pos = row("SELECT COALESCE(MAX(position), -1) + 1 AS p FROM questions WHERE exam_id = ?", exam.id).p;
  const r = run(
    `INSERT INTO questions (exam_id, type, statement, options, answer_key, model_answer, keywords, weight, position)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    exam.id,
    type,
    String(statement).trim(),
    JSON.stringify(Array.isArray(options) ? options : []),
    String(answer_key || "").trim().toUpperCase(),
    String(model_answer || "").trim(),
    JSON.stringify(Array.isArray(keywords) ? keywords : []),
    Number(weight) > 0 ? Number(weight) : 1,
    pos
  );
  res.status(201).json(parseQuestion(row("SELECT * FROM questions WHERE id = ?", r.lastInsertRowid)));
});

app.delete("/api/questions/:id", (req, res) => {
  run("DELETE FROM questions WHERE id = ?", req.params.id);
  res.json({ ok: true });
});

// ---------- Submissões (responder + corrigir) ----------
// multipart: exam_id, student_name, answers (JSON: {questionId: "texto"}), arquivos image_<questionId>
app.post("/api/submissions", upload.any(), (req, res) => {
  try {
    const examId = Number(req.body.exam_id);
    const exam = row("SELECT id FROM exams WHERE id = ?", examId);
    if (!exam) return res.status(404).json({ error: "Prova não encontrada." });

    let answers = {};
    try {
      answers = JSON.parse(req.body.answers || "{}");
    } catch {
      return res.status(400).json({ error: "Campo 'answers' inválido." });
    }

    const questions = all("SELECT * FROM questions WHERE exam_id = ? ORDER BY position, id", examId).map(parseQuestion);
    if (!questions.length) return res.status(400).json({ error: "A prova não tem questões." });

    const images = {};
    for (const f of req.files || []) {
      const m = f.fieldname.match(/^image_(\d+)$/);
      if (m) images[m[1]] = `/uploads/${f.filename}`;
    }

    const graded = questions.map((q) => {
      const text = String(answers[q.id] ?? "").trim();
      const g = gradeQuestion(q, text);
      return { question: q, response_text: text, image_path: images[q.id] || "", ...g };
    });

    const total = Math.round(graded.reduce((s, a) => s + a.score, 0) * 100) / 100;
    const max = Math.round(graded.reduce((s, a) => s + a.max_score, 0) * 100) / 100;

    let submissionId;
    db.exec("BEGIN");
    try {
      const s = run(
        "INSERT INTO submissions (exam_id, student_name, total_score, max_score) VALUES (?, ?, ?, ?)",
        examId,
        String(req.body.student_name || "").trim(),
        total,
        max
      );
      submissionId = Number(s.lastInsertRowid);
      const stmt = db.prepare(
        "INSERT INTO answers (submission_id, question_id, response_text, image_path, score, max_score, feedback) VALUES (?, ?, ?, ?, ?, ?, ?)"
      );
      for (const a of graded) {
        stmt.run(submissionId, a.question.id, a.response_text, a.image_path, a.score, a.max_score, a.feedback);
      }
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }

    res.status(201).json(buildSubmission(submissionId));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Falha ao corrigir a prova." });
  }
});

app.get("/api/submissions", (req, res) => {
  const { exam_id } = req.query;
  const subs = exam_id
    ? all("SELECT * FROM submissions WHERE exam_id = ? ORDER BY id DESC", exam_id)
    : all("SELECT * FROM submissions ORDER BY id DESC");
  res.json(subs);
});

app.get("/api/submissions/:id", (req, res) => {
  const sub = buildSubmission(req.params.id);
  if (!sub) return res.status(404).json({ error: "Submissão não encontrada." });
  res.json(sub);
});

app.delete("/api/submissions/:id", (req, res) => {
  run("DELETE FROM submissions WHERE id = ?", req.params.id);
  res.json({ ok: true });
});

// ---------- Pesquisa inteligente (OCR + cruzamento na internet) ----------
// multipart: title, items (JSON: [{text, type, options}]), arquivos image_<idx>
app.post("/api/research", upload.any(), async (req, res) => {
  try {
    let items = [];
    try {
      items = JSON.parse(req.body.items || "[]");
    } catch {
      return res.status(400).json({ error: "Campo 'items' inválido." });
    }
    items = items.filter((it) => it && String(it.text || "").trim()).slice(0, 12);
    if (!items.length) return res.status(400).json({ error: "Envie ao menos uma questão." });

    const images = {};
    for (const f of req.files || []) {
      const m = f.fieldname.match(/^image_(\d+)$/);
      if (m) images[m[1]] = `/uploads/${f.filename}`;
    }

    // Lotes: o frontend envia as questões em lotes de 5 passando run_id + index_base.
    // O progresso parcial fica salvo — nenhuma questão é perdida se um lote falhar.
    const base = Number(req.body.index_base) || 0;
    // transient=1: responde sem salvar no histórico (ex.: resposta sintetizada)
    const transient = String(req.body.transient || "") === "1";
    let runId = 0;
    if (!transient) {
      runId = Number(req.body.run_id) || 0;
      if (!runId || !row("SELECT id FROM research_runs WHERE id = ?", runId)) {
        runId = run(
          "INSERT INTO research_runs (title) VALUES (?)",
          String(req.body.title || "Pesquisa inteligente").trim()
        ).lastInsertRowid;
      }
    }

    const results = [];
    for (let idx = 0; idx < items.length; idx++) {
      const it = items[idx];
      const type = it.type === "objetiva" ? "objetiva" : "discursiva";
      const options = Array.isArray(it.options) ? it.options.filter((o) => String(o).trim()).slice(0, 5) : [];
      let r;
      try {
        r = await researchQuestion({ text: String(it.text), type, options });
      } catch (e) {
        r = { error: "Falha na pesquisa desta questão." };
      }
      const rowId = transient ? 0 : run(
        `INSERT INTO research_items
           (run_id, question_text, qtype, options, image_path, image_kind, suggested, suggested_text, suggested_short, justification, confidence, evidence, note, error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        runId,
        String(it.text).trim(),
        type,
        JSON.stringify(options),
        images[base + idx] || "",
        it.image_kind === "raio-x" ? "raio-x" : "foto",
        r.suggested || "",
        String(r.suggested_text || "").slice(0, 2000),
        String(r.suggested_short || "").slice(0, 600),
        String(r.justification || "").slice(0, 1200),
        Number(r.confidence) || 0,
        JSON.stringify(r.evidence || []),
        r.note || "",
        r.error || ""
      ).lastInsertRowid;
      results.push({ id: rowId, ...it, ...r, image_path: images[base + idx] || "" });
      if (idx < items.length - 1) await sleep(1200); // intervalo educado entre buscas
    }

    if (transient) {
      return res.json({ transient: true, title: String(req.body.title || "Resposta sintetizada").trim(), items: results });
    }
    res.status(201).json(buildResearchRun(runId));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Falha na pesquisa inteligente." });
  }
});

app.get("/api/research", (req, res) => {
  res.json(all("SELECT * FROM research_runs ORDER BY id DESC"));
});

app.get("/api/research/:id", (req, res) => {
  const r = buildResearchRun(req.params.id);
  if (!r) return res.status(404).json({ error: "Pesquisa não encontrada." });
  res.json(r);
});

app.delete("/api/research/:id", (req, res) => {
  run("DELETE FROM research_runs WHERE id = ?", req.params.id);
  res.json({ ok: true });
});

// ---------- Matérias (biblioteca de apoio ao estudo) ----------
app.get("/api/subjects", (req, res) => {
  const subjects = all(
    `SELECT s.*,
       (SELECT COUNT(*) FROM study_questions q WHERE q.subject_id = s.id) AS question_count,
       (SELECT COUNT(*) FROM study_materials m WHERE m.subject_id = s.id) AS material_count
     FROM subjects s ORDER BY s.position, s.id`
  );
  res.json(subjects);
});

app.get("/api/subjects/:id", (req, res) => {
  const s = row("SELECT * FROM subjects WHERE id = ?", req.params.id);
  if (!s) return res.status(404).json({ error: "Matéria não encontrada." });
  s.questions = all("SELECT * FROM study_questions WHERE subject_id = ? ORDER BY id", s.id).map((q) => {
    try { q.options = JSON.parse(q.options || "[]"); } catch { q.options = []; }
    return q;
  });
  s.materials = all("SELECT id, subject_id, filename, file_path, file_type, created_at FROM study_materials WHERE subject_id = ? ORDER BY id DESC", s.id);
  res.json(s);
});

app.get("/api/study-materials/:id/text", (req, res) => {
  const m = row("SELECT extracted_text FROM study_materials WHERE id = ?", req.params.id);
  if (!m) return res.status(404).json({ error: "Material não encontrado." });
  res.json({ text: m.extracted_text || "" });
});

app.post("/api/subjects/:id/questions", (req, res) => {
  const s = row("SELECT id FROM subjects WHERE id = ?", req.params.id);
  if (!s) return res.status(404).json({ error: "Matéria não encontrada." });
  const { type, statement, options, answer, explanation, source } = req.body || {};
  if (!["objetiva", "discursiva"].includes(type)) {
    return res.status(400).json({ error: "Tipo deve ser 'objetiva' ou 'discursiva'." });
  }
  if (!statement || !String(statement).trim()) {
    return res.status(400).json({ error: "Enunciado é obrigatório." });
  }
  const r = run(
    `INSERT INTO study_questions (subject_id, type, statement, options, answer, explanation, source)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    s.id,
    type,
    String(statement).trim(),
    JSON.stringify(Array.isArray(options) ? options.filter((o) => String(o).trim()) : []),
    String(answer || "").trim(),
    String(explanation || "").trim(),
    String(source || "").trim()
  );
  res.status(201).json(row("SELECT * FROM study_questions WHERE id = ?", r.lastInsertRowid));
});

app.delete("/api/study-questions/:id", (req, res) => {
  run("DELETE FROM study_questions WHERE id = ?", req.params.id);
  res.json({ ok: true });
});

const uploadMaterial = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^(image\/|application\/pdf)/.test(file.mimetype)) cb(null, true);
    else cb(new Error("Apenas PDF ou imagens são aceitos."));
  },
});

// multipart: file (PDF ou imagem), extracted_text (extraído no navegador)
app.post("/api/subjects/:id/materials", uploadMaterial.single("file"), (req, res) => {
  const s = row("SELECT id FROM subjects WHERE id = ?", req.params.id);
  if (!s) return res.status(404).json({ error: "Matéria não encontrada." });
  if (!req.file) return res.status(400).json({ error: "Envie um PDF ou imagem." });
  const r = run(
    `INSERT INTO study_materials (subject_id, filename, file_path, file_type, extracted_text)
     VALUES (?, ?, ?, ?, ?)`,
    s.id,
    req.file.originalname || "arquivo",
    `/uploads/${req.file.filename}`,
    req.file.mimetype === "application/pdf" ? "pdf" : "imagem",
    String(req.body.extracted_text || "").slice(0, 200000)
  );
  res.status(201).json(row("SELECT id, subject_id, filename, file_path, file_type, created_at FROM study_materials WHERE id = ?", r.lastInsertRowid));
});

app.delete("/api/study-materials/:id", (req, res) => {
  const m = row("SELECT * FROM study_materials WHERE id = ?", req.params.id);
  if (m) {
    try { fs.unlinkSync(path.join(UPLOAD_DIR, path.basename(m.file_path))); } catch { /* segue */ }
    run("DELETE FROM study_materials WHERE id = ?", req.params.id);
  }
  res.json({ ok: true });
});

app.get("/api/study-search", (req, res) => {
  const term = String(req.query.q || "").trim();
  if (term.length < 2) return res.json({ questions: [], materials: [] });
  const q = `%${term}%`;
  const questions = all(
    `SELECT q.*, s.name AS subject_name FROM study_questions q
     JOIN subjects s ON s.id = q.subject_id
     WHERE q.statement LIKE ? OR q.explanation LIKE ? OR q.answer LIKE ? LIMIT 30`,
    q, q, q
  );
  const materials = all(
    `SELECT m.id, m.subject_id, m.filename, m.file_type, m.created_at, s.name AS subject_name,
       substr(m.extracted_text, 1, 300) AS snippet FROM study_materials m
     JOIN subjects s ON s.id = m.subject_id
     WHERE m.filename LIKE ? OR m.extracted_text LIKE ? LIMIT 30`,
    q, q
  );
  res.json({ questions, materials });
});

// ---------- Seminários ----------
const SEMINAR_STYLE_VALUES = ["moderno", "formal", "animado"];
const SEMINAR_FONT_VALUES = ["padrao", "serifada", "georgia", "verdana", "courier", "comic"];
const SEMINAR_BG_VALUES = ["padrao", "roxo", "azul", "verde", "vinho", "cinza", "claro",
  "infantil-1", "infantil-2", "infantil-3", "infantil-4", "infantil-5",
  "infantil-6", "infantil-7", "infantil-8", "infantil-9", "infantil-10"];
// Dados da capa: o usuário digita em branco e tudo sai em maiúsculas
const semUpper = (v) => String(v || "").trim().toUpperCase();
const semMeta = (body) => ({
  institution: semUpper(body && body.institution),
  students: semUpper(body && body.students),
  subject: semUpper(body && body.subject),
  teacher: semUpper(body && body.teacher),
  font: SEMINAR_FONT_VALUES.includes(body && body.font) ? body.font : "padrao",
  bg: SEMINAR_BG_VALUES.includes(body && body.bg) ? body.bg : "padrao",
});
app.post("/api/seminars/generate", async (req, res) => {
  try {
    const theme = String((req.body && req.body.theme) || "").trim();
    if (theme.length < 3) return res.status(400).json({ error: "Informe um tema para o seminário." });
    const style = SEMINAR_STYLE_VALUES.includes(req.body && req.body.style) ? req.body.style : "moderno";
    let slideCount = parseInt(req.body && req.body.slideCount, 10);
    if (!Number.isFinite(slideCount)) slideCount = 7;
    slideCount = Math.min(14, Math.max(4, slideCount));
    const slides = await generateSeminar(theme, { slideCount, style });
    const m = semMeta(req.body);
    const r = run("INSERT INTO seminars (theme, slides, status, style, institution, students, subject, teacher, font, bg) VALUES (?, ?, 'rascunho', ?, ?, ?, ?, ?, ?, ?)",
      theme, JSON.stringify(slides), style, m.institution, m.students, m.subject, m.teacher, m.font, m.bg);
    res.status(201).json(buildSeminar(r.lastInsertRowid));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Falha ao gerar o seminário." });
  }
});

app.get("/api/seminars", (req, res) => {
  res.json(all("SELECT id, theme, status, style, created_at FROM seminars ORDER BY id DESC"));
});

app.get("/api/seminars/:id", (req, res) => {
  const s = buildSeminar(req.params.id);
  if (!s) return res.status(404).json({ error: "Seminário não encontrado." });
  res.json(s);
});

app.put("/api/seminars/:id", (req, res) => {
  const s = row("SELECT id FROM seminars WHERE id = ?", req.params.id);
  if (!s) return res.status(404).json({ error: "Seminário não encontrado." });
  const { theme, slides, status } = req.body || {};
  if (slides && !Array.isArray(slides)) return res.status(400).json({ error: "Slides inválidos." });
  if (status && !["rascunho", "aprovado"].includes(status)) return res.status(400).json({ error: "Status inválido." });
  const m = semMeta(req.body);
  const b = req.body || {};
  run(
    "UPDATE seminars SET theme = COALESCE(?, theme), slides = COALESCE(?, slides), status = COALESCE(?, status), style = COALESCE(?, style), institution = COALESCE(?, institution), students = COALESCE(?, students), subject = COALESCE(?, subject), teacher = COALESCE(?, teacher), font = COALESCE(?, font), bg = COALESCE(?, bg) WHERE id = ?",
    theme ? String(theme).trim() : null,
    slides ? JSON.stringify(slides) : null,
    status || null,
    req.body.style || null,
    b.institution !== undefined ? m.institution : null,
    b.students !== undefined ? m.students : null,
    b.subject !== undefined ? m.subject : null,
    b.teacher !== undefined ? m.teacher : null,
    b.font !== undefined ? m.font : null,
    b.bg !== undefined ? m.bg : null,
    s.id
  );
  res.json(buildSeminar(s.id));
});

app.post("/api/seminars/:id/export", async (req, res) => {
  try {
    const s = buildSeminar(req.params.id);
    if (!s) return res.status(404).json({ error: "Seminário não encontrado." });
    if (s.status !== "aprovado") return res.status(400).json({ error: "Aprove o seminário antes de exportar." });
    const format = req.body && req.body.format === "pptx" ? "pptx" : "pdf";
    const safe = `seminario-${s.id}-${Date.now()}.${format}`;
    const dest = path.join(UPLOAD_DIR, safe);
    if (format === "pptx") await exportSeminarPptx(s, dest);
    else await exportSeminarPdf(s, dest);
    run(format === "pptx" ? "UPDATE seminars SET pptx_path = ? WHERE id = ?" : "UPDATE seminars SET pdf_path = ? WHERE id = ?", `/uploads/${safe}`, s.id);
    res.json({ path: `/uploads/${safe}` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Falha ao exportar o seminário." });
  }
});

app.delete("/api/seminars/:id", (req, res) => {
  run("DELETE FROM seminars WHERE id = ?", req.params.id);
  res.json({ ok: true });
});

// ---------- Análise de Raio-X ----------
app.post("/api/xray/upload", (req, res) => {
  upload.single("image")(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: "Envie uma imagem do raio-X." });
    res.json({ image_path: `/uploads/${req.file.filename}` });
  });
});

// Análise técnica automática da imagem (exposição, contraste, nitidez, histograma).
// Avalia a QUALIDADE TÉCNICA da imagem; não faz diagnóstico.
app.post("/api/xray/analyze", express.json(), (req, res) => {
  const imagePath = String((req.body && req.body.image_path) || "");
  if (!imagePath.startsWith("/uploads/")) {
    return res.status(400).json({ error: "Imagem inválida." });
  }
  const abs = path.join(UPLOAD_DIR, path.basename(imagePath));
  if (!fs.existsSync(abs)) {
    return res.status(404).json({ error: "Imagem não encontrada." });
  }
  const python = process.platform === "win32" ? "python" : "python3";
  execFile(python, [path.join(__dirname, "scripts", "analisar-rx.py"), abs], { timeout: 30000 }, (err, stdout) => {
    if (err) {
      console.error("analisar-rx:", err.message);
      return res.status(500).json({ error: "Falha na análise automática da imagem." });
    }
    try {
      res.json(JSON.parse(stdout));
    } catch {
      res.status(500).json({ error: "Falha na análise automática da imagem." });
    }
  });
});

app.post("/api/xray", express.json(), (req, res) => {
  const b = req.body || {};
  if (!b.image_path) return res.status(400).json({ error: "Envie a imagem do raio-X." });
  const r = run(
    `INSERT INTO xray_analyses (image_path, exam_type, quality, regions, findings, notes, report)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    b.image_path,
    String(b.exam_type || ""),
    JSON.stringify(b.quality || []),
    JSON.stringify(b.regions || []),
    JSON.stringify(b.findings || []),
    String(b.notes || "").slice(0, 4000),
    String(b.report || "").slice(0, 8000)
  );
  res.status(201).json(buildXray(r.lastInsertRowid));
});

app.get("/api/xray", (req, res) => {
  res.json(all("SELECT id, image_path, exam_type, created_at FROM xray_analyses ORDER BY id DESC"));
});

app.get("/api/xray/:id", (req, res) => {
  const a = buildXray(req.params.id);
  if (!a) return res.status(404).json({ error: "Análise não encontrada." });
  res.json(a);
});

app.delete("/api/xray/:id", (req, res) => {
  run("DELETE FROM xray_analyses WHERE id = ?", req.params.id);
  res.json({ ok: true });
});

function buildXray(id) {
  const a = row("SELECT * FROM xray_analyses WHERE id = ?", id);
  if (!a) return null;
  for (const k of ["quality", "regions", "findings"]) {
    try { a[k] = JSON.parse(a[k] || "[]"); } catch { a[k] = []; }
  }
  return a;
}

function buildSeminar(id) {
  const s = row("SELECT * FROM seminars WHERE id = ?", id);
  if (!s) return null;
  try { s.slides = JSON.parse(s.slides || "[]"); } catch { s.slides = []; }
  return s;
}

function buildResearchRun(id) {
  const r = row("SELECT * FROM research_runs WHERE id = ?", id);
  if (!r) return null;
  r.items = all("SELECT * FROM research_items WHERE run_id = ? ORDER BY id", id).map((it) => {
    for (const k of ["options", "evidence"]) {
      try {
        it[k] = JSON.parse(it[k] || "[]");
      } catch {
        it[k] = [];
      }
    }
    return it;
  });
  return r;
}

function parseQuestion(q) {
  if (!q) return q;
  for (const k of ["options", "keywords"]) {
    try {
      q[k] = JSON.parse(q[k] || "[]");
    } catch {
      q[k] = [];
    }
  }
  return q;
}

function buildSubmission(id) {
  const sub = row("SELECT * FROM submissions WHERE id = ?", id);
  if (!sub) return null;
  sub.exam = row("SELECT id, title FROM exams WHERE id = ?", sub.exam_id);
  sub.answers = all(
    `SELECT a.*, q.type, q.statement, q.options, q.answer_key, q.model_answer, q.position
     FROM answers a JOIN questions q ON q.id = a.question_id
     WHERE a.submission_id = ? ORDER BY q.position, q.id`,
    id
  ).map((a) => {
    try {
      a.options = JSON.parse(a.options || "[]");
    } catch {
      a.options = [];
    }
    return a;
  });
  return sub;
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Correção de provas rodando em http://localhost:${PORT}`);
});
