# Correção de Provas — Odontologia 🦷

Sistema web com backend, frontend e banco de dados para corrigir provas de odontologia.
Recebe respostas em **texto digitado** ou **foto** (com OCR no navegador) e corrige automaticamente:

- **Questões objetivas**: correção por gabarito (A–E).
- **Questões discursivas**: correção por cobertura de palavras-chave, com feedback do que faltou + resposta modelo.

## Como rodar

Pré-requisito: [Node.js 22+](https://nodejs.org) instalado.

```bash
cd correcao-provas-odonto
npm install
npm run seed   # cria a prova de exemplo (simulado de miose) — só na 1ª vez
npm start
```

Abra no navegador: **http://localhost:3000**

- **Provas**: criar provas e adicionar questões objetivas/discursivas.
- **Responder**: escolhe a prova, responde (texto ou foto com botão "Ler imagem (OCR)") e recebe a nota na hora.
- **Resultados**: histórico de correções com feedback por questão.

## Estrutura

| Arquivo/pasta | Papel |
|---|---|
| `server.js` | Backend (Express): API REST + serve o frontend |
| `db.js` | Banco SQLite (`data/provas.db`, criado sozinho) |
| `grade.js` | Lógica de correção (gabarito + palavras-chave) |
| `seed.js` | Prova de exemplo: simulado de miose (6 objetivas + 1 discursiva) |
| `public/` | Frontend (HTML/CSS/JS puro) |
| `uploads/` | Imagens enviadas nas respostas |

## API (resumo)

- `GET/POST /api/exams` · `GET /api/exams/:id` · `DELETE /api/exams/:id`
- `POST /api/exams/:id/questions` · `DELETE /api/questions/:id`
- `POST /api/submissions` (multipart: `exam_id`, `student_name`, `answers` JSON, `image_<idQuestao>`)
- `GET /api/submissions` · `GET /api/submissions/:id` · `DELETE /api/submissions/:id`

## Notas

- O OCR roda no navegador via tesseract.js (CDN) — precisa de internet na primeira vez; sem ela, digite a resposta.
- A correção discursiva é heurística (palavras-chave). Para feedback mais sofisticado, dá pra plugar uma IA via API depois.

## 🔍 Correção inteligente

Aba "🔍 Correção inteligente" — **modo automático**: selecione uma ou mais fotos das questões
(ou cole o texto). **Assim que as imagens carregam, o processo dispara sozinho**, sem botão:

1. Lê todas as fotos com **OCR** no navegador (seletor foto/raio-X: raio-X é anexado como
   referência visual às questões, sem OCR — nesse caso cole o texto das questões);
2. **Divide** o texto em questões automaticamente (detecta objetivas e alternativas A–E;
   funciona mesmo quando o OCR devolve tudo numa linha só);
3. **Pesquisa** cada questão na internet **em lotes de 5** (com progresso por lote) e sugere
   a melhor resposta com fontes — **nenhuma questão fica de fora**, e o progresso parcial
   é salvo no histórico mesmo se um lote falhar;
4. Exibe o **resultado** agrupado em **QUESTÕES OBJETIVAS:** e **QUESTÕES SUBJETIVAS:**,
   cada questão com a **foto de origem** anexada.

Há também o **modo manual**: monte as questões uma a uma, use **"📷 Extrair texto de todas
as fotos"** para preencher todos os enunciados de uma vez (detecta tipo e alternativas
automaticamente), e **"Pesquisar na internet e corrigir"** analisa **todas** — se algum
cartão estiver sem texto, o sistema avisa quais em vez de pular em silêncio.

O formato das respostas segue o **[Padrão de Resolução de Questões](PADRAO-DE-RESOLUCAO.md)**:
objetivas com alternativa + confiança (alta/média/baixa) + fonte + justificativa ("Por quê"),
discursivas com versão curta (para decorar) + versão completa, e linha final
`Gabarito para assinalar: 1-A, 2-C, 3-discursiva, 4-?`.

## 📚 Matérias (apoio ao estudo)

Aba "📚 Matérias": biblioteca com as **28 disciplinas do curso de Odontologia** já cadastradas.
Cada matéria guarda:

- **Questões**: enunciado, tipo (objetiva/discursiva), alternativas, resposta/gabarito, explicação e
  fonte. Na tela da matéria, a resposta fica oculta atrás de "Ver resposta" (estilo flashcard).
