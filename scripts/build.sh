#!/bin/bash

# WorkAny Build Script
# Usage: ./scripts/build.sh [platform] [--with-claude]
# Platforms: linux, windows, mac-intel, mac-arm, all
# Options:
#   --with-claude  Bundle Claude Code CLI as a sidecar (for users without Node.js environment)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Global variables
BUNDLE_CLAUDE_CODE=false
BUNDLE_CODEX=false
BUILD_PLATFORM="current"
SKIP_SIGNING=true  # Default: skip signing for faster builds

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if required tools are installed
check_requirements() {
    log_info "Checking requirements..."

    if ! command -v pnpm &> /dev/null; then
        log_error "pnpm is not installed. Please install it first."
        exit 1
    fi

    if ! command -v cargo &> /dev/null; then
        log_error "Rust/Cargo is not installed. Please install it first."
        exit 1
    fi

    if ! command -v rustup &> /dev/null; then
        log_error "rustup is not installed. Please install it first."
        exit 1
    fi

    log_info "All requirements satisfied."
}

# Install dependencies
install_deps() {
    log_info "Installing dependencies..."
    pnpm install
}

# Build API sidecar for a specific target (using Node.js + esbuild + pkg)
build_api_sidecar() {
    local target="$1"
    log_info "Building API sidecar for $target (Node.js)..."

    cd "$PROJECT_ROOT/src-api"

    # Install dependencies if needed
    if [ ! -d "node_modules" ]; then
        pnpm install
    fi

    case "$target" in
        x86_64-unknown-linux-gnu)
            pnpm run build:binary:linux
            ;;
        x86_64-pc-windows-msvc)
            pnpm run build:binary:windows
            ;;
        x86_64-apple-darwin)
            pnpm run build:binary:mac-intel
            ;;
        aarch64-apple-darwin)
            pnpm run build:binary:mac-arm
            ;;
        current)
            pnpm run build:binary
            ;;
        *)
            log_error "Unknown target for API sidecar: $target"
            exit 1
            ;;
    esac

    cd "$PROJECT_ROOT"
    log_info "API sidecar build completed for $target"
}

