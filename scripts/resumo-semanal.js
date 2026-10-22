// Rotina semanal (todo domingo): gera um resumo em PDF para a matéria com menos
// materiais de apoio e cadastra no banco. Roda no PC via Agendador de Tarefas.
// Uso: node scripts/resumo-semanal.js
import { gerarResumo } from "./gerar-resumo.js";
import { run, row } from "../db.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(__dirname, "..");

const TOPICOS = {
  "Anatomia Humana": ["anatomia do crânio", "músculos da mastigação", "articulação temporomandibular anatomia"],
  "Anatomia Dental": ["morfologia dos pré-molares", "anatomia da câmara pulpar", "dentes decíduos morfologia"],
  "Histologia e Embriologia": ["histologia do esmalte dentário", "histologia da dentina e polpa", "embriologia do dente"],
  "Fisiologia": ["fisiologia da saliva", "fisiologia da mastigação", "fisiologia da dor orofacial"],
  "Bioquímica": ["bioquímica da cárie dental", "flúor mecanismo de ação", "metabolismo do cálcio"],
  "Microbiologia e Imunologia": ["microbiota oral", "Streptococcus mutans e cárie", "biofilme dental"],
  "Patologia Geral": ["inflamação aguda e crônica", "reparo tecidual", "necrose e apoptose"],
  "Farmacologia": ["anestésicos locais farmacologia", "profilaxia antibiótica em odontologia", "corticoides em odontologia"],
  "Anestesiologia": ["técnica pterigomandibular", "anestesia infiltrativa maxila", "complicações da anestesia local"],
  "Radiologia Odontológica": ["técnicas radiográficas periapicais", "radiografia panorâmica indicações", "proteção radiológica em odontologia"],
  "Semiologia e Diagnóstico": ["anamnese em odontologia", "exame clínico extra e intraoral", "diagnóstico diferencial de lesões bucais"],
  "Materiais Dentários": ["cimento de ionômero de vidro", "materiais de moldagem odontológicos", "amálgama dental"],
  "Biossegurança": ["esterilização em odontologia", "EPIs em odontologia", "descarte de resíduos odontológicos"],
  "Oclusão": ["determinantes da oclusão", "guia canina e função em grupo", "placa oclusal"],
  "Dentística Restauradora": ["clareamento dental caseiro e de consultório", "restaurações de amálgama", "diagnóstico de cárie"],
  "Endodontia": ["tratamento endodôntico etapas", "diagnóstico pulpar", "instrumentação de canais radiculares"],
  "Periodontia": ["doença periodontal classificação", "raspagem e alisamento radicular", "anatomia do periodonto"],
  "Prótese Parcial e Fixa": ["núcleos e pinos intrarradiculares", "coroas metalocerâmicas", "prótese adesiva"],
  "Prótese Total e Removível": ["prótese parcial removível grampos", "reembasamento de prótese total", "estomatite protética"],
  "Implantodontia": ["osseointegração", "planejamento de implantes dentários", "próteses sobre implantes"],
  "Ortodontia": ["má oclusão classificação de Angle", "aparelhos ortodônticos fixos", "cefalometria"],
  "Odontopediatria": ["cárie na primeira infância", "manejo comportamental em odontopediatria", "cronologia da dentição decídua"],
  "Cirurgia Oral": ["exodontia técnica", "terceiros molares inclusos", "pós-operatório em cirurgia oral"],
  "Estomatologia": ["lesões brancas da mucosa oral", "câncer bucal diagnóstico precoce", "aftas e úlceras orais"],
  "Dentística Estética": ["facetas e lentes de contato dental", "estética do sorriso", "restaurações estéticas anteriores"],
  "Saúde Coletiva": ["SUS e saúde bucal", "índices epidemiológicos CPOD", "fluoretação das águas"],
  "Odontologia Legal": ["identificação humana em odontologia legal", "documentação odontológica legal", "perícia em odontologia"],
  "Emergências Médicas": ["parada cardiorrespiratória no consultório", "anafilaxia em odontologia", "síncope no consultório odontológico"],
};

function slugify(s) {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

const target = row(
  `SELECT s.id, s.name, COUNT(m.id) AS c FROM subjects s
   LEFT JOIN study_materials m ON m.subject_id = s.id
   GROUP BY s.id ORDER BY c ASC, s.id ASC LIMIT 1`
);
if (!target) {
  console.error("Nenhuma matéria encontrada.");
  process.exit(1);
}

const slug = slugify(target.name);
const topicos = TOPICOS[target.name] || [
  `${target.name} conceitos fundamentais`,
  `${target.name} principais temas`,
  `${target.name} questões frequentes`,
];

console.log(`Matéria da semana: ${target.name} (${target.c} material(is))`);
const { pdfPath, manifest } = await gerarResumo(target.name, slug, topicos, path.join(__dirname, "out"));

// nome único para não sobrescrever resumos anteriores da mesma matéria
const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
const finalName = `resumo-${slug}-${stamp}.pdf`;
const destDir = path.join(PROJECT, "uploads", "materials");
fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(pdfPath, path.join(destDir, finalName));

const r = run(
  "INSERT INTO study_materials (subject_id, filename, file_path, file_type, extracted_text) VALUES (?, ?, ?, 'pdf', ?)",
  target.id, finalName, "/uploads/materials/" + finalName, manifest.text
);
console.log(`OK: resumo semanal cadastrado (id ${r.lastInsertRowid}) para ${target.name}`);