- **Materiais de apoio**: anexe **PDF** ou **imagem** — o sistema extrai o texto (PDF via pdf.js,
  imagem via OCR) e salva o arquivo + texto como material de apoio da matéria.

Há também **busca global** (🔎) em questões e materiais de todas as matérias. Na aba
"Responder prova" existe um atalho ("📚 Abrir matérias de apoio") para revisar antes de responder.

## 💡 Resposta sintetizada (aba Responder)

No topo da aba "Responder prova" há um campo de dúvida: digite uma pergunta e receba um
resumo direto pesquisado na internet (sem salvar no histórico). Dá para ver a resposta
completa com fontes e salvar como questão em qualquer matéria com um clique.

## 🎓 Seminário

Aba própria para montar seminários: digite o tema e o sistema pesquisa, monta os slides
(título, introdução, aspectos principais, prática clínica, pontos de atenção, conclusão e
referências) com imagens livres do Wikimedia Commons, dados e explicações. Você visualiza,
edita títulos e tópicos, adiciona/remove slides e, depois de aprovar, exporta em **PDF**
ou **PowerPoint** (arquivos em `uploads/`).

Detalhes técnicos: `seminar.js` — `commonsImages()` testa várias formulações (tema,
tema em inglês via glossário PT→EN odontológico, palavras-chave isoladas), descarta
documentos escaneados e pontua candidatos pelo título (bônus quando o tema aparece junto
de contexto odontológico); `fetchImage()` baixa a imagem para embutir no PDF/PPTX.
`research.js` — `searchWeb()` usa Brave API (se `BRAVE_API_KEY`) com fallback para
scraping DuckDuckGo e Bing; `bingSearch()` decodifica os redirects `/ck/a` do Bing
(URL real em base64 no parâmetro `u`) — sem isso, todos os resultados caíam no filtro
e a busca voltava vazia (bug corrigido em 2026-10-22).

## 📚 Gerador de resumos para as matérias

`scripts/gerar-resumo.js "<Matéria>" "<slug>" "<tópico 1>" ...` pesquisa os tópicos na
internet e gera um PDF de resumo (`scripts/out/resumo-<slug>.pdf` + manifesto JSON).
`scripts/registrar-material.js <manifesto.json>` cadastra o PDF como material de apoio da
matéria (o PDF precisa estar em `uploads/materials/`). Rode no PC, que tem a Brave API.

**Rotina semanal automática:** `scripts/resumo-semanal.js` (via `resumo-semanal.bat`) escolhe
a matéria com menos materiais, pesquisa 3 tópicos e cadastra o PDF sozinho. No PC roda
todo domingo às 08:00 pela tarefa agendada "Resumo Semanal Odonto". Log em `logs/`.

## 🩻 Análise de Raio-X

Aba para analisar radiografias odontológicas: envie a imagem (arquivo ou foto da
tela/chapa, no celular abre a câmera), ajuste zoom/contraste/brilho/inversão e siga o
roteiro de leitura (tipo de exame, qualidade técnica, avaliação por região, achados,
impressão descritiva). Gera um relatório de estudo (com cópia e salvamento no sistema).
A página inclui sistemas profissionais reais: IA odontológica com aprovação regulatória
(Pearl Second Opinion, Overjet, VideaHealth, Denti.AI) e visualizadores DICOM (Weasis,
3D Slicer, Horos, RadiAnt, MicroDicom). Arquivos .dcm abrem nesses visualizadores.

**Análise técnica automática:** ao enviar a imagem, o sistema analisa os pixels na hora
(`POST /api/xray/analyze` → `scripts/analisar-rx.py`, Python + Pillow/numpy) e mostra:
exposição (subexposta/superexposta/adequada), contraste, nitidez (índice de variância do
Laplaciano), histograma de tons e dimensões — e marca sozinho os itens de qualidade
técnica do roteiro. Avalia a qualidade técnica da imagem; não interpreta achados
clínicos (isso continua no roteiro de leitura).

**⚖️ Cruzamento de softwares:** seletor de tipo de exame (Panorâmica, Periapical,
Interproximal, Oclusal, Telerradiografia) que mostra, para cada um dos 9 softwares
listados, se aceita aquele exame, o que faz com a imagem, a aprovação regulatória e o
custo/plataforma — com links para os sites oficiais. Dados verificados em 2026-10-22.

