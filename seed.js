// Popula o banco com uma prova de exemplo: simulado de miose (anestesiologia).
import { db, run, row } from "./db.js";

const exists = row("SELECT id FROM exams WHERE title LIKE ?", "%Miose%");
if (exists) {
  console.log("Prova de exemplo já existe. Nada a fazer.");
  process.exit(0);
}

const examId = run(
  "INSERT INTO exams (title, description) VALUES (?, ?)",
  "Simulado — Miose (Anestesiologia)",
  "Questões objetivas sobre miose e toxicidade de anestésicos locais + 1 discursiva."
).lastInsertRowid;

const LETRAS = ["A", "B", "C", "D", "E"];
const objetivas = [
  {
    s: "Durante um atendimento odontológico, após a aplicação de anestesia local, o paciente passa a apresentar desorientação, confusão mental, visão dupla, gosto metálico, zumbido no ouvido, miose, náuseas e vômitos. Segundo Andrade e Ranali, a causa mais provável desse quadro é:",
    o: ["Metemoglobinemia", "Hipoglicemia", "Superdosagem do vasoconstritor", "Síndrome de hiperventilação", "Superdosagem do sal anestésico"],
    g: "E",
  },
  {
    s: "Miose é definida como:",
    o: ["Dilatação da pupila", "Contração da pupila", "Perda do reflexo fotomotor", "Assimetria entre as pupilas", "Opacificação do cristalino"],
    g: "B",
  },
  {
    s: "Qual dos fármacos abaixo, utilizado em odontologia no tratamento da xerostomia, pode causar miose como efeito?",
    o: ["Atropina", "Pilocarpina", "Adrenalina", "Dexametasona", "Nistatina"],
    g: "B",
  },
  {
    s: "Na superdosagem de anestésico local, a miose faz parte do quadro de toxicidade de qual sistema?",
    o: ["Cardiovascular", "Sistema nervoso central", "Hematológico", "Renal", "Endócrino"],
    g: "B",
  },
  {
    s: "Assinale a alternativa que associa corretamente o sinal pupilar ao fármaco:",
    o: ["Miose - atropina", "Midríase - morfina", "Miose - pilocarpina", "Midríase - pilocarpina", "Miose - adrenalina"],
    g: "C",
  },
  {
    s: "Um paciente apresenta, após anestesia com vasoconstritor, taquicardia, hipertensão, palidez e tremores, sem sinais neurológicos centrais. O quadro sugere:",
    o: ["Superdosagem do sal anestésico", "Superdosagem do vasoconstritor", "Metemoglobinemia", "Reação alérgica ao látex", "Síncope vasovagal"],
    g: "B",
  },
];

const stmt = db.prepare(
  "INSERT INTO questions (exam_id, type, statement, options, answer_key, model_answer, keywords, weight, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
);
let pos = 0;
for (const q of objetivas) {
  stmt.run(examId, "objetiva", q.s, JSON.stringify(q.o), q.g, "", "[]", 1, pos++);
}
stmt.run(
  examId,
  "discursiva",
  "Explique por que a miose é considerada um sinal de toxicidade sistêmica do anestésico local e diferencie miose de midríase.",
  "[]",
  "",
  "A miose (contração da pupila) integra o cortejo de sinais centrais da toxicidade sistêmica do anestésico local por superdosagem do sal anestésico, junto de gosto metálico, zumbido, diplopia e confusão mental. O SNC é o primeiro sistema a manifestar a toxicidade. Miose é a contração da pupila, enquanto midríase é a dilatação (ex.: atropina e adrenalina causam midríase; pilocarpina e opioides causam miose).",
  JSON.stringify(["miose", "contração", "pupila", "toxicidade", "sistêmica", "anestésico", "superdosagem", "sal", "central", "midríase", "dilatação", "pilocarpina"]),
  2,
  pos++
);

console.log(`Prova de exemplo criada (id=${examId}) com ${objetivas.length + 1} questões.`);
