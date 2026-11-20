# Aral Neon — container image
FROM node:20-slim

# tar for sing-box extraction; curl/openssl useful for debugging
RUN apt-get update && apt-get install -y --no-install-recommends tar openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Zero npm dependencies — no package install step needed
COPY package.json ./
COPY server.js ./
COPY lib ./lib
COPY web ./web

# Data directory (state, binaries, certs, logs) — mount a volume here
ENV NEON_DATA_DIR=/app/neon-data
RUN mkdir -p /app/neon-data

EXPOSE 8080 2053 2083 2087 2096 8443

CMD ["node", "server.js"]