# Bundle Claude Code CLI as sidecar
# This bundles Node.js runtime and Claude Code package
bundle_claude_code() {
    local target="$1"

    if [ "$BUNDLE_CLAUDE_CODE" != "true" ]; then
        log_info "Skipping Claude Code bundling (use --with-claude to enable)"
        return 0
    fi

    log_info "Bundling Claude Code CLI with Node.js for $target..."

    local output_dir="$PROJECT_ROOT/src-api/dist"
    local bundle_dir="$output_dir/claude-bundle"

    # Clean up
    rm -rf "$bundle_dir"
    mkdir -p "$bundle_dir"

    # Determine platform-specific settings
    local node_platform=""
    local node_arch=""
    local node_ext=""

    case "$target" in
        x86_64-unknown-linux-gnu)
            node_platform="linux"
            node_arch="x64"
            ;;
        x86_64-pc-windows-msvc)
            node_platform="win"
            node_arch="x64"
            node_ext=".exe"
            ;;
        x86_64-apple-darwin)
            node_platform="darwin"
            node_arch="x64"
            ;;
        aarch64-apple-darwin)
            node_platform="darwin"
            node_arch="arm64"
            ;;
        current)
            local os_name=$(uname -s)
            local arch=$(uname -m)
            case "$os_name" in
                Darwin)
                    node_platform="darwin"
                    node_arch=$([ "$arch" = "arm64" ] && echo "arm64" || echo "x64")
                    ;;
                Linux)
                    node_platform="linux"
                    node_arch="x64"
                    ;;
                *)
                    node_platform="linux"
                    node_arch="x64"
                    ;;
            esac
            ;;
        *)
            node_platform="linux"
            node_arch="x64"
            ;;
    esac

    # Download Node.js binary
    local node_version="20.18.0"
    local node_filename="node-v${node_version}-${node_platform}-${node_arch}"
    local node_url="https://nodejs.org/dist/v${node_version}/${node_filename}.tar.gz"

    # For Windows, use .zip format
    if [ "$node_platform" = "win" ]; then
        node_url="https://nodejs.org/dist/v${node_version}/${node_filename}.zip"
    fi

    log_info "Downloading Node.js v${node_version} for ${node_platform}-${node_arch}..."

    local temp_dir=$(mktemp -d)
    cd "$temp_dir"

    # Try to download, fallback to local node if fails
    if [ "$node_platform" = "win" ]; then
        if ! curl -fsSL "$node_url" -o node.zip 2>/dev/null; then
            log_warn "Failed to download Node.js, trying local node..."
            if command -v node &> /dev/null; then
                cp "$(which node)" "$bundle_dir/node${node_ext}"
                chmod +x "$bundle_dir/node${node_ext}" 2>/dev/null || true
            else
                log_error "Node.js not available"
                cd "$PROJECT_ROOT"
                rm -rf "$temp_dir"
                return 1
            fi
        else
            unzip -q node.zip
            cp "${node_filename}/node.exe" "$bundle_dir/node.exe"
        fi
    else
        if ! curl -fsSL "$node_url" | tar xz 2>/dev/null; then
            log_warn "Failed to download Node.js, trying local node..."
            if command -v node &> /dev/null; then
                cp "$(which node)" "$bundle_dir/node${node_ext}"
                chmod +x "$bundle_dir/node${node_ext}" 2>/dev/null || true
            else
                log_error "Node.js not available"
                cd "$PROJECT_ROOT"
                rm -rf "$temp_dir"
                return 1
            fi
        else
            cp "${node_filename}/bin/node" "$bundle_dir/node"
            chmod +x "$bundle_dir/node"
        fi
    fi

    cd "$PROJECT_ROOT"
    rm -rf "$temp_dir"

    # Verify Node.js binary
    if [ ! -f "$bundle_dir/node${node_ext}" ]; then
        log_error "Node.js binary not found"
        return 1
    fi

    log_info "Node.js binary ready"

    # Install Claude Code using npm
    cd "$bundle_dir"
    echo '{"name":"claude-bundle","private":true,"type":"module"}' > package.json

    log_info "Installing @anthropic-ai/claude-code..."
    # Use npm mirror for faster download in China
    npm install @anthropic-ai/claude-code --registry="${NPM_REGISTRY:-https://registry.npmmirror.com}" 2>&1 | tail -10

    # Verify installation
    if [ ! -f "node_modules/@anthropic-ai/claude-code/cli.js" ]; then
        log_error "Claude Code installation failed"
        cd "$PROJECT_ROOT"
        return 1
    fi

    log_info "Claude Code installed successfully"

    # Copy .wasm files to bundle root (some may be needed at runtime)
    cp node_modules/@anthropic-ai/claude-code/*.wasm . 2>/dev/null || true

    # Create launcher script
    local output_name="claude"
    if [ "$node_platform" = "win" ]; then
        output_name="claude.cmd"
        # Windows batch launcher
        cat > "$output_dir/$output_name" << 'BATCH_EOF'
@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
set "BUNDLE_DIR=%SCRIPT_DIR%claude-bundle"
if not exist "%BUNDLE_DIR%\node.exe" set "BUNDLE_DIR=%SCRIPT_DIR%..\Resources\claude-bundle"
"%BUNDLE_DIR%\node.exe" "%BUNDLE_DIR%\node_modules\@anthropic-ai\claude-code\cli.js" %*
BATCH_EOF
    else
        # Unix shell launcher - searches multiple locations for bundle
        cat > "$output_dir/$output_name" << 'SHELL_EOF'
#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Search for claude-bundle in multiple locations
# 1. Same directory as launcher (development / Linux)
# 2. ../Resources/claude-bundle (macOS app bundle)
# 3. Resources subdirectory
for DIR in "$SCRIPT_DIR/claude-bundle" "$SCRIPT_DIR/../Resources/claude-bundle" "$SCRIPT_DIR/Resources/claude-bundle"; do
    if [ -f "$DIR/node" ] && [ -d "$DIR/node_modules/@anthropic-ai/claude-code" ]; then
        BUNDLE_DIR="$DIR"
        break
    fi
done

if [ -z "$BUNDLE_DIR" ]; then
    echo "Error: claude-bundle not found" >&2
    echo "Searched in:" >&2
    echo "  - $SCRIPT_DIR/claude-bundle" >&2
    echo "  - $SCRIPT_DIR/../Resources/claude-bundle" >&2
    exit 1
fi

exec "$BUNDLE_DIR/node" "$BUNDLE_DIR/node_modules/@anthropic-ai/claude-code/cli.js" "$@"
SHELL_EOF
        chmod +x "$output_dir/$output_name"
    fi

    cd "$PROJECT_ROOT"

    # Create target-specific launcher (Tauri adds target triple suffix to externalBin)
    local target_suffix=""
    case "$target" in
        x86_64-unknown-linux-gnu|x86_64-pc-windows-msvc|x86_64-apple-darwin|aarch64-apple-darwin)
            target_suffix="-$target"
            ;;
        current)
            local os_name=$(uname -s)
            local arch=$(uname -m)
            case "$os_name" in
                Darwin)
                    target_suffix=$([ "$arch" = "arm64" ] && echo "-aarch64-apple-darwin" || echo "-x86_64-apple-darwin")
                    ;;
                Linux)
                    target_suffix="-x86_64-unknown-linux-gnu"
                    ;;
            esac
            ;;
    esac

    if [ -n "$target_suffix" ]; then
        local target_launcher="$output_dir/${output_name}${target_suffix}"
        if [ "$node_platform" = "win" ]; then
            target_launcher="$output_dir/claude${target_suffix}.cmd"
        fi
        cp "$output_dir/$output_name" "$target_launcher"
        chmod +x "$target_launcher" 2>/dev/null || true
        log_info "Created target-specific launcher: $target_launcher"
    fi

    # Verify
    local bundle_size=$(du -sh "$bundle_dir" 2>/dev/null | cut -f1)
    log_info "Claude Code bundling completed for $target"
    log_info "Output: $output_dir/$output_name"
    log_info "Bundle size: $bundle_size"
}

# Bundle Codex CLI as sidecar
# This bundles Node.js runtime and Codex package
bundle_codex() {
    local target="$1"

    if [ "$BUNDLE_CODEX" != "true" ]; then
        log_info "Skipping Codex bundling (use --with-codex to enable)"
        return 0
    fi

    log_info "Bundling Codex CLI with Node.js for $target..."

    local output_dir="$PROJECT_ROOT/src-api/dist"
    local bundle_dir="$output_dir/codex-bundle"

    # Clean up
    rm -rf "$bundle_dir"
    mkdir -p "$bundle_dir"

    # Determine platform-specific settings
    local node_platform=""
    local node_arch=""
    local node_ext=""

    case "$target" in
        x86_64-unknown-linux-gnu)
            node_platform="linux"
            node_arch="x64"
            ;;
        x86_64-pc-windows-msvc)
            node_platform="win"
            node_arch="x64"
            node_ext=".exe"
            ;;
        x86_64-apple-darwin)
            node_platform="darwin"
            node_arch="x64"
            ;;
        aarch64-apple-darwin)
            node_platform="darwin"
            node_arch="arm64"
            ;;
        current)
            local os_name=$(uname -s)
            local arch=$(uname -m)
            case "$os_name" in
                Darwin)
                    node_platform="darwin"
                    node_arch=$([ "$arch" = "arm64" ] && echo "arm64" || echo "x64")
                    ;;
                Linux)
                    node_platform="linux"
                    node_arch="x64"
                    ;;
                *)
                    node_platform="linux"
                    node_arch="x64"
                    ;;
            esac
            ;;
        *)
            node_platform="linux"
            node_arch="x64"
            ;;
    esac

    # Download Node.js binary
    local node_version="20.18.0"
    local node_filename="node-v${node_version}-${node_platform}-${node_arch}"
    local node_url="https://nodejs.org/dist/v${node_version}/${node_filename}.tar.gz"

    # For Windows, use .zip format
    if [ "$node_platform" = "win" ]; then
        node_url="https://nodejs.org/dist/v${node_version}/${node_filename}.zip"
    fi

    log_info "Downloading Node.js v${node_version} for ${node_platform}-${node_arch}..."

    local temp_dir=$(mktemp -d)
    cd "$temp_dir"

    # Try to download, fallback to local node if fails
    if [ "$node_platform" = "win" ]; then
        if ! curl -fsSL "$node_url" -o node.zip 2>/dev/null; then
            log_warn "Failed to download Node.js, trying local node..."
            if command -v node &> /dev/null; then
                cp "$(which node)" "$bundle_dir/node${node_ext}"
                chmod +x "$bundle_dir/node${node_ext}" 2>/dev/null || true
            else
                log_error "Node.js not available"
                cd "$PROJECT_ROOT"
                rm -rf "$temp_dir"
                return 1
            fi
        else
            unzip -q node.zip
            cp "${node_filename}/node.exe" "$bundle_dir/node.exe"
        fi
    else
        if ! curl -fsSL "$node_url" | tar xz 2>/dev/null; then
            log_warn "Failed to download Node.js, trying local node..."
            if command -v node &> /dev/null; then
                cp "$(which node)" "$bundle_dir/node${node_ext}"
                chmod +x "$bundle_dir/node${node_ext}" 2>/dev/null || true
            else
                log_error "Node.js not available"
                cd "$PROJECT_ROOT"
                rm -rf "$temp_dir"
                return 1
            fi
        else
            cp "${node_filename}/bin/node" "$bundle_dir/node"
            chmod +x "$bundle_dir/node"
        fi
    fi

    cd "$PROJECT_ROOT"
    rm -rf "$temp_dir"

    # Verify Node.js binary
    if [ ! -f "$bundle_dir/node${node_ext}" ]; then
        log_error "Node.js binary not found"
        return 1
    fi

    log_info "Node.js binary ready"

    # Install Codex using npm
    cd "$bundle_dir"
    echo '{"name":"codex-bundle","private":true,"type":"module"}' > package.json

    log_info "Installing @openai/codex..."
    # Use npm mirror for faster download in China
    npm install @openai/codex --registry="${NPM_REGISTRY:-https://registry.npmmirror.com}" 2>&1 | tail -10

    # Verify installation
    if [ ! -f "node_modules/@openai/codex/bin/codex.js" ]; then
        log_error "Codex installation failed"
        cd "$PROJECT_ROOT"
        return 1
    fi

    log_info "Codex installed successfully"

    # Create launcher script
    local output_name="codex"
    if [ "$node_platform" = "win" ]; then
        output_name="codex.cmd"
        # Windows batch launcher
        cat > "$output_dir/$output_name" << 'BATCH_EOF'
@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
set "BUNDLE_DIR=%SCRIPT_DIR%codex-bundle"
if not exist "%BUNDLE_DIR%\node.exe" set "BUNDLE_DIR=%SCRIPT_DIR%..\Resources\codex-bundle"
"%BUNDLE_DIR%\node.exe" "%BUNDLE_DIR%\node_modules\@openai\codex\bin\codex.js" %*
BATCH_EOF
    else
        # Unix shell launcher - searches multiple locations for bundle
        cat > "$output_dir/$output_name" << 'SHELL_EOF'
#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Search for codex-bundle in multiple locations
# 1. Same directory as launcher (development / Linux)
# 2. ../Resources/codex-bundle (macOS app bundle)
# 3. Resources subdirectory
for DIR in "$SCRIPT_DIR/codex-bundle" "$SCRIPT_DIR/../Resources/codex-bundle" "$SCRIPT_DIR/Resources/codex-bundle"; do
    if [ -f "$DIR/node" ] && [ -d "$DIR/node_modules/@openai/codex" ]; then
        BUNDLE_DIR="$DIR"
        break
    fi
done

if [ -z "$BUNDLE_DIR" ]; then
    echo "Error: codex-bundle not found" >&2
    echo "Searched in:" >&2
    echo "  - $SCRIPT_DIR/codex-bundle" >&2
    echo "  - $SCRIPT_DIR/../Resources/codex-bundle" >&2
    exit 1
fi

exec "$BUNDLE_DIR/node" "$BUNDLE_DIR/node_modules/@openai/codex/bin/codex.js" "$@"
SHELL_EOF
        chmod +x "$output_dir/$output_name"
    fi

    cd "$PROJECT_ROOT"

    # Create target-specific launcher (Tauri adds target triple suffix to externalBin)
    local target_suffix=""
    case "$target" in
        x86_64-unknown-linux-gnu|x86_64-pc-windows-msvc|x86_64-apple-darwin|aarch64-apple-darwin)
            target_suffix="-$target"
            ;;
        current)
            local os_name=$(uname -s)
            local arch=$(uname -m)
            case "$os_name" in
                Darwin)
                    target_suffix=$([ "$arch" = "arm64" ] && echo "-aarch64-apple-darwin" || echo "-x86_64-apple-darwin")
                    ;;
                Linux)
                    target_suffix="-x86_64-unknown-linux-gnu"
                    ;;
            esac
            ;;
    esac

    if [ -n "$target_suffix" ]; then
        local target_launcher="$output_dir/${output_name}${target_suffix}"
        if [ "$node_platform" = "win" ]; then
            target_launcher="$output_dir/codex${target_suffix}.cmd"
        fi
        cp "$output_dir/$output_name" "$target_launcher"
        chmod +x "$target_launcher" 2>/dev/null || true
        log_info "Created target-specific launcher: $target_launcher"
    fi

    # Verify
    local bundle_size=$(du -sh "$bundle_dir" 2>/dev/null | cut -f1)
    log_info "Codex bundling completed for $target"
    log_info "Output: $output_dir/$output_name"
    log_info "Bundle size: $bundle_size"
}

# Update tauri.conf.json to include sidecars (Claude Code and/or Codex)
update_tauri_config() {
    if [ "$BUNDLE_CLAUDE_CODE" != "true" ] && [ "$BUNDLE_CODEX" != "true" ]; then
        return 0
    fi

    log_info "Updating tauri.conf.json to include sidecar binaries..."

    local config_file="$PROJECT_ROOT/src-tauri/tauri.conf.json"
    local backup_file="$PROJECT_ROOT/src-tauri/tauri.conf.json.backup"

    # Backup original config if not exists
    if [ ! -f "$backup_file" ]; then
        cp "$config_file" "$backup_file"
    fi

    # Use node to properly update JSON config
    node -e "
const fs = require('fs');
const config = JSON.parse(fs.readFileSync('$config_file', 'utf8'));

// Ensure arrays exist
if (!config.bundle.externalBin) {
    config.bundle.externalBin = [];
}
if (!config.bundle.resources) {
    config.bundle.resources = [];
}

// Add Claude Code if bundling is enabled
if ('$BUNDLE_CLAUDE_CODE' === 'true') {
    if (!config.bundle.externalBin.includes('../src-api/dist/claude')) {
        config.bundle.externalBin.unshift('../src-api/dist/claude');
    }
    const claudeResource = '../src-api/dist/claude-bundle/**/*';
    if (!config.bundle.resources.includes(claudeResource)) {
        config.bundle.resources.push(claudeResource);
    }
    console.log('Added Claude Code sidecar config');
}

