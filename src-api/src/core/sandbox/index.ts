import { getSandboxRegistry } from '@/core/sandbox/registry';
import { registerBuiltinProviders } from '@/extensions/sandbox/index';

import type {
  ISandboxProvider,
  SandboxExecOptions,
  SandboxExecResult,
  SandboxProviderType,
  ScriptOptions,
} from './types.js';

/**
 * Sandbox Module
 *
 * Provides extensible sandbox functionality for isolated code execution.
 * Supports multiple providers: BoxLite (VM), Native (no isolation), Docker, E2B.
 */

// Export types
export * from '@/core/sandbox/types';

// Export plugin system
export * from '@/core/sandbox/plugin';

// Export pool
export {
  SandboxPool,
  getGlobalSandboxPool,
  initGlobalSandboxPool,
  shutdownGlobalSandboxPool,
  type PooledSandbox,
  type PooledSandboxConfig,
  type PoolStats,
  type IPoolableSandboxProvider,
} from '@/core/sandbox/pool';

// Export registry
export {
  getSandboxRegistry,
  registerSandboxProvider,
  createSandboxProvider,
  getSandboxProvider,
  getAvailableSandboxProviders,
  stopAllSandboxProviders,
} from '@/core/sandbox/registry';

// Export providers
export {
  NativeProvider,
  createNativeProvider,
  nativePlugin,
  BoxLiteProvider,
  createBoxLiteProvider,
  isBoxLiteAvailable,
  boxlitePlugin,
  builtinPlugins,
  registerBuiltinProviders,
  registerSandboxPlugin,
} from '@/extensions/sandbox/index';

// ============================================================================
// Initialization
// ============================================================================

let initialized = false;

/**
 * Initialize the sandbox module with built-in providers
 */
