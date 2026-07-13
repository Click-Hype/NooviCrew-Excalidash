.PHONY: release release-check pre-release release-docker pre-release-docker dev-release

GITLEAKS ?= gitleaks

release-check: ## Validate a clean, public-safe release commit
	@set -eu; \
	version="$$(cat VERSION)"; \
	tag="v$$version"; \
	test "$$(git branch --show-current)" = "main" || { echo "Release requires main" >&2; exit 1; }; \
	test -z "$$(git status --porcelain)" || { echo "Release requires a clean worktree" >&2; exit 1; }; \
	git fetch --quiet origin main; \
	test "$$(git rev-parse HEAD)" = "$$(git rev-parse origin/main)" || { echo "HEAD must equal origin/main" >&2; exit 1; }; \
	! git rev-parse -q --verify "refs/tags/$$tag" >/dev/null || { echo "Tag $$tag already exists" >&2; exit 1; }; \
	command -v "$(GITLEAKS)" >/dev/null 2>&1 || { echo "Install gitleaks v8.30.1 or set GITLEAKS=/path/to/gitleaks" >&2; exit 1; }; \
	node scripts/check-public-tree.mjs; \
	"$(GITLEAKS)" git --no-banner --redact=100 .; \
	$(MAKE) test-all; \
	echo "Release checks passed for $$tag"

release: release-check ## Create and push a verified stable tag; GitHub Actions publishes artifacts
	@set -eu; \
	version="$$(cat VERSION)"; \
	tag="v$$version"; \
	test "$(CONFIRM_RELEASE)" = "$$tag" || { \
		echo "Refusing to publish without CONFIRM_RELEASE=$$tag" >&2; \
		exit 1; \
	}; \
	git tag -a "$$tag" -m "ExcaliDash $$tag"; \
	git push origin "$$tag"; \
	echo "Pushed $$tag. The release workflow will publish containers and the GitHub Release."

pre-release: ## Create and push an explicit pre-release tag
	@set -eu; \
	base="$$(cat VERSION)"; \
	test -n "$(NAME)" || { echo "Usage: make pre-release NAME=rc.1 CONFIRM_RELEASE=v$$base-rc.1" >&2; exit 1; }; \
	tag="v$$base-$(NAME)"; \
	test "$(CONFIRM_RELEASE)" = "$$tag" || { echo "Set CONFIRM_RELEASE=$$tag" >&2; exit 1; }; \
	test -z "$$(git status --porcelain)" || { echo "Pre-release requires a clean worktree" >&2; exit 1; }; \
	node scripts/check-public-tree.mjs; \
	git tag -a "$$tag" -m "ExcaliDash $$tag"; \
	git push origin "$$tag"

release-docker: ## Build and push stable GHCR images manually
	./scripts/publish-docker.sh

pre-release-docker: ## Build and push rolling pre-release GHCR images manually
	./scripts/publish-docker-prerelease.sh

dev-release: ## Build and push a custom development image (NAME is required)
	@test -n "$(NAME)" || { echo "Usage: make dev-release NAME=issue38" >&2; exit 1; }
	./scripts/publish-docker-dev.sh "$(NAME)"