// Add Codex if bundling is enabled
if ('$BUNDLE_CODEX' === 'true') {
    if (!config.bundle.externalBin.includes('../src-api/dist/codex')) {
        config.bundle.externalBin.unshift('../src-api/dist/codex');
    }
    const codexResource = '../src-api/dist/codex-bundle/**/*';
    if (!config.bundle.resources.includes(codexResource)) {
        config.bundle.resources.push(codexResource);
    }
    console.log('Added Codex sidecar config');
}

fs.writeFileSync('$config_file', JSON.stringify(config, null, 2));
console.log('Config updated successfully');
"
    log_info "Updated tauri.conf.json with sidecar configurations"
}

# Update tauri.conf.json to disable signing
disable_signing_config() {
    if [ "$SKIP_SIGNING" != "true" ]; then
        return 0
    fi

    log_info "Disabling code signing in tauri.conf.json..."

    local config_file="$PROJECT_ROOT/src-tauri/tauri.conf.json"

    # Use node to remove signing config
    node -e "
const fs = require('fs');
const config = JSON.parse(fs.readFileSync('$config_file', 'utf8'));

// Remove macOS signing identity to disable signing
if (config.bundle && config.bundle.macOS) {
    delete config.bundle.macOS.signingIdentity;
}

fs.writeFileSync('$config_file', JSON.stringify(config, null, 2));
console.log('Signing disabled in config');
"
}

