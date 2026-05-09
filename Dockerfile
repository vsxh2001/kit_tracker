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

ARG PB_VERSION=0.22.22

# Install curl + unzip to download PocketBase; clean up afterwards
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl unzip \
    && curl -sSL "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_amd64.zip" -o /tmp/pb.zip \
    && unzip -q /tmp/pb.zip -d /tmp/pb \
    && mv /tmp/pb/pocketbase /usr/local/bin/pocketbase \
    && chmod +x /usr/local/bin/pocketbase \
    && rm -rf /tmp/pb /tmp/pb.zip /var/lib/apt/lists/*

# Run as a non-root user
RUN groupadd --gid 1001 pbuser \
    && useradd --uid 1001 --gid pbuser --shell /bin/sh --create-home pbuser

WORKDIR /app

# Symlink pocketbase into workdir for entrypoint compatibility
RUN ln -s /usr/local/bin/pocketbase /app/pocketbase
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

# Copy the built frontend into pb_public (served by PocketBase)
COPY --from=builder --chown=pbuser:pbuser /build/dist ./pb_public

# Copy pb directory (migrations + hooks); pb_data is intentionally excluded
# via .dockerignore / volume mount — only schema files travel in the image.
COPY --chown=pbuser:pbuser pb/pb_migrations/ ./pb/pb_migrations/
COPY --chown=pbuser:pbuser pb/pb_hooks/ ./pb/pb_hooks/
COPY --chown=pbuser:pbuser pb/setup_collections.sh pb/seed_test_users.sh pb/setup_oauth.sh ./pb/

# Create pb_data as pbuser so the named volume inherits the correct ownership
RUN mkdir -p /app/pb_data && chown pbuser:pbuser /app/pb_data

# pb_data is where PocketBase stores the SQLite DB and logs — persist it via a volume
VOLUME ["/app/pb_data"]

EXPOSE 8090

USER pbuser

ENTRYPOINT ["./docker-entrypoint.sh"]
