// Cadastra um resumo gerado (manifesto JSON) como material de apoio da matéria.
// Uso: node scripts/registrar-material.js scripts/out/resumo-<slug>.json
// O PDF precisa estar em uploads/materials/<arquivo>.
import { run, row } from "../db.js";
import fs from "node:fs";

const manifestPath = process.argv[2];
if (!manifestPath) {
  console.error("Uso: node scripts/registrar-material.js <manifesto.json>");
  process.exit(1);
}
const m = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const subj = row("SELECT id FROM subjects WHERE name = ?", m.materia);
if (!subj) {
  console.error("Matéria não encontrada no banco:", m.materia);
  process.exit(1);
}
const r = run(
  "INSERT INTO study_materials (subject_id, filename, file_path, file_type, extracted_text) VALUES (?, ?, ?, 'pdf', ?)",
  subj.id,
  m.filename,
  "/uploads/materials/" + m.filename,
  m.text
);
console.log(`OK: material ${r.lastInsertRowid} — ${m.materia} (${m.filename})`);
