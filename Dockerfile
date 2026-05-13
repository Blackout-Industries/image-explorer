FROM node:22-alpine AS base
WORKDIR /app

# ── Development stage ──
FROM base AS dev
COPY package*.json ./
RUN rm -f package-lock.json && npm install --no-audit --no-fund
COPY . .
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]

# ── Build stage ──
FROM base AS build
COPY package*.json ./
# Drop lockfile to bypass npm/cli#4828 (missing platform-specific rollup binary).
RUN rm -f package-lock.json && npm install --no-audit --no-fund
COPY . .
RUN npx tsc --noEmit && npx vite build

# ── Production stage ──
FROM nginx:1.31-alpine AS prod
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