export async function initSandbox(): Promise<void> {
  if (initialized) {
    return;
  }

  registerBuiltinProviders();
  initialized = true;

  console.log('[Sandbox] Module initialized');
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Result of provider selection with fallback info
 */
export interface ProviderSelectionResult {
  provider: ISandboxProvider;
  usedFallback: boolean;
  fallbackReason?: string;
}

/**
 * Get the best available sandbox provider
 * Priority: BoxLite (VM isolation) → Native (local) → Error with install instructions
 */
export async function getBestProvider(): Promise<ISandboxProvider> {
  const result = await getBestProviderWithInfo();
  return result.provider;
}

/**
 * Check if running in development mode
 * Development mode: tsx, ts-node, or NODE_ENV=development
 */
function isDevMode(): boolean {
  // Check NODE_ENV
  if (process.env.NODE_ENV === 'development') {
    return true;
  }

  // Check if running with tsx or ts-node (development)
  const execArgv = process.execArgv.join(' ');
  if (execArgv.includes('tsx') || execArgv.includes('ts-node')) {
    return true;
  }

  // Check process title
  if (process.title.includes('tsx') || process.title.includes('ts-node')) {
    return true;
  }

  // Check if running from source (not compiled binary)
  const mainScript = process.argv[1] || '';
  if (mainScript.endsWith('.ts') || mainScript.includes('tsx')) {
    return true;
  }

  return false;
}

/**
 * Get the best available sandbox provider with fallback information
 * Priority:
 * - Development mode: Native (for faster iteration without entitlements)
 * - Production mode: BoxLite (VM isolation) → Native (fallback)
 */
export async function getBestProviderWithInfo(): Promise<ProviderSelectionResult> {
  await initSandbox();

  const registry = getSandboxRegistry();
  const devMode = isDevMode();

  // In development mode, use Native provider directly (no entitlements required)
  if (devMode) {
    console.log('[Sandbox] 🔧 Development mode detected, using Native provider (no VM isolation)');
    console.log('[Sandbox] 💡 Use signed binary or packaged app for BoxLite VM isolation');

    try {
      const nativeProvider = await registry.getInstance('native');
      return {
        provider: nativeProvider,
        usedFallback: true,
        fallbackReason: '开发模式下使用本机执行环境。打包后的应用将使用 BoxLite VM 隔离。',
      };
    } catch (error) {
      console.error('[Sandbox] Native provider failed:', error);
      throw new Error('开发模式下无法初始化本机执行环境。');
    }
  }

  // Production mode: try BoxLite first
  // 1. First try BoxLite (preferred - VM isolation)
  try {
    const boxliteProvider = registry.create('boxlite');
    console.log('[Sandbox] Checking BoxLite availability...');
    const isBoxliteAvailable = await boxliteProvider.isAvailable();

    if (isBoxliteAvailable) {
      console.log('[Sandbox] ✅ Using BoxLite VM sandbox (hardware isolation)');
      await boxliteProvider.init();
      return {
        provider: boxliteProvider,
        usedFallback: false,
      };
    } else {
      console.log('[Sandbox] BoxLite runtime verification failed, will use fallback');
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.warn('[Sandbox] BoxLite not available:', errorMsg);
  }

  // 2. Fallback to Native (local execution)
  console.log('[Sandbox] ⚠️ BoxLite not available, falling back to Native (local) execution');

  try {
    const nativeProvider = await registry.getInstance('native');
    console.log('[Sandbox] ✅ Using Native sandbox (no isolation, local execution)');
    return {
      provider: nativeProvider,
      usedFallback: true,
      fallbackReason: 'BoxLite VM 不可用，使用本机执行环境。如需 VM 隔离，请确保 BoxLite 已正确安装。',
    };
  } catch (error) {
    console.error('[Sandbox] Native provider also failed:', error);
    throw new Error(
      '无法初始化沙箱环境。BoxLite VM 和本机执行环境都不可用。\n' +
      '请检查系统环境或联系技术支持。'
    );
  }
}

/**
 * Execute a command using the best available sandbox
 */
export async function execInSandbox(
  options: SandboxExecOptions
): Promise<SandboxExecResult> {
  const { provider } = await getBestProviderWithInfo();
  const result = await provider.exec(options);
  const caps = provider.getCapabilities();

  // Add provider info to result
  return {
    ...result,
    provider: {
      type: provider.type,
      name: provider.name,
      isolation: caps.isolation,
    },
  };
}

/**
 * Run a script using the best available sandbox
 * Returns result with provider info for UI display
 */
export async function runScriptInSandbox(
  filePath: string,
  workDir: string,
  options?: ScriptOptions
): Promise<SandboxExecResult> {
  const { provider, usedFallback, fallbackReason } = await getBestProviderWithInfo();
  const result = await provider.runScript(filePath, workDir, options);
  const caps = provider.getCapabilities();

  // Log which provider was used
  const providerLabel = provider.type === 'boxlite'
    ? '🔒 BoxLite VM (硬件隔离)'
    : '⚠️ Native (本机执行)';
  console.log(`[Sandbox] Script executed via: ${providerLabel}`);

  if (usedFallback && fallbackReason) {
    console.log(`[Sandbox] Fallback reason: ${fallbackReason}`);
  }

  // Add provider info to result for UI display
  return {
    ...result,
    provider: {
      type: provider.type,
      name: provider.name,
      isolation: caps.isolation,
    },
  };
}

/**
 * Get the current sandbox mode information
 */
export async function getSandboxInfo(): Promise<{
  available: boolean;
  provider: SandboxProviderType;
  providerName: string;
  isolation: 'vm' | 'container' | 'process' | 'none';
  message: string;
  usedFallback: boolean;
  fallbackReason?: string;
}> {
  await initSandbox();

  try {
    const { provider, usedFallback, fallbackReason } = await getBestProviderWithInfo();
    const caps = provider.getCapabilities();

    const isolationLabel = caps.isolation === 'vm'
      ? 'VM 硬件隔离'
      : caps.isolation === 'container'
      ? '容器隔离'
      : caps.isolation === 'process'
      ? '进程隔离'
      : '无隔离';

    return {
      available: true,
      provider: provider.type,
      providerName: provider.name,
      isolation: caps.isolation,
      message: `使用 ${provider.name} (${isolationLabel})`,
      usedFallback,
      fallbackReason,
    };
  } catch (error) {
    return {
      available: false,
      provider: 'native',
      providerName: 'Native',
      isolation: 'none',
      message: '沙箱环境不可用',
      usedFallback: true,
      fallbackReason: error instanceof Error ? error.message : '未知错误',
    };
  }
}
