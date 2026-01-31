# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

WorkAny is a desktop AI agent application built with Tauri 2, combining a React frontend with a Node.js/Hono backend API. The app uses Claude Agent SDK for agent capabilities and supports multiple sandbox providers for isolated code execution.

**Architecture:**
- `src/` - React 19 frontend (TypeScript + Vite)
- `src-api/` - Backend API (Hono + Node.js)
- `src-tauri/` - Tauri desktop app (Rust)

## Development Commands

### Prerequisites
- Node.js >= 20
- pnpm >= 9
- Rust >= 1.70

### Common Commands

```bash
# Install all dependencies (root + src-api workspace)
pnpm install

# Development (recommended workflow)
pnpm dev:api          # Start API server on port 2026
pnpm dev:app          # Start Tauri desktop app (includes frontend on :1420)

# Alternative development modes
pnpm dev:web          # Frontend only (Vite dev server on :1420)
pnpm dev:all          # Run API and app concurrently

# Building
pnpm build            # Build frontend only
pnpm build:api        # Build backend TypeScript
pnpm build:api:binary # Package API as standalone binary

# Linting/Formatting
pnpm lint             # ESLint check
pnpm lint:fix         # ESLint auto-fix
pnpm format           # Prettier format

# Desktop app builds
pnpm tauri:build              # Build for current platform
pnpm build:app:mac-arm        # macOS ARM build
pnpm build:app:mac-intel      # macOS Intel build
pnpm build:app:linux          # Linux build
pnpm build:app:windows        # Windows build
```

### API-specific Commands (in src-api/)

```bash
pnpm dev              # Start API server with hot reload (tsx --watch)
pnpm build            # Compile TypeScript
pnpm bundle           # Bundle with esbuild
pnpm build:binary     # Package with pkg (platform-specific)
```

## Architecture Details

### Provider System

The codebase uses a **plugin-based provider system** for both agents and sandboxes:

**Agent Providers** (`src-api/src/core/agent/`):
- Implements `IAgent` interface with `run()`, `plan()`, `execute()` methods
- Built-in providers: Claude (via Agent SDK), Codex, DeepAgents
- Registry pattern in `src-api/src/core/agent/registry.ts`

**Sandbox Providers** (`src-api/src/core/sandbox/`):
- Implements `ISandboxProvider` interface with `exec()`, `runScript()` methods
- Built-in providers: Codex (process isolation), Claude (container), Native (direct)
- Registry pattern in `src-api/src/core/sandbox/registry.ts`

**Provider Manager** (`src-api/src/shared/provider/manager.ts`):
- Centralized manager for provider lifecycle and switching
- Categories: `agent`, `sandbox`
- Use `getProviderManager()` to access the singleton
- Providers can be switched at runtime via `switchProvider(category, type, config)`

### API Structure

The API (`src-api/src/`) is organized as:

```
src-api/src/
├── app/api/          # Hono route handlers
│   ├── agent.ts      # Agent execution endpoints
│   ├── sandbox.ts    # Sandbox execution endpoints
│   └── providers.ts  # Provider management endpoints
├── core/
│   ├── agent/        # Agent provider implementations
│   └── sandbox/      # Sandbox provider implementations
├── extensions/       # Concrete implementations (Claude, Codex, etc.)
├── shared/
│   ├── provider/     # Provider manager & registries
│   ├── services/     # High-level services (agent, preview)
│   └── skills/       # Skills system
└── config/           # Configuration loading
```

**Main entry point:** `src-api/src/index.ts` - Starts Hono server on port 2026 (dev) or 2620 (prod)

### Frontend-Backend Communication

- **Dev:** Frontend (`localhost:1420`) → API (`localhost:2026`)
- **Prod:** Frontend (bundled) → API sidecar binary (`localhost:2620`)
- Base URL configured in `src/config/index.ts` (`API_BASE_URL`)

### Frontend Architecture

**Key directories:**
- `src/app/` - Pages and routing (React Router 7)
- `src/components/` - UI components (Radix UI + Tailwind CSS 4)
- `src/shared/` - Shared utilities, hooks, database (SQLite via Tauri)

**Database:** SQLite via `@tauri-apps/plugin-sql` in `src/shared/db/`
- Tasks, messages, files stored locally
- Settings persistence

### Two-Phase Execution

The agent supports a **plan → execute** workflow:
1. **Plan phase:** Agent analyzes task and creates a `TaskPlan` with steps
2. **Execute phase:** Agent executes the approved plan step-by-step

Controlled via `phase` parameter in `/agent/run` endpoint (`'plan' | 'execute'`).

### Skills and MCP

- **Skills:** Custom agent capabilities loaded from `~/.claude/skills` or `workspace/skills`
- **MCP:** Model Context Protocol servers loaded from Claude config or app config
- Both configured via `SkillsConfig` and `McpConfig` types in `src-api/src/core/agent/types.ts`

### Configuration

Configuration is loaded from multiple sources in `src-api/src/config/loader.ts`:
- Environment variables (`ANTHROPIC_API_KEY`, `AGENT_PROVIDER`, `SANDBOX_PROVIDER`)
- User settings database (via Tauri)
- Provider-specific configs

Default providers:
- Agent: `claude` (via `AGENT_PROVIDER` env var)
- Sandbox: `codex` (via `SANDBOX_PROVIDER` env var)

## Tauri Integration

**External binaries** (bundled with desktop app):
- Defined in `src-tauri/tauri.conf.json` under `bundle.externalBin`
- Includes: `codex`, `claude`, `workany-api`
- Copied to `src-api/dist/` during build

**Rust backend** (`src-tauri/src/`):
- Minimal - mostly Tauri plugin glue code
- Plugins: `fs`, `shell`, `sql`, `dialog`, `opener`

## Important Conventions

1. **Provider implementations** must implement their respective interface (`IAgent` or `ISandboxProvider`)
2. **Use ProviderManager** to access providers - don't instantiate directly
3. **Async generators** are used for streaming responses from agents
4. **TypeScript paths** use `@/` alias for both frontend and backend
5. **pnpm workspaces** - root and `src-api` are separate packages

## Testing

No formal test suite is currently set up. Manual testing via:
```bash
pnpm dev:api    # Terminal 1
pnpm dev:app    # Terminal 2
```
