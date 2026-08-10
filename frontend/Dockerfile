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

# Copy nginx configuration will be done via volume mount or COPY in docker-compose
# This allows the container to be used with different nginx configs

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
