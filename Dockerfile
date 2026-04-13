FROM node:20-slim

# Install build dependencies for better-sqlite3, onnxruntime-node + git
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --production

COPY src/ ./src/

RUN mkdir -p data data/creations /tmp/sandbox && chmod 777 /tmp/sandbox

# Main dashboard port + service ports for entity's creations
EXPOSE 3333 4001-4020

CMD ["node", "src/index.js"]
