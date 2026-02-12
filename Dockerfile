FROM node:20-alpine

# Install build dependencies for better-sqlite3
RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --production

COPY src/ ./src/

RUN mkdir -p data

EXPOSE 3333

CMD ["node", "src/index.js"]
