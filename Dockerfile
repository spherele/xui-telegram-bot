FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci
COPY src ./src
COPY test ./test
RUN npm test

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/app/data
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist/src ./dist/src
VOLUME /app/data
CMD ["node", "dist/src/index.js"]
