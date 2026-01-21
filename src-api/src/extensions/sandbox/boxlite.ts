/**
 * BoxLite Sandbox Provider
 *
 * Provides VM-isolated code execution using BoxLite micro-VMs.
 * Supports macOS Apple Silicon and Linux with KVM.
 */

import * as fs from 'fs';
import * as path from 'path';

import { BOXLITE_METADATA, defineSandboxPlugin } from '@/core/sandbox/plugin';
import type { SandboxPlugin } from '@/core/sandbox/plugin';
import type {
  BoxLiteProviderConfig,
  ISandboxProvider,
  SandboxCapabilities,
  SandboxExecOptions,
  SandboxExecResult,
  SandboxProviderType,
  ScriptOptions,
  VolumeMount,
} from '@/core/sandbox/types';

// Dynamic import for BoxLite to handle platforms where it's not available
let SimpleBox: typeof import('@boxlite-ai/boxlite').SimpleBox | null = null;
let boxliteModuleLoaded = false;
let boxliteRuntimeVerified = false;
let boxliteRuntimeError: string | null = null;

// Direct native module imports for Bun compatibility
// Native modules are shipped alongside the binary, not bundled
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let nativeModule: any = null;

// Custom SimpleBox implementation for when we load native module directly
// This mirrors the functionality of @boxlite-ai/boxlite's SimpleBox class
class SimpleBoxDirect {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _runtime: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _box: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _boxPromise: Promise<any> | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _boxOpts: any;
  private _name?: string;

  constructor(options: {
    image?: string;
    cpus?: number;
    memoryMib?: number;
    autoRemove?: boolean;
    workingDir?: string;
    env?: Record<string, string>;
    volumes?: Array<{ hostPath: string; guestPath: string; readOnly?: boolean }>;
  } = {}) {
    const JsBoxlite = nativeModule?.JsBoxlite;
    if (!JsBoxlite) {
      throw new Error('Native module not loaded');
    }

    this._runtime = JsBoxlite.withDefaultConfig();
    this._boxOpts = {
      image: options.image,
      cpus: options.cpus,
      memoryMib: options.memoryMib,
      autoRemove: options.autoRemove ?? true,
      detach: false,
      workingDir: options.workingDir,
      env: options.env
        ? Object.entries(options.env).map(([key, value]) => ({ key, value }))
        : undefined,
      volumes: options.volumes,
    };
  }

  private async _ensureBox() {
    if (this._box) {
      return this._box;
    }
    if (!this._boxPromise) {
      this._boxPromise = this._runtime.create(this._boxOpts, this._name);
    }
    this._box = await this._boxPromise;
    return this._box;
  }

  async exec(cmd: string, ...args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const box = await this._ensureBox();
    const execution = await box.exec(cmd, args, undefined, false);

    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];

    // Get streams
    let stdout = null;
    let stderr = null;
    try { stdout = await execution.stdout(); } catch { /* expected */ }
    try { stderr = await execution.stderr(); } catch { /* expected */ }

    // Read stdout
    if (stdout) {
      try {
        while (true) {
          const line = await stdout.next();
          if (line === null) break;
          stdoutLines.push(line);
        }
      } catch { /* stream ended */ }
    }

    // Read stderr
    if (stderr) {
      try {
        while (true) {
          const line = await stderr.next();
          if (line === null) break;
          stderrLines.push(line);
        }
      } catch { /* stream ended */ }
    }

    const result = await execution.wait();
    return {
      exitCode: result.exitCode,
      stdout: stdoutLines.join(''),
      stderr: stderrLines.join(''),
    };
  }

  async stop(): Promise<void> {
    if (!this._box) return;
    await this._box.stop();
  }
}

