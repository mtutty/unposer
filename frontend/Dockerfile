# Development stage
FROM node:24-alpine AS development

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 4200

CMD ["npm", "start", "--", "--host", "0.0.0.0", "--poll", "2000"]

# Build stage
FROM node:24-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Production stage
FROM nginx:alpine AS production

# Copy built Angular app
COPY --from=build /app/dist/career-profile-frontend/browser /usr/share/nginx/html

# Baked into the image rather than bind-mounted from docker-compose — this config never varies
# by environment (unlike nginx/nginx.dev.conf, which only ever runs via the dev-mode standalone
# `nginx` service in docker-compose.override.yml), so there's nothing to gain from making it
# swappable at container-start time, and baking it in makes the built image actually
# self-contained instead of depending on the deploy host's checkout having a matching file.
COPY nginx.conf /etc/nginx/nginx.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
