# Runbook — ativar a instância RESERVA (esta VM)

Quando o usuário pedir com frases como "ativa a reserva", "o PC caiu", "assume aí",
"liga a reserva":

1. **Verificar o PC**: tentar SSH/túnel para 100.104.12.93. Se inacessível, segue.
2. **Subir o servidor aqui** (background):
   `cd ~/workspace/correcao-provas-odonto && APP_USER=<u> APP_PASSWORD=<p> PORT=3000 node server.js`
   - `<u>`/`<p>` = credenciais que o usuário definiu (ver histórico do chat; NUNCA gravar neste arquivo nem em memória).
3. **Confirmar**: `curl -u "<u>:<p>" http://localhost:3000/api/exams` → espera 200.
4. **Informar o usuário**: acesso em http://muse:3000 (ou http://100.107.54.82:3000).
   Exige Tailscale ativo no dispositivo dele (no celular: app Tailscale logado na mesma conta).
5. **Avisar**: banco de dados separado — correções feitas na reserva ficam na reserva; oferecer unificação depois.

Quando o PC voltar: derrubar o servidor da VM (`pkill -f "node server.js"` no diretório
do projeto) para não dividir os dados entre as duas instâncias.

Nota: existe um monitor automático (`correcao-provas-monitor`, a cada 10 min) que observa
a URL pública do PC. Ele já terá alertado uma vez quando o PC caiu; quando o PC voltar,
ele reporta a recuperação — bom momento para desligar a reserva.