# Restore tauri.conf.json after build (optional, for clean state)
restore_tauri_config() {
    local backup_file="$PROJECT_ROOT/src-tauri/tauri.conf.json.backup"

    if [ -f "$backup_file" ]; then
        # Keep the modified version for now, user can restore manually if needed
        log_info "Backup available at $backup_file"
    fi
}

# Build for Linux (x86_64)
build_linux() {
    log_info "Building for Linux x86_64..."

    local target="x86_64-unknown-linux-gnu"

    # Build API sidecar first
    build_api_sidecar "$target"

    # Bundle CLI tools if requested
    bundle_claude_code "$target"
    bundle_codex "$target"
    update_tauri_config

    # Add target if not exists
    rustup target add "$target" 2>/dev/null || true

    pnpm tauri build --target "$target"

    restore_tauri_config

    log_info "Linux build completed!"
    log_info "Output: src-tauri/target/$target/release/bundle/"
}

# Build for Windows (x86_64)
build_windows() {
    log_info "Building for Windows x86_64..."

    local target="x86_64-pc-windows-msvc"

    # Build API sidecar first
    build_api_sidecar "$target"

    # Bundle CLI tools if requested
    bundle_claude_code "$target"
    bundle_codex "$target"
    update_tauri_config

    # Add target if not exists
    rustup target add "$target" 2>/dev/null || true

    pnpm tauri build --target "$target"

    restore_tauri_config

    log_info "Windows build completed!"
    log_info "Output: src-tauri/target/$target/release/bundle/"
}

