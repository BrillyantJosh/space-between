FROM node:20-slim

# Install build dependencies for better-sqlite3, onnxruntime-node + git
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --production

COPY src/ ./src/
COPY public/ ./public/

RUN mkdir -p data data/creations /tmp/sandbox && chmod 777 /tmp/sandbox

# Stamp the image with its source version so a running being can announce
# which code it's built from. Set via `docker build --build-arg BEING_VERSION=<sha>-<date>`
# by deploy.sh; falls back to 'dev' for local builds.
ARG BEING_VERSION=dev
ENV BEING_VERSION=${BEING_VERSION}

# Main dashboard port + service ports for entity's creations
EXPOSE 3333 4001-4020

CMD ["node", "src/index.js"]
