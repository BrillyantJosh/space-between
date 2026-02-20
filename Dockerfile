FROM node:20-alpine

# Install build dependencies for better-sqlite3 + git for potential integrations
RUN apk add --no-cache python3 make g++ git

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --production

COPY src/ ./src/

RUN mkdir -p data data/creations /tmp/sandbox && chmod 777 /tmp/sandbox

# Main dashboard port + service ports for entity's creations
EXPOSE 3333 4001-4020

CMD ["node", "src/index.js"]
