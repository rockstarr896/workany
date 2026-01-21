/**
 * Provider Management API Routes
 *
 * Provides REST endpoints for managing sandbox and agent providers.
 */

import { Hono } from 'hono';

import { getAgentRegistry } from '@/core/agent/registry';
import { getSandboxRegistry } from '@/core/sandbox/registry';
import { getConfigLoader } from '@/config/loader';
import { getProviderManager } from '@/shared/provider/manager';

const providersRoutes = new Hono();

// ============================================================================
// Sandbox Provider Routes
// ============================================================================

/**
 * GET /providers/sandbox
 * List all sandbox providers with their metadata
 */
providersRoutes.get('/sandbox', async (c) => {
  try {
    const registry = getSandboxRegistry();
    const metadata = registry.getAllSandboxMetadata();
    const available = await registry.getAvailable();
    const current = getProviderManager().getConfig().sandbox;

    return c.json({
      providers: metadata.map((m) => ({
        ...m,
        available: available.includes(m.type),
        current: current?.type === m.type,
      })),
      current: current?.type || null,
    });
  } catch (error) {
    console.error('[ProvidersAPI] Error listing sandbox providers:', error);
    return c.json({ error: 'Failed to list sandbox providers' }, 500);
  }
});

/**
 * GET /providers/sandbox/available
 * List available sandbox providers (those that can actually run on this system)
 */
providersRoutes.get('/sandbox/available', async (c) => {
  try {
    const registry = getSandboxRegistry();
    const available = await registry.getAvailable();

    return c.json({ available });
  } catch (error) {
    console.error(
      '[ProvidersAPI] Error getting available sandbox providers:',
      error
    );
    return c.json({ error: 'Failed to get available sandbox providers' }, 500);
  }
});

/**
 * GET /providers/sandbox/:type
 * Get details about a specific sandbox provider
 */
providersRoutes.get('/sandbox/:type', async (c) => {
  try {
    const type = c.req.param('type');
    const registry = getSandboxRegistry();
    const metadata = registry.getSandboxMetadata(type);

    if (!metadata) {
      return c.json({ error: `Sandbox provider not found: ${type}` }, 404);
    }

    const available = await registry.getAvailable();
    const current = getProviderManager().getConfig().sandbox;

    return c.json({
      ...metadata,
      available: available.includes(type),
      current: current?.type === type,
    });
  } catch (error) {
    console.error('[ProvidersAPI] Error getting sandbox provider:', error);
    return c.json({ error: 'Failed to get sandbox provider details' }, 500);
  }
});

/**
 * POST /providers/sandbox/switch
 * Switch to a different sandbox provider
 */
providersRoutes.post('/sandbox/switch', async (c) => {
  try {
    const body = await c.req.json<{
      type: string;
      config?: Record<string, unknown>;
    }>();

    if (!body.type) {
      return c.json({ error: 'Provider type is required' }, 400);
    }

    const manager = getProviderManager();
    await manager.switchSandboxProvider(body.type, body.config);

    // Update config loader
    getConfigLoader().updateFromSettings({
      sandboxProvider: body.type,
      sandboxConfig: body.config,
    });

    return c.json({
      success: true,
      current: body.type,
      message: `Switched to sandbox provider: ${body.type}`,
    });
  } catch (error) {
    console.error('[ProvidersAPI] Error switching sandbox provider:', error);
    return c.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Failed to switch sandbox provider',
      },
      500
    );
  }
});

// ============================================================================
// Agent Provider Routes
// ============================================================================

/**
 * GET /providers/agents
 * List all agent providers with their metadata
 */
providersRoutes.get('/agents', async (c) => {
  try {
    const registry = getAgentRegistry();
    const metadata = registry.getAllAgentMetadata();
    const available = await registry.getAvailable();
    const current = getProviderManager().getConfig().agent;

    return c.json({
      providers: metadata.map((m) => ({
        ...m,
        available: available.includes(m.type),
        current: current?.type === m.type,
      })),
      current: current?.type || null,
    });
  } catch (error) {
    console.error('[ProvidersAPI] Error listing agent providers:', error);
    return c.json({ error: 'Failed to list agent providers' }, 500);
  }
});

