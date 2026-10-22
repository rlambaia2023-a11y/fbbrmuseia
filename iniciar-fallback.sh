#!/bin/bash
# Reserva quente: sobe o sistema nesta VM quando o PC estiver inacessível.
# O servidor escuta em todas as interfaces; acesso via tailnet: http://muse:3000
cd "$(dirname "$0")"
PORT=3000 npm start