# Build for macOS Intel (x86_64)
build_mac_intel() {
    log_info "Building for macOS Intel (x86_64)..."

    local target="x86_64-apple-darwin"

    # Build API sidecar first
    build_api_sidecar "$target"

    # Bundle CLI tools if requested
    bundle_claude_code "$target"
    bundle_codex "$target"
    update_tauri_config

    # Add target if not exists
    rustup target add "$target" 2>/dev/null || true

    pnpm tauri build --target "$target"

    # Copy bundles to app bundle (after Tauri build)
    copy_claude_bundle_to_app "$target"
    copy_codex_bundle_to_app "$target"

    # Recreate DMG with bundles included
    recreate_dmg "$target"

    restore_tauri_config

    log_info "macOS Intel build completed!"
    log_info "Output: src-tauri/target/$target/release/bundle/"
}

# Copy claude-bundle to app bundle after Tauri build
copy_claude_bundle_to_app() {
    local target="$1"

    if [ "$BUNDLE_CLAUDE_CODE" != "true" ]; then
        return 0
    fi

    log_info "Copying claude-bundle to app bundle..."

    local app_path=""
    case "$target" in
        aarch64-apple-darwin|x86_64-apple-darwin)
            app_path="$PROJECT_ROOT/src-tauri/target/$target/release/bundle/macos/WorkAny.app/Contents/MacOS"
            ;;
        current)
            # Try to find the app
            app_path="$PROJECT_ROOT/src-tauri/target/release/bundle/macos/WorkAny.app/Contents/MacOS"
            if [ ! -d "$app_path" ]; then
                # Try with arch
                local arch=$(uname -m)
                if [ "$arch" = "arm64" ]; then
                    app_path="$PROJECT_ROOT/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/WorkAny.app/Contents/MacOS"
                else
                    app_path="$PROJECT_ROOT/src-tauri/target/x86_64-apple-darwin/release/bundle/macos/WorkAny.app/Contents/MacOS"
                fi
            fi
            ;;
        *)
            log_warn "Platform $target may not need bundle copy"
            return 0
            ;;
    esac

    local bundle_src="$PROJECT_ROOT/src-api/dist/claude-bundle"

    if [ ! -d "$bundle_src" ]; then
        log_error "claude-bundle not found at $bundle_src"
        return 1
    fi

    if [ ! -d "$app_path" ]; then
        log_warn "App bundle not found at $app_path"
        return 0
    fi

    # Copy claude-bundle to app bundle
    cp -r "$bundle_src" "$app_path/"
    log_info "Copied claude-bundle to $app_path/"

    # Also copy the launcher script (in case Tauri copied an old version)
    local launcher_src="$PROJECT_ROOT/src-api/dist/claude"
    if [ -f "$launcher_src" ]; then
        cp "$launcher_src" "$app_path/claude"
        chmod +x "$app_path/claude"
        log_info "Copied launcher script to $app_path/"
    fi

    # Verify
    if [ -f "$app_path/claude-bundle/node" ]; then
        log_info "claude-bundle successfully copied to app bundle"
    else
        log_error "Failed to copy claude-bundle"
        return 1
    fi
}

