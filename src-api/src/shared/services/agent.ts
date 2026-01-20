/**
 * Agent Service
 *
 * This service provides the main interface for running AI agents.
 * It uses the agents abstraction layer to support multiple providers.
 */

import {
  createAgent,
  createAgentFromEnv,
  type AgentConfig,
  type AgentMessage,
  type AgentSession,
  type ConversationMessage,
  type IAgent,
  type ImageAttachment,
  type SandboxConfig,
  type TaskPlan,
} from '@/core/agent';

// Global agent instance (lazy initialized)
let globalAgent: IAgent | null = null;

// Store active sessions for backward compatibility
const activeSessions = new Map<string, { abortController: AbortController }>();

/**
 * Get or create the global agent instance
 * If modelConfig is provided, creates a new agent with those settings
 */
export function getAgent(config?: Partial<AgentConfig>): IAgent {
  // If config with API credentials is provided, create a new agent instance
  // Don't cache it to allow different configs per request
  if (config && (config.apiKey || config.baseUrl || config.model)) {
    return createAgent({ provider: 'claude', ...config });
  }

  // Use cached global agent for default configuration
  if (!globalAgent || config) {
    globalAgent = config
      ? createAgent({ provider: 'claude', ...config })
      : createAgentFromEnv();
  }
  return globalAgent;
}

/**
 * Create a new agent session
 */
export function createSession(
  phase: 'plan' | 'execute' = 'plan'
): AgentSession {
  const session: AgentSession = {
    id: Date.now().toString(),
    createdAt: new Date(),
    phase: phase === 'plan' ? 'planning' : 'executing',
    isAborted: false,
    abortController: new AbortController(),
  };
  activeSessions.set(session.id, {
    abortController: session.abortController,
  });
  return session;
}

/**
 * Get an existing session
 */
export function getSession(sessionId: string): AgentSession | undefined {
  const session = activeSessions.get(sessionId);
  if (!session) return undefined;

  return {
    id: sessionId,
    createdAt: new Date(),
    phase: 'idle',
    isAborted: session.abortController.signal.aborted,
    abortController: session.abortController,
  };
}

/**
 * Delete a session
 */
export function deleteSession(sessionId: string): boolean {
  const session = activeSessions.get(sessionId);
  if (session) {
    session.abortController.abort();
    activeSessions.delete(sessionId);
    return true;
  }
  return false;
}

/**
 * Get a stored plan
 */
export function getPlan(planId: string): TaskPlan | undefined {
  return getAgent().getPlan(planId);
}

/**
 * Save a plan (for backward compatibility)
 */
export function savePlan(_plan: TaskPlan): void {
  // Plans are stored internally by the agent
  // This is a no-op as the agent manages its own plans
}

/**
 * Delete a plan
 */
export function deletePlan(planId: string): boolean {
  getAgent().deletePlan(planId);
  return true;
}

/**
 * Run the planning phase
 */
export async function* runPlanningPhase(
  prompt: string,
  session: AgentSession,
  modelConfig?: { apiKey?: string; baseUrl?: string; model?: string }
): AsyncGenerator<AgentMessage> {
  const agent = getAgent(modelConfig);

  for await (const message of agent.plan(prompt, {
    sessionId: session.id,
    abortController: session.abortController,
  })) {
    yield message;
  }
}

/**
 * Run the execution phase
 */
export async function* runExecutionPhase(
  planId: string,
  session: AgentSession,
  originalPrompt: string,
  workDir?: string,
  taskId?: string,
  modelConfig?: { apiKey?: string; baseUrl?: string; model?: string },
  sandboxConfig?: SandboxConfig
): AsyncGenerator<AgentMessage> {
  const agent = getAgent(modelConfig);

  for await (const message of agent.execute({
    planId,
    originalPrompt,
    sessionId: session.id,
    cwd: workDir,
    taskId,
    abortController: session.abortController,
    sandbox: sandboxConfig,
  })) {
    yield message;
  }
}

/**
 * Run agent directly (without planning phase)
 */
export async function* runAgent(
  prompt: string,
  session: AgentSession,
  conversation?: ConversationMessage[],
  workDir?: string,
  taskId?: string,
  modelConfig?: { apiKey?: string; baseUrl?: string; model?: string },
  sandboxConfig?: SandboxConfig,
  images?: ImageAttachment[]
): AsyncGenerator<AgentMessage> {
  const agent = getAgent(modelConfig);

  for await (const message of agent.run(prompt, {
    sessionId: session.id,
    conversation,
    cwd: workDir,
    taskId,
    abortController: session.abortController,
    sandbox: sandboxConfig,
    images,
  })) {
    yield message;
  }
}

/**
 * Stop an agent execution
 */
export function stopAgent(sessionId: string): void {
  const session = activeSessions.get(sessionId);
  if (session) {
    session.abortController.abort();
  }
}

// Re-export types for convenience
export type {
  AgentMessage,
  AgentSession,
  TaskPlan,
  ConversationMessage,
  AgentConfig,
  IAgent,
  ImageAttachment,
};
