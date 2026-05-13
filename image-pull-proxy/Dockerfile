FROM node:22-alpine

WORKDIR /app

# Install deps inside the container so node_modules never has to be on the host.
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY server.js ./

ENV PORT=5099
EXPOSE 5099

# Drop privileges for the runtime.
USER node

CMD ["node", "server.js"]