# Copy codex-bundle to app bundle after Tauri build
copy_codex_bundle_to_app() {
    local target="$1"

    if [ "$BUNDLE_CODEX" != "true" ]; then
        return 0
    fi

    log_info "Copying codex-bundle to app bundle..."

    local app_path=""
    case "$target" in
        aarch64-apple-darwin|x86_64-apple-darwin)
            app_path="$PROJECT_ROOT/src-tauri/target/$target/release/bundle/macos/WorkAny.app/Contents/MacOS"
            ;;
        current)
            # Try to find the app
            app_path="$PROJECT_ROOT/src-tauri/target/release/bundle/macos/WorkAny.app/Contents/MacOS"
            if [ ! -d "$app_path" ]; then
                # Try with arch
                local arch=$(uname -m)
                if [ "$arch" = "arm64" ]; then
                    app_path="$PROJECT_ROOT/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/WorkAny.app/Contents/MacOS"
                else
                    app_path="$PROJECT_ROOT/src-tauri/target/x86_64-apple-darwin/release/bundle/macos/WorkAny.app/Contents/MacOS"
                fi
            fi
            ;;
        *)
            log_warn "Platform $target may not need bundle copy"
            return 0
            ;;
    esac

    local bundle_src="$PROJECT_ROOT/src-api/dist/codex-bundle"

    if [ ! -d "$bundle_src" ]; then
        log_error "codex-bundle not found at $bundle_src"
        return 1
    fi

    if [ ! -d "$app_path" ]; then
        log_warn "App bundle not found at $app_path"
        return 0
    fi

    # Copy codex-bundle to app bundle
    cp -r "$bundle_src" "$app_path/"
    log_info "Copied codex-bundle to $app_path/"

    # Also copy the launcher script (in case Tauri copied an old version)
    local launcher_src="$PROJECT_ROOT/src-api/dist/codex"
    if [ -f "$launcher_src" ]; then
        cp "$launcher_src" "$app_path/codex"
        chmod +x "$app_path/codex"
        log_info "Copied codex launcher script to $app_path/"
    fi

    # Verify
    if [ -f "$app_path/codex-bundle/node" ]; then
        log_info "codex-bundle successfully copied to app bundle"
    else
        log_error "Failed to copy codex-bundle"
        return 1
    fi
}

