FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY index.html tsconfig.json vite.config.ts ./
COPY src ./src
COPY public ./public
RUN npm run build

FROM python:3.12-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
RUN useradd --uid 10001 --create-home muying && mkdir /data && chown muying /data
WORKDIR /app
COPY --from=build --chown=10001:10001 /app/dist ./dist
COPY --chown=10001:10001 server ./server
ENV HOST=0.0.0.0 PORT=8000 MUYING_DATA_DIR=/data PYTHONUNBUFFERED=1
USER muying
EXPOSE 8000
CMD ["python3", "server/app.py"]