/**
 * GET /providers/agents/available
 * List available agent providers
 */
providersRoutes.get('/agents/available', async (c) => {
  try {
    const registry = getAgentRegistry();
    const available = await registry.getAvailable();

    return c.json({ available });
  } catch (error) {
    console.error(
      '[ProvidersAPI] Error getting available agent providers:',
      error
    );
    return c.json({ error: 'Failed to get available agent providers' }, 500);
  }
});

/**
 * GET /providers/agents/:type
 * Get details about a specific agent provider
 */
providersRoutes.get('/agents/:type', async (c) => {
  try {
    const type = c.req.param('type');
    const registry = getAgentRegistry();
    const metadata = registry.getAgentMetadata(type);

    if (!metadata) {
      return c.json({ error: `Agent provider not found: ${type}` }, 404);
    }

    const available = await registry.getAvailable();
    const current = getProviderManager().getConfig().agent;

    return c.json({
      ...metadata,
      available: available.includes(type),
      current: current?.type === type,
    });
  } catch (error) {
    console.error('[ProvidersAPI] Error getting agent provider:', error);
    return c.json({ error: 'Failed to get agent provider details' }, 500);
  }
});

/**
 * POST /providers/agents/switch
 * Switch to a different agent provider
 */
providersRoutes.post('/agents/switch', async (c) => {
  try {
    const body = await c.req.json<{
      type: string;
      config?: Record<string, unknown>;
    }>();

    if (!body.type) {
      return c.json({ error: 'Provider type is required' }, 400);
    }

    const manager = getProviderManager();
    await manager.switchAgentProvider(body.type, body.config);

    // Update config loader
    getConfigLoader().updateFromSettings({
      agentProvider: body.type,
      agentConfig: body.config,
    });

    return c.json({
      success: true,
      current: body.type,
      message: `Switched to agent provider: ${body.type}`,
    });
  } catch (error) {
    console.error('[ProvidersAPI] Error switching agent provider:', error);
    return c.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Failed to switch agent provider',
      },
      500
    );
  }
});

// ============================================================================
// Settings Sync Route
// ============================================================================

/**
 * POST /providers/settings/sync
 * Sync frontend settings with the backend
 */
providersRoutes.post('/settings/sync', async (c) => {
  try {
    const body = await c.req.json<{
      sandboxProvider?: string;
      sandboxConfig?: Record<string, unknown>;
      agentProvider?: string;
      agentConfig?: Record<string, unknown>;
      // AI Provider model configuration
      defaultProvider?: string;
      defaultModel?: string;
    }>();

    const manager = getProviderManager();
    const configLoader = getConfigLoader();

    // Update sandbox provider if specified
    if (body.sandboxProvider) {
      await manager.switchSandboxProvider(
        body.sandboxProvider,
        body.sandboxConfig
      );
    }

    // Update agent provider if specified
    // The agentConfig now includes apiKey, baseUrl, and model from the selected AI provider
    if (body.agentProvider) {
      await manager.switchAgentProvider(body.agentProvider, body.agentConfig);
    }

    // Update config loader with full settings including model info
    configLoader.updateFromSettings({
      ...body,
      agentConfig: body.agentConfig,
    });

    console.log('[ProvidersAPI] Settings synced:', {
      agentProvider: body.agentProvider,
      defaultProvider: body.defaultProvider,
      defaultModel: body.defaultModel,
      hasApiKey: !!body.agentConfig?.apiKey,
      hasBaseUrl: !!body.agentConfig?.baseUrl,
    });

    return c.json({
      success: true,
      config: manager.getConfig(),
    });
  } catch (error) {
    console.error('[ProvidersAPI] Error syncing settings:', error);
    return c.json(
      {
        error:
          error instanceof Error ? error.message : 'Failed to sync settings',
      },
      500
    );
  }
});

/**
 * GET /providers/config
 * Get current provider configuration
 */
providersRoutes.get('/config', (c) => {
  try {
    const manager = getProviderManager();
    return c.json(manager.getConfig());
  } catch (error) {
    console.error('[ProvidersAPI] Error getting config:', error);
    return c.json({ error: 'Failed to get configuration' }, 500);
  }
});

export { providersRoutes };
