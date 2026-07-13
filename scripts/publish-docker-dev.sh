#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

REGISTRY_NAMESPACE="${REGISTRY_NAMESPACE:-ghcr.io/click-hype}"
IMAGE_NAME="noovicrew-excalidash"
BASE_VERSION=$(node -e "try { console.log(require('fs').readFileSync('VERSION', 'utf8').trim()) } catch { console.log('0.0.0') }")
CUSTOM_NAME=$1
VERSION="${BASE_VERSION}-dev-${CUSTOM_NAME}"

if [ -z "$CUSTOM_NAME" ]; then
  echo "ERROR: Custom name is required!"
  echo "Usage: $0 <custom-name>"
  exit 1
fi

echo "ExcaliDash Custom Dev Release"
echo "Tag:   $VERSION"

echo "Publishing to $REGISTRY_NAMESPACE (authenticate with docker login first)."

echo "Setting up buildx builder..."
if ! docker buildx inspect excalidash-builder > /dev/null 2>&1; then
  echo "Creating new buildx builder..."
  docker buildx create --name excalidash-builder --use --bootstrap
else
  echo "Using existing buildx builder."
  docker buildx use excalidash-builder
fi

echo "Building and pushing backend image..."
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  --tag "$REGISTRY_NAMESPACE/$IMAGE_NAME-backend:$VERSION" \
  --file backend/Dockerfile \
  --push \
  backend/

echo "Backend image pushed successfully."

echo "Building and pushing frontend image..."
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  --tag "$REGISTRY_NAMESPACE/$IMAGE_NAME-frontend:$VERSION" \
  --build-arg VITE_APP_VERSION="$VERSION" \
  --build-arg VITE_APP_BUILD_LABEL="development" \
  --file frontend/Dockerfile \
  --push \
  .

echo "Frontend image pushed successfully."
echo "Custom dev images published."
