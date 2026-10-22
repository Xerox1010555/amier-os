.PHONY: bootstrap dev build test core core-test lint clean

bootstrap:
	npm run bootstrap
	python -m pip install -r services/ai-orchestrator/requirements.txt

core:
	cargo build --release --manifest-path core/Cargo.toml

core-test:
	cargo test --manifest-path core/Cargo.toml

build:
	npm run build

test:
	npm run test:all
	python -m pytest services/ai-orchestrator/tests -q

lint:
	npm run typecheck
	python -m ruff check services/ai-orchestrator

clean:
	rm -rf apps/desktop/dist apps/desktop/dist-electron core/target
