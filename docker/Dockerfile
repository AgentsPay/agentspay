FROM node:20-alpine

RUN npm install -g pnpm

WORKDIR /app

COPY . .

RUN pnpm install --frozen-lockfile
RUN pnpm build

EXPOSE 3100

CMD ["node", "apps/api/dist/server.js"]
