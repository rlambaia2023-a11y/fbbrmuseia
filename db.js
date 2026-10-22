import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, "provas.db"));

db.exec(`
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS exams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK(type IN ('objetiva','discursiva')),
    statement TEXT NOT NULL,
    options TEXT DEFAULT '[]',
    answer_key TEXT DEFAULT '',
    model_answer TEXT DEFAULT '',
    keywords TEXT DEFAULT '[]',
    weight REAL DEFAULT 1,
    position INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
    student_name TEXT DEFAULT '',
    total_score REAL DEFAULT 0,
    max_score REAL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS answers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    submission_id INTEGER NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
    question_id INTEGER NOT NULL REFERENCES questions(id),
    response_text TEXT DEFAULT '',
    image_path TEXT DEFAULT '',
    score REAL DEFAULT 0,
    max_score REAL DEFAULT 0,
    feedback TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS research_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS research_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
    question_text TEXT DEFAULT '',
    qtype TEXT DEFAULT 'discursiva',
    options TEXT DEFAULT '[]',
    image_path TEXT DEFAULT '',
    image_kind TEXT DEFAULT 'foto',
    suggested TEXT DEFAULT '',
    suggested_text TEXT DEFAULT '',
    confidence REAL DEFAULT 0,
    evidence TEXT DEFAULT '[]',
    note TEXT DEFAULT '',
    error TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS subjects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    position INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS study_questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK(type IN ('objetiva','discursiva')),
    statement TEXT NOT NULL,
    options TEXT DEFAULT '[]',
    answer TEXT DEFAULT '',
    explanation TEXT DEFAULT '',
    source TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS study_materials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    filename TEXT DEFAULT '',
    file_path TEXT DEFAULT '',
    file_type TEXT DEFAULT '',
    extracted_text TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS seminars (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    theme TEXT NOT NULL,
    slides TEXT DEFAULT '[]',
    status TEXT DEFAULT 'rascunho',
    pdf_path TEXT DEFAULT '',
    pptx_path TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS xray_analyses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    image_path TEXT DEFAULT '',
    exam_type TEXT DEFAULT '',
    quality TEXT DEFAULT '[]',
    regions TEXT DEFAULT '[]',
    findings TEXT DEFAULT '[]',
    notes TEXT DEFAULT '',
    report TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  );
`);
// Migração: tema visual do seminário (moderno | formal | animado)
{
  const _semCols = db.prepare("PRAGMA table_info(seminars)").all().map((c) => c.name);
  if (!_semCols.includes("style")) db.exec("ALTER TABLE seminars ADD COLUMN style TEXT DEFAULT 'moderno'");
}


// Migração idempotente: colunas do padrão de resolução (justificativa + versão curta)
for (const col of ["suggested_short TEXT DEFAULT ''", "justification TEXT DEFAULT ''"]) {
  try {
    db.exec(`ALTER TABLE research_items ADD COLUMN ${col}`);
  } catch {
    /* coluna já existe */
  }
}

export function row(sql, ...params) {
  return db.prepare(sql).get(...params);
}
export function all(sql, ...params) {
  return db.prepare(sql).all(...params);
}
export function run(sql, ...params) {
  return db.prepare(sql).run(...params);
}

// Matérias do curso de Odontologia (seed executado uma única vez)
const SUBJECT_SEED = [
  ["Anatomia Humana", "Estruturas do corpo humano com foco em cabeça e pescoço."],
  ["Anatomia Dental", "Morfologia dos dentes decíduos e permanentes."],
  ["Histologia e Embriologia", "Tecidos bucais e desenvolvimento das estruturas orofaciais."],
  ["Fisiologia", "Funções do organismo e do sistema estomatognático."],
  ["Bioquímica", "Processos químicos da vida: saliva, cárie e metabolismo."],
  ["Microbiologia e Imunologia", "Microrganismos bucais, placa bacteriana e defesa do organismo."],
  ["Patologia Geral", "Mecanismos das doenças e resposta dos tecidos."],
  ["Farmacologia", "Fármacos em odontologia: anestésicos, antibióticos, analgésicos e interações."],
  ["Anestesiologia", "Técnicas anestésicas, anestésicos locais e controle da dor."],
  ["Radiologia Odontológica", "Técnicas radiográficas, interpretação e radioproteção."],
  ["Semiologia e Diagnóstico", "Anamnese, exame clínico e plano de tratamento."],
  ["Materiais Dentários", "Propriedades e indicações dos materiais restauradores."],
  ["Biossegurança", "Controle de infecção, esterilização e EPIs."],
  ["Oclusão", "Contatos dentários, ATM e disfunções temporomandibulares."],
  ["Dentística Restauradora", "Restaurações diretas e indiretas em dentes anteriores e posteriores."],
  ["Endodontia", "Tratamento de canal: diagnóstico pulpar, instrumentação e obturação."],
  ["Periodontia", "Doenças periodontais, raspagem e terapia de suporte."],
  ["Prótese Parcial e Fixa", "Próteses fixas unitárias e pontes: preparos e moldagens."],
  ["Prótese Total e Removível", "Próteses totais e PPRs: planejamento e confecção."],
  ["Implantodontia", "Implantes osseointegrados: planejamento, cirurgia e prótese."],
  ["Ortodontia", "Má oclusão, aparelhos ortodônticos e ortopedia facial."],
  ["Odontopediatria", "Atendimento infantil, manejo comportamental e prevenção."],
  ["Cirurgia Oral", "Exodontias, terceiros molares e pequenas cirurgias."],
  ["Estomatologia", "Lesões bucais: diagnóstico diferencial e biópsia."],
  ["Dentística Estética", "Facetas, clareamento e estética do sorriso."],
  ["Saúde Coletiva", "SUS, epidemiologia e programas de saúde bucal."],
  ["Odontologia Legal", "Perícia, documentação e ética profissional."],
  ["Emergências Médicas", "Urgências no consultório: síncope, alergia e PCR."],
];
try {
  const c = db.prepare("SELECT COUNT(*) AS c FROM subjects").get().c;
  if (!c) {
    const stmt = db.prepare("INSERT INTO subjects (name, description, position) VALUES (?, ?, ?)");
    SUBJECT_SEED.forEach((s, i) => stmt.run(s[0], s[1], i));
  }
} catch {
  /* tabela ainda não existe em bancos muito antigos: será criada no próximo boot */
}
