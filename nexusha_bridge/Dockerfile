FROM alpine:3.20

RUN apk add --no-cache nodejs npm

WORKDIR /app
RUN npm init -y && npm install ws

COPY agent.js /app/agent.js

CMD ["node", "/app/agent.js"]