// Get potential directories where boxlite native module might be located
function getBoxliteSearchPaths(): string[] {
  const execPath = process.execPath;
  const execDir = path.dirname(execPath);
  const searchPaths: string[] = [];

  // Check if running as Bun compiled binary (single file executable)
  const isBunBinary = execPath.includes('workany-api') ||
                      (!execPath.includes('node') && !execPath.includes('bun'));

  if (isBunBinary) {
    // 1. Same directory as executable (Linux, Windows, development)
    searchPaths.push(path.join(execDir, 'boxlite'));

    // 2. macOS app bundle: Resources directory (Contents/MacOS/../Resources)
    searchPaths.push(path.join(execDir, '..', 'Resources', 'boxlite'));

    // 3. macOS app bundle alternative: just Resources
    searchPaths.push(path.join(execDir, 'Resources', 'boxlite'));
  }

  return searchPaths;
}

// Try to load native module directly (for Bun compiled binaries)
function loadNativeModuleDirect(): unknown {
  if (nativeModule) {
    return nativeModule;
  }

  // Determine the native module filename based on platform
  let nodeFileName = '';
  if (process.platform === 'darwin' && process.arch === 'arm64') {
    nodeFileName = 'index.darwin-arm64.node';
  } else if (process.platform === 'linux' && process.arch === 'x64') {
    nodeFileName = 'index.linux-x64-gnu.node';
  } else if (process.platform === 'darwin' && process.arch === 'x64') {
    nodeFileName = 'index.darwin-x64.node';
  }

  if (!nodeFileName) {
    console.log(`[BoxLiteProvider] Unsupported platform: ${process.platform}-${process.arch}`);
    return null;
  }

  // Search for native module in potential locations
  const searchPaths = getBoxliteSearchPaths();
  console.log(`[BoxLiteProvider] Searching for native module in: ${searchPaths.join(', ')}`);

  for (const boxliteDir of searchPaths) {
    const nativeModulePath = path.join(boxliteDir, nodeFileName);

    if (fs.existsSync(nativeModulePath)) {
      try {
        console.log(`[BoxLiteProvider] Loading native module from: ${nativeModulePath}`);
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        nativeModule = require(nativeModulePath);
        console.log(`[BoxLiteProvider] Loaded native module: ${process.platform}-${process.arch}`);
        return nativeModule;
      } catch (error) {
        console.warn(`[BoxLiteProvider] Failed to load from ${nativeModulePath}:`, error);
      }
    } else {
      console.log(`[BoxLiteProvider] Native module not found at: ${nativeModulePath}`);
    }
  }

  // Fallback: Try npm package require (for development mode)
  try {
    if (process.platform === 'darwin' && process.arch === 'arm64') {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      nativeModule = require('@boxlite-ai/boxlite-darwin-arm64');
      console.log('[BoxLiteProvider] Loaded native module from npm: darwin-arm64');
      return nativeModule;
    } else if (process.platform === 'linux' && process.arch === 'x64') {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      nativeModule = require('@boxlite-ai/boxlite-linux-x64-gnu');
      console.log('[BoxLiteProvider] Loaded native module from npm: linux-x64');
      return nativeModule;
    }
  } catch (error) {
    console.warn('[BoxLiteProvider] Failed to load native module from npm:', error);
  }

  return null;
}

// Try to load BoxLite module
async function loadBoxLiteModule(): Promise<boolean> {
  if (boxliteModuleLoaded) {
    return true;
  }

  // First try to load native module directly (for Bun compatibility)
  const directNative = loadNativeModuleDirect();

  // If native module is loaded directly, use our custom SimpleBox implementation
  if (directNative && nativeModule?.JsBoxlite) {
    console.log('[BoxLiteProvider] Using direct native module with SimpleBoxDirect');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    SimpleBox = SimpleBoxDirect as any;
    boxliteModuleLoaded = true;
    return true;
  }

  // Fallback: Try to import the @boxlite-ai/boxlite JavaScript package
  try {
    const boxlite = await import('@boxlite-ai/boxlite');
    SimpleBox = boxlite.SimpleBox;
    boxliteModuleLoaded = true;
    console.log('[BoxLiteProvider] BoxLite module loaded from npm package');
    return true;
  } catch (error) {
    console.warn(
      '[BoxLiteProvider] BoxLite module not available:',
      error instanceof Error ? error.message : error
    );
    return false;
  }
}

