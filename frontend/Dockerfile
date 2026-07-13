# Multi-architecture digest pins make rebuilds reproducible. Downstream release
# jobs can override these args explicitly when applying base-image updates.
ARG NODE_IMAGE=node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293
ARG NGINX_IMAGE=nginx:alpine@sha256:54f2a904c251d5a34adf545a72d32515a15e08418dae0266e23be2e18c66fefa

# Bundle the corresponding source served by this network application. Secrets,
# private workspace settings, databases, uploads, dependencies, and .git are
# excluded by the root .dockerignore; the public MCP source remains included.
FROM ${NODE_IMAGE} AS source-bundle
WORKDIR /source
COPY . .
RUN tar -czf /excalidash-source.tar.gz .

# Build stage
FROM ${NODE_IMAGE} AS builder

WORKDIR /app/frontend

# Copy package files first for better caching
COPY frontend/package*.json ./

# Install dependencies
RUN npm ci && npm cache clean --force

# Copy source code and config files
COPY frontend/ ./
COPY VERSION ../VERSION

# Build arguments
ARG VITE_APP_VERSION
ARG VITE_APP_BUILD_LABEL
ENV VITE_APP_VERSION=$VITE_APP_VERSION
ENV VITE_APP_BUILD_LABEL=$VITE_APP_BUILD_LABEL

# Build the application
RUN npm run build

# Production stage
FROM ${NGINX_IMAGE}

# Copy nginx config template (will be processed at runtime)
COPY frontend/nginx.conf.template /etc/nginx/nginx.conf.template

# Copy entrypoint script
COPY frontend/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Copy built application from builder
COPY --from=builder /app/frontend/dist /usr/share/nginx/html
COPY --from=source-bundle /excalidash-source.tar.gz /usr/share/nginx/html/source/excalidash-source.tar.gz

EXPOSE 80

# Use custom entrypoint to process nginx config template
ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
