FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
ENV DATA_DIR=/app/data
VOLUME /app/data
CMD ["node", "src/index.js"]