# Recreate DMG after modifying app bundle
recreate_dmg() {
    local target="$1"

    if [ "$BUNDLE_CLAUDE_CODE" != "true" ]; then
        return 0
    fi

    log_info "Recreating DMG with claude-bundle included..."

    local app_path=""
    local dmg_dir=""
    local dmg_name=""

    case "$target" in
        aarch64-apple-darwin)
            app_path="$PROJECT_ROOT/src-tauri/target/$target/release/bundle/macos/WorkAny.app"
            dmg_dir="$PROJECT_ROOT/src-tauri/target/$target/release/bundle/dmg"
            dmg_name="WorkAny_0.1.1_aarch64.dmg"
            ;;
        x86_64-apple-darwin)
            app_path="$PROJECT_ROOT/src-tauri/target/$target/release/bundle/macos/WorkAny.app"
            dmg_dir="$PROJECT_ROOT/src-tauri/target/$target/release/bundle/dmg"
            dmg_name="WorkAny_0.1.1_x64.dmg"
            ;;
        *)
            log_warn "DMG recreation not needed for $target"
            return 0
            ;;
    esac

    if [ ! -d "$app_path" ]; then
        log_warn "App bundle not found at $app_path"
        return 0
    fi

    # Remove old DMG and create new one
    rm -f "$dmg_dir"/*.dmg
    mkdir -p "$dmg_dir"

    hdiutil create -volname WorkAny -srcfolder "$app_path" -ov -format UDZO "$dmg_dir/$dmg_name"

    if [ -f "$dmg_dir/$dmg_name" ]; then
        local dmg_size=$(du -h "$dmg_dir/$dmg_name" | cut -f1)
        log_info "DMG recreated: $dmg_dir/$dmg_name ($dmg_size)"
    else
        log_error "Failed to recreate DMG"
        return 1
    fi
}

# Build for macOS Apple Silicon (aarch64)
build_mac_arm() {
    log_info "Building for macOS Apple Silicon (aarch64)..."

    local target="aarch64-apple-darwin"

    # Build API sidecar first
    build_api_sidecar "$target"

    # Bundle CLI tools if requested
    bundle_claude_code "$target"
    bundle_codex "$target"
    update_tauri_config

    # Add target if not exists
    rustup target add "$target" 2>/dev/null || true

    pnpm tauri build --target "$target"

    # Copy bundles to app bundle (after Tauri build)
    copy_claude_bundle_to_app "$target"
    copy_codex_bundle_to_app "$target"

    # Recreate DMG with bundles included
    recreate_dmg "$target"

    restore_tauri_config

    log_info "macOS Apple Silicon build completed!"
    log_info "Output: src-tauri/target/$target/release/bundle/"
}

# Build for current platform
build_current() {
    log_info "Building for current platform..."

    # Build API sidecar first
    build_api_sidecar "current"

    # Bundle CLI tools if requested
    bundle_claude_code "current"
    bundle_codex "current"
    update_tauri_config

    pnpm tauri build

    # Copy bundles to app bundle
    copy_claude_bundle_to_app "current"
    copy_codex_bundle_to_app "current"

    restore_tauri_config

    log_info "Build completed!"
    log_info "Output: src-tauri/target/release/bundle/"
}


# Show help
show_help() {
    echo "WorkAny Build Script"
    echo ""
    echo "Usage: ./scripts/build.sh [platform] [options]"
    echo ""
    echo "Platforms:"
    echo "  linux       - Build for Linux x86_64"
    echo "  windows     - Build for Windows x86_64"
    echo "  mac-intel   - Build for macOS Intel (x86_64) ~30MB"
    echo "  mac-arm     - Build for macOS Apple Silicon (aarch64) ~27MB"
    echo "  current     - Build for current platform (default)"
    echo "  all         - Build for all platforms (requires cross-compilation setup)"
    echo ""
    echo "Options:"
    echo "  --with-claude   Bundle Claude Code CLI as a sidecar"
    echo "                  This allows the app to work without requiring users"
    echo "                  to install Claude Code separately (no Node.js needed)"
    echo "  --with-codex    Bundle Codex CLI as a sidecar for sandbox execution"
    echo "                  This allows out-of-box sandbox support"
    echo "  --sign          Enable code signing and notarization (macOS)"
    echo "                  Default: signing is DISABLED for faster builds"
    echo "  --no-sign       Explicitly disable signing (default behavior)"
    echo ""
    echo "Requirements:"
    echo "  - pnpm"
    echo "  - Node.js (for API sidecar)"
    echo "  - Rust (cargo, rustup)"
    echo ""
    echo "Examples:"
    echo "  ./scripts/build.sh                        # Build for current platform (no signing)"
    echo "  ./scripts/build.sh mac-arm                # Build for Apple Silicon (fast, no signing)"
    echo "  ./scripts/build.sh mac-arm --with-claude  # Build with bundled Claude Code"
    echo "  ./scripts/build.sh mac-arm --with-codex   # Build with bundled Codex sandbox"
    echo "  ./scripts/build.sh mac-arm --with-claude --with-codex  # Full featured build"
    echo "  ./scripts/build.sh mac-arm --sign         # Build with signing and notarization"
    echo "  ./scripts/build.sh mac-arm --with-claude --with-codex --sign  # Full release build"
    echo ""
    echo "Note: Cross-compilation requires proper toolchain setup."
    echo "      For CI/CD builds, use GitHub Actions workflow instead."
    echo ""
    echo "CLI bundling:"
    echo "  When --with-claude is specified, the build will:"
    echo "  1. Download and bundle Claude Code CLI"
    echo "  2. Include it as a sidecar binary in the app"
    echo "  3. The app will use bundled Claude Code if user hasn't installed it"
    echo ""
    echo "  When --with-codex is specified, the build will:"
    echo "  1. Download and bundle Codex CLI (OpenAI sandbox)"
    echo "  2. Include it as a sidecar binary in the app"
    echo "  3. The app will use bundled Codex for sandbox execution"
}

# Parse arguments and set global variables
# Sets: BUNDLE_CLAUDE_CODE, BUNDLE_CODEX, BUILD_PLATFORM, SKIP_SIGNING
parse_args() {
    BUILD_PLATFORM="current"

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --with-claude)
                BUNDLE_CLAUDE_CODE=true
                shift
                ;;
            --with-codex)
                BUNDLE_CODEX=true
                shift
                ;;
            --sign)
                SKIP_SIGNING=false
                shift
                ;;
            --no-sign)
                SKIP_SIGNING=true
                shift
                ;;
            -h|--help|help)
                show_help
                exit 0
                ;;
            linux|windows|mac-intel|mac-arm|current|all)
                BUILD_PLATFORM="$1"
                shift
                ;;
            *)
                log_error "Unknown argument: $1"
                show_help
                exit 1
                ;;
        esac
    done
}

# Main
main() {
    # Parse arguments first (sets BUILD_PLATFORM, BUNDLE_CLAUDE_CODE, BUNDLE_CODEX, SKIP_SIGNING)
    parse_args "$@"

    if [ "$BUNDLE_CLAUDE_CODE" = "true" ]; then
        log_info "Claude Code bundling enabled"
    fi

    if [ "$BUNDLE_CODEX" = "true" ]; then
        log_info "Codex CLI bundling enabled"
    fi

    if [ "$SKIP_SIGNING" = "true" ]; then
        log_info "Code signing disabled (use --sign to enable)"
        # Use ad-hoc signing (no certificate required, faster)
        export APPLE_SIGNING_IDENTITY="-"
        # Disable notarization
        export TAURI_SKIP_NOTARIZATION=true
        # Also set these to ensure no signing attempt
        unset APPLE_CERTIFICATE
        unset APPLE_CERTIFICATE_PASSWORD
        unset APPLE_ID
        unset APPLE_PASSWORD
        unset APPLE_TEAM_ID
        # Also modify config file to remove signing identity
        disable_signing_config
    else
        log_info "Code signing enabled"
    fi

    local platform="$BUILD_PLATFORM"

    check_requirements
    install_deps

    case "$platform" in
        linux)
            build_linux
            ;;
        windows)
            build_windows
            ;;
        mac-intel)
            build_mac_intel
            ;;
        mac-arm)
            build_mac_arm
            ;;
        current)
            build_current
            ;;
        all)
            log_warn "Building for all platforms requires cross-compilation setup."
            log_warn "Consider using GitHub Actions for cross-platform builds."
            build_linux
            build_windows
            build_mac_intel
            build_mac_arm
            ;;
    esac

    # Summary
    local bundled_items=""
    if [ "$BUNDLE_CLAUDE_CODE" = "true" ]; then
        bundled_items="Claude Code"
    fi
    if [ "$BUNDLE_CODEX" = "true" ]; then
        if [ -n "$bundled_items" ]; then
            bundled_items="$bundled_items + Codex"
        else
            bundled_items="Codex"
        fi
    fi

    if [ -n "$bundled_items" ]; then
        log_info "Build completed with bundled: $bundled_items"
    else
        log_info "Build completed (no CLI tools bundled)"
    fi
}

main "$@"
