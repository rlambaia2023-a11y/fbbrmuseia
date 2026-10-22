FROM node:22-slim

# Python para a análise técnica de raio-X (scripts/analisar-rx.py)
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip \
  && rm -rf /var/lib/apt/lists/* \
  && pip3 install --break-system-packages pillow numpy

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

# Railway injeta a variável PORT; o servidor já a respeita
EXPOSE 3000

CMD ["node", "server.js"]
