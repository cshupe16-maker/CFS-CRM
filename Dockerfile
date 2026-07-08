# CFS Flooring CRM — no dependencies, so the image is just Node + the app.
FROM node:20-slim
WORKDIR /app
COPY package.json server.js seed.js ./
COPY public ./public
ENV NODE_ENV=production
# Cloud Run injects PORT (defaults to 8080); server.js reads it.
EXPOSE 8080
CMD ["node", "server.js"]
