# `just --list --unsorted`
[group('default')]
default:
    @just --list --unsorted

ci := env("CI", "")

# Install dependencies
[group('setup')]
install:
    vp install
    vp fmt CLAUDE.md

# Run linter
lint: install
    vp lint {{ if ci != "" { "--format github" } else { "--fix" } }}

# Run formatter
format: install
    vp fmt {{ if ci != "" { "--check" } else { "" } }}

# Run checks (format + lint + typecheck)
check: install
    vp check {{ if ci != "" { "" } else { "--fix" } }}

# Run tests
test *args: install
    vp run test:run {{args}}

# Type-check the project
typecheck: install
    vp run typecheck

# Build the project
build: install
    vp run build

# Run the audit CLI against a directory
audit *args: install
    vp run audit {{args}}

# Run all pre-commit checks
[arg("quick", long, value="true", help="Skip tests")]
precommit quick="": check build
    {{ if quick != "true" { "just test" } else { "true" } }}
    @echo "All pre-commit checks passed!"
