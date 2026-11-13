ARG BUILD_FROM=ghcr.io/home-assistant/aarch64-base:latest
FROM $BUILD_FROM

# Node.js ve npm kurulumu
RUN apk add --no-cache nodejs npm

WORKDIR /app

# Bağımlılıkları kur
RUN npm init -y && npm install ws

# Uygulama ve başlatma betiğini kopyala
COPY agent.js /app/agent.js
COPY config.yaml /app/config.yaml
COPY run.sh /app/run.sh
RUN chmod a+x /app/run.sh

CMD [ "/app/run.sh" ]