// Verify BoxLite runtime can actually create and run VMs
async function verifyBoxLiteRuntime(): Promise<boolean> {
  // If already verified (success or failure), return cached result
  if (boxliteRuntimeVerified) {
    console.log(`[BoxLiteProvider] Using cached verification result: ${boxliteRuntimeError === null ? 'success' : 'failed: ' + boxliteRuntimeError}`);
    return boxliteRuntimeError === null;
  }

  if (!boxliteModuleLoaded || !SimpleBox) {
    boxliteRuntimeVerified = true;
    boxliteRuntimeError = 'BoxLite module not loaded';
    console.log('[BoxLiteProvider] Verification failed: module not loaded');
    return false;
  }

  try {
    console.log('[BoxLiteProvider] Verifying BoxLite runtime...');
    // Try to create a minimal box and run a simple command
    const testBox = new SimpleBox({
      image: 'alpine:latest',
      memoryMib: 256,
      cpus: 1,
      autoRemove: true,
    });

    // Try to run a simple command
    const result = await testBox.exec('echo', 'test');
    await testBox.stop();

    if (result.exitCode === 0) {
      console.log('[BoxLiteProvider] ✅ BoxLite runtime verified successfully');
      boxliteRuntimeVerified = true;
      boxliteRuntimeError = null;
      return true;
    } else {
      throw new Error(`Test command failed with exit code ${result.exitCode}`);
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.warn('[BoxLiteProvider] ❌ BoxLite runtime verification failed:', errorMsg);
    boxliteRuntimeVerified = true;
    boxliteRuntimeError = errorMsg;
    return false;
  }
}

// Full availability check: module loaded + runtime works
async function loadBoxLite(): Promise<boolean> {
  const moduleLoaded = await loadBoxLiteModule();
  if (!moduleLoaded) {
    return false;
  }

  // Verify runtime actually works
  return verifyBoxLiteRuntime();
}

// Get the runtime error message (for logging/debugging)
function getBoxLiteRuntimeError(): string | null {
  return boxliteRuntimeError;
}

export class BoxLiteProvider implements ISandboxProvider {
  readonly type: SandboxProviderType = 'boxlite';
  readonly name = 'BoxLite VM';
  readonly version = '1.0.0';

  private config: BoxLiteProviderConfig['config'] = {
    memoryMib: 1024,
    cpus: 2,
    workDir: '/workspace',
    autoRemove: true,
  };

  private volumes: VolumeMount[] = [];
  private box: InstanceType<
    typeof import('@boxlite-ai/boxlite').SimpleBox
  > | null = null;
  private currentImage: string = 'node:18-alpine';

  async isAvailable(): Promise<boolean> {
    console.log('[BoxLiteProvider] isAvailable() called');
    const result = await loadBoxLite();
    console.log(`[BoxLiteProvider] isAvailable() result: ${result}`);
    return result;
  }

  async init(config?: Record<string, unknown>): Promise<void> {
    if (config) {
      this.config = { ...this.config, ...config };
    }

    const available = await this.isAvailable();
    if (!available) {
      throw new Error('BoxLite is not available on this platform');
    }

    console.log('[BoxLiteProvider] Initialized with config:', this.config);
  }

  private async getOrCreateBox(
    image: string
  ): Promise<InstanceType<typeof import('@boxlite-ai/boxlite').SimpleBox>> {
    // Reuse existing box if same image
    if (this.box && this.currentImage === image) {
      return this.box;
    }

    // Stop existing box if different image
    if (this.box) {
      try {
        await this.box.stop();
      } catch (e) {
        console.warn('[BoxLiteProvider] Error stopping previous box:', e);
      }
    }

    if (!SimpleBox) {
      throw new Error('BoxLite is not loaded');
    }

    console.log(`[BoxLiteProvider] Creating new box with image: ${image}`);

    this.box = new SimpleBox({
      image,
      memoryMib: this.config.memoryMib || 1024,
      cpus: this.config.cpus || 2,
      autoRemove: this.config.autoRemove ?? true,
      workingDir: this.config.workDir || '/workspace',
      volumes: this.volumes.map((v) => ({
        hostPath: v.hostPath,
        guestPath: v.guestPath,
        readOnly: v.readOnly,
      })),
    });

    this.currentImage = image;

    // Wait for box to be ready
    await this.box.exec('echo', 'Box ready');
    console.log('[BoxLiteProvider] Box initialized successfully');

    return this.box;
  }

  async exec(options: SandboxExecOptions): Promise<SandboxExecResult> {
    const startTime = Date.now();
    const { command, args = [], cwd, env, image } = options;

    const workDir = cwd || this.config.workDir || '/workspace';
    const targetImage = image || this.currentImage || 'node:18-alpine';

    try {
      const box = await this.getOrCreateBox(targetImage);

      // Build the full command with cd and environment
      const envString = env
        ? Object.entries(env)
            .map(([k, v]) => `${k}="${v}"`)
            .join(' ')
        : '';

      const fullCommand = envString
        ? `cd ${workDir} && ${envString} ${command} ${args.join(' ')}`
        : `cd ${workDir} && ${command} ${args.join(' ')}`;

      console.log(`[BoxLiteProvider] Executing: ${fullCommand}`);

      const result = await box.exec('sh', '-c', fullCommand);

      return {
        stdout: result.stdout || '',
        stderr: result.stderr || '',
        exitCode: result.exitCode || 0,
        duration: Date.now() - startTime,
      };
    } catch (error: unknown) {
      const err = error as {
        stdout?: string;
        stderr?: string;
        exitCode?: number;
      };
      return {
        stdout: err.stdout || '',
        stderr: err.stderr || String(error),
        exitCode: err.exitCode || 1,
        duration: Date.now() - startTime,
      };
    }
  }

  async runScript(
    filePath: string,
    workDir: string,
    options?: ScriptOptions
  ): Promise<SandboxExecResult> {
    const ext = path.extname(filePath).toLowerCase();
    let image = 'node:18-alpine';
    let runtime = 'node';

    switch (ext) {
      case '.py':
        image = 'python:3.11-slim';
        runtime = 'python';
        break;
      case '.ts':
      case '.mts':
        image = 'oven/bun:latest';
        runtime = 'bun';
        break;
      case '.js':
      case '.mjs':
        image = 'node:18-alpine';
        runtime = 'node';
        break;
      default:
        runtime = 'node';
    }

    // Calculate script path inside container
    let scriptPathInContainer = filePath;
    if (filePath.startsWith(workDir)) {
      const relativePath = filePath.slice(workDir.length).replace(/^\//, '');
      scriptPathInContainer = `/workspace/${relativePath}`;
    } else {
      const fileName = path.basename(filePath);
      scriptPathInContainer = `/workspace/${fileName}`;
    }

    console.log(`[BoxLiteProvider] Running script: ${filePath}`);
    console.log(
      `[BoxLiteProvider] Mounting ${workDir} -> ${workDir} (same path in container)`
    );
    console.log(`[BoxLiteProvider] Script path in container: ${filePath}`);

    // Mount workDir to the SAME PATH inside container
    // This way scripts can use the original host paths without modification
    this.setVolumes([
      {
        hostPath: workDir,
        guestPath: workDir, // Mount to same path, not /workspace
        readOnly: false,
      },
    ]);

    // Update scriptPathInContainer to use original path since we mount to same path
    scriptPathInContainer = filePath;

    // Need to create a new box with the volume mount
    if (this.box) {
      try {
        await this.box.stop();
      } catch (e) {
        console.warn('[BoxLiteProvider] Error stopping box:', e);
      }
      this.box = null;
    }

    const box = await this.getOrCreateBox(image);

    // Install packages if specified
    if (
      options?.packages &&
      options.packages.length > 0 &&
      runtime !== 'python'
    ) {
      console.log(
        `[BoxLiteProvider] Installing packages: ${options.packages.join(', ')}`
      );
      await box.exec(
        'sh',
        '-c',
        `cd "${workDir}" && npm install --no-save ${options.packages.join(' ')}`
      );
    }

    // Run the script
    const startTime = Date.now();
    const argsStr = options?.args?.join(' ') || '';
    const result = await box.exec(
      'sh',
      '-c',
      `cd "${workDir}" && ${runtime} "${scriptPathInContainer}" ${argsStr}`
    );

    // Sync files from VM back to host
    // BoxLite VMs may not auto-sync volume mounts like Docker, so we need to explicitly copy files
    const scriptBasename = path.basename(filePath);
    console.log(
      `[BoxLiteProvider] Starting file sync, script: ${scriptBasename}`
    );

    try {
      // List all files in workDir inside the VM
      const listResult = await box.exec(
        'sh',
        '-c',
        `ls -la "${workDir}/" && find "${workDir}" -maxdepth 2 -type f 2>/dev/null`
      );
      console.log(
        `[BoxLiteProvider] Files in ${workDir}:\n${listResult.stdout}`
      );

      if (listResult.stdout) {
        const lines = listResult.stdout.trim().split('\n');
        // Filter only file paths (lines starting with workDir)
        const files = lines.filter(
          (f) => f && f.startsWith(workDir) && !f.endsWith(scriptBasename)
        );

        console.log(
          `[BoxLiteProvider] Files to sync: ${JSON.stringify(files)}`
        );

        for (const containerFile of files) {
          try {
            // Read file content from container using base64
            console.log(`[BoxLiteProvider] Reading file: ${containerFile}`);
            const catResult = await box.exec(
              'sh',
              '-c',
              `base64 "${containerFile}"`
            );

            if (catResult.exitCode === 0 && catResult.stdout) {
              // Decode and write to host - path is already the host path
              const hostFile = containerFile;
              const base64Content = catResult.stdout.replace(/\s/g, ''); // Remove whitespace
              const content = Buffer.from(base64Content, 'base64');

              // Ensure parent directory exists
              const parentDir = path.dirname(hostFile);
              if (!fs.existsSync(parentDir)) {
                fs.mkdirSync(parentDir, { recursive: true });
              }

              fs.writeFileSync(hostFile, content);
              console.log(
                `[BoxLiteProvider] ✅ Synced: ${containerFile} -> ${hostFile} (${content.length} bytes)`
              );
            } else {
              console.warn(
                `[BoxLiteProvider] ❌ Failed to read ${containerFile}: exit=${catResult.exitCode}, stderr=${catResult.stderr}`
              );
            }
          } catch (syncError) {
            console.warn(
              `[BoxLiteProvider] ❌ Sync error for ${containerFile}:`,
              syncError
            );
          }
        }
      }
    } catch (syncError) {
      console.warn(`[BoxLiteProvider] File sync error:`, syncError);
    }

    return {
      stdout: result.stdout || '',
      stderr: result.stderr || '',
      exitCode: result.exitCode || 0,
      duration: Date.now() - startTime,
    };
  }

  async stop(): Promise<void> {
    if (this.box) {
      console.log('[BoxLiteProvider] Stopping box');
      try {
        await this.box.stop();
      } catch (e) {
        console.warn('[BoxLiteProvider] Error stopping box:', e);
      }
      this.box = null;
    }
  }

  async shutdown(): Promise<void> {
    return this.stop();
  }

  getCapabilities(): SandboxCapabilities {
    return {
      supportsVolumeMounts: true,
      supportsNetworking: true,
      isolation: 'vm',
      supportedRuntimes: ['node', 'python', 'bun'],
      supportsPooling: true,
    };
  }

  setVolumes(volumes: VolumeMount[]): void {
    this.volumes = volumes;
  }
}

/**
 * Factory function for BoxLiteProvider
 */
export function createBoxLiteProvider(config?: {
  config?: BoxLiteProviderConfig['config'];
}): BoxLiteProvider {
  const provider = new BoxLiteProvider();
  if (config?.config) {
    provider.init(config.config);
  }
  return provider;
}

/**
 * Check if BoxLite is available on this platform
 */
export async function isBoxLiteAvailable(): Promise<boolean> {
  return loadBoxLite();
}

/**
 * BoxLite provider plugin definition
 */
export const boxlitePlugin: SandboxPlugin = defineSandboxPlugin({
  metadata: BOXLITE_METADATA,
  factory: (config) =>
    createBoxLiteProvider(config ? { config: config.config } : undefined),
});