## Aba Resultados (Correções realizadas)

A aba "Resultados" carrega, além das correções de provas respondidas, também as
**pesquisas inteligentes** da 🔍 Correção inteligente — cada uma pode ser reaberta e excluída por lá.

Detalhes do comportamento:
- **Trechos de instrução/cabeçalho da prova são ignorados**: regras como "aparelhos eletrônicos desligados",
  "saída ao banheiro não permitida", "folha de rascunho devolvida ao professor", e dados do cabeçalho
  (curso, disciplina, professor, matrícula, aluno, assinatura, nota) são detectados e descartados
  automaticamente — nunca viram "questão" nem são pesquisados/corrigidos.
- **Objetivas** respondem com exatidão e confiança: "✅ Resposta: **B** — Pilocarpina" + % de confiança.
- **Subjetivas** recebem resposta **humanizada**, redigida em linguagem natural como explicação de
  aluno para professor, costurada a partir das fontes pesquisadas.

Há também o **modo manual** para montar questão por questão (texto, tipo, alternativas, imagem).

## 🔒 Proteção por senha

**Ativa** (reativada em 2026-10-22 a pedido do usuário, junto com o Funnel público).
O sistema exige autenticação HTTP Basic em todas as rotas usando as credenciais já
configuradas no PC via `setx` (`APP_USER`/`APP_PASSWORD`). Sem essas variáveis definidas,
o sistema abre sem senha. O erro 401 sempre retorna JSON claro no lugar de texto puro.

Acesso público via Tailscale Funnel (ativo):

```cmd
tailscale funnel --bg http://localhost:3000
```

Endereço público: `https://notbdellfbbr.tailb17081.ts.net` (HTTPS automático).

## 🤖 Automação

- **Watchdog no PC** (`watchdog.bat`, tarefa agendada `CorrecaoProvas Watchdog` a cada 5 min):
  reinicia o servidor se `http://localhost:3000` não responder. Log em `watchdog.log`.
- **Resumo semanal** (tarefa `Resumo Semanal Odonto`, domingo 08:00): gera e cadastra um
  resumo em PDF para a matéria com menos materiais. Log em `logs/resumo-semanal.log`.

1. A foto passa por **OCR** no navegador (botão "Ler imagem"); o raio-X é anexado como referência visual.
2. Você revisa/divide as questões (objetivas têm as alternativas detectadas).
3. O servidor **pesquisa cada questão na internet**, cruza as fontes e sugere a melhor resposta — com nível de confiança e links das fontes.

- **Objetivas**: o sistema pontua cada alternativa contra as fontes e sugere a letra mais sustentada.
- **Discursivas**: monta uma resposta-resumo a partir dos trechos mais relevantes.

### Chave da API Brave (opcional, recomendado)

A pesquisa usa scraping do DuckDuckGo/Bing por padrão, que pode sofrer rate-limit. Para um caminho confiável, cadastre-se em https://brave.com/search/api/ (cerca de 1.000 buscas/mês grátis; pede cartão só como verificação de identidade), gere a chave e inicie o servidor assim:

```bash
# Linux/Mac
BRAVE_API_KEY=sua_chave npm start
# Windows (cmd)
set BRAVE_API_KEY=sua_chave && npm start
```

## Modo duplo: PC (principal) + VM (reserva)

- **Principal — PC**: instalado em `C:\odontologiamuse\correcao-provas`, roda em http://localhost:3000, inicia sozinho 30s após o login (tarefa agendada "Correcao de Provas Odonto"). Para iniciar manualmente: duplo-clique em `iniciar-provas.bat`.
- **Reserva — esta VM**: se o PC falhar, o sistema sobe aqui com `./iniciar-fallback.sh` (ou `npm start`) e fica acessível pela tailnet em **http://muse:3000** (ou http://100.107.54.82:3000). O dispositivo precisa estar na tailnet (Tailscale ativo).
- **Como aciona a reserva**: avise no chat ("o PC caiu", "ativa a reserva") — aí é verificado e ligado na hora. Não há monitoramento automático em segundo plano: por limitação da plataforma, testes de rede para o PC só funcionam durante a conversa, então a checagem acontece quando você chama.
- **Atenção**: cada instância tem seu próprio banco (`data/provas.db`). Correções feitas na reserva ficam na reserva — dá pra unificar depois, se precisar.
