# Stage 1: Build the frontend
FROM node:20-alpine AS builder

WORKDIR /build

COPY frontend/package.json frontend/package-lock.json* ./

RUN npm ci

COPY frontend/ ./

# Build with same-origin PocketBase URL so the SPA hits the same host
ENV VITE_PB_URL=""

RUN npm run build


# Stage 2: Runtime image
FROM debian:bookworm-slim AS runtime

# Install curl for healthcheck; clean up afterwards
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

# Run as a non-root user
RUN groupadd --gid 1001 pbuser \
    && useradd --uid 1001 --gid pbuser --shell /bin/sh --create-home pbuser

WORKDIR /app

# Copy the PocketBase binary
COPY --chown=pbuser:pbuser pb/pocketbase ./pocketbase

# Copy the built frontend into pb_public (served by PocketBase)
COPY --from=builder --chown=pbuser:pbuser /build/dist ./pb_public

# pb_data is where PocketBase stores the SQLite DB and logs — persist it via a volume
VOLUME ["/app/pb_data"]

EXPOSE 8090

USER pbuser

CMD ["./pocketbase", "serve", "--http=0.0.0.0:8090", "--dir=/app/pb_data", "--publicDir=/app/pb_public"]
