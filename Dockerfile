from oven/bun:1.3.11

WORKDIR /app

COPY . .

ENTRYPOINT ["bun", "index.ts"]
