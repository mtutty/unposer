# Development — ts-node + nodemon over bind-mounted source (see
# docker-compose.override.yml, `target: development`). Full devDependencies
# installed so the knex CLI can register ts-node and run *.ts migrations
# directly.
FROM node:24-alpine AS development

RUN apk add --no-cache netcat-openbsd

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

RUN mkdir -p /app/uploads

EXPOSE 3000

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["npm", "run", "dev"]

# Build — compiles src/ (including the migrations under src/db/migrations)
# to dist/. Not used directly; only its dist/ output is copied into the
# production stage below.
FROM node:24-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Production — runtime dependencies and compiled dist/ only. No
# ts-node/nodemon/typescript/jest — those are devDependencies, omitted
# here. Migrations run from the compiled dist/db/migrate.js (see
# docker-entrypoint.sh), so no knexfile or TS loader is needed at runtime.
FROM node:24-alpine AS production

RUN apk add --no-cache netcat-openbsd

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist

COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

RUN mkdir -p /app/uploads

EXPOSE 3000

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["npm", "start"]
