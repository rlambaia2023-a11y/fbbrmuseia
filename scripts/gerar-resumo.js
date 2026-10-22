// Gera um PDF de resumo para uma matéria a partir de pesquisa na internet.
// Uso: node scripts/gerar-resumo.js "<Matéria>" "<slug>" "<tópico 1>" "<tópico 2>" ...
// Saída: scripts/out/resumo-<slug>.pdf + resumo-<slug>.json (manifesto p/ cadastro)
// Também exporta gerarResumo() para uso pelo resumo-semanal.js.
import { searchWeb, pageEvidence, humanizeAnswer, keywords, sleep } from "../research.js";
import PDFDocument from "pdfkit";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function gerarResumo(materia, slug, topicos, outDir) {
  const OUT = outDir || path.join(__dirname, "out");
  fs.mkdirSync(OUT, { recursive: true });

  const sections = [];
  for (const topico of topicos) {
    console.log("Pesquisando:", topico);
    let text = "";
    let refs = [];
    try {
      const results = await searchWeb(`${topico} odontologia`, 5);
      const qTokens = [...new Set(keywords(topico))].slice(0, 24);
      const passages = [];
      for (const r of results.slice(0, 2)) {
        const ev = await pageEvidence(r.url, qTokens);
        if (ev) passages.push(ev);
        await sleep(500);
      }
      const snippets = results.map((r) => `${r.title}. ${r.snippet}`);
      text = humanizeAnswer(topico, passages, snippets);
      refs = results.slice(0, 4).map((r) => ({ title: r.title || r.url, url: r.url }));
    } catch (e) {
      console.log("  falhou:", e.message);
    }
    sections.push({ topico, text: text || "Conteúdo em elaboração a partir das fontes.", refs });
    await sleep(800);
  }

  const filename = `resumo-${slug}.pdf`;
  const dest = path.join(OUT, filename);
  const doc = new PDFDocument({ size: "A4", margin: 60 });
  const stream = fs.createWriteStream(dest);
  doc.pipe(stream);
  doc.fontSize(24).text(`Resumo — ${materia}`, { align: "center" });
  doc.moveDown();
  doc.fontSize(11).fillColor("#666666")
    .text(`Material de apoio gerado por pesquisa em ${new Date().toLocaleDateString("pt-BR")}. Sem garantia de 100%: confira as fontes.`, { align: "center" })
    .fillColor("#000000");
  for (const s of sections) {
    doc.addPage();
    doc.fontSize(18).fillColor("#1a365d").text(s.topico).fillColor("#000000").moveDown(0.5);
    doc.fontSize(12).text(s.text, { align: "justify", paragraphGap: 8 });
    if (s.refs.length) {
      doc.moveDown(0.5).fontSize(10).fillColor("#333333").text("Fontes:");
      for (const r of s.refs) {
        doc.fillColor("#1a56db").text(`- ${r.title}`, { link: r.url, indent: 12 });
        doc.fillColor("#000000");
      }
    }
  }
  doc.end();
  await new Promise((res, rej) => { stream.on("finish", res); stream.on("error", rej); });

  const md = `# Resumo — ${materia}\n\n` +
    sections.map((s) => `## ${s.topico}\n\n${s.text}\n\n**Fontes:**\n` + s.refs.map((r) => `- ${r.title} — ${r.url}`).join("\n")).join("\n\n");
  const manifest = { materia, slug, filename, text: md.slice(0, 180000) };
  const manifestPath = path.join(OUT, `resumo-${slug}.json`);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  console.log("OK:", dest);
  return { pdfPath: dest, manifestPath, manifest };
}

// CLI: só executa quando chamado diretamente
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [materia, slug, ...topicos] = process.argv.slice(2);
  if (!materia || !slug || !topicos.length) {
    console.error('Uso: node scripts/gerar-resumo.js "<Matéria>" "<slug>" "<tópico 1>" ...');
    process.exit(1);
  }
  await gerarResumo(materia, slug, topicos);
}
