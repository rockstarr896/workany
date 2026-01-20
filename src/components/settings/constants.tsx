import type { ComponentType } from 'react';
import type { SettingsCategory } from './types';
import {
  Cpu,
  FolderOpen,
  Info,
  Layers,
  Plug,
  Settings,
  User,
} from 'lucide-react';

// MCP icon component
export const McpIcon = ({ className }: { className?: string }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 2L2 7l10 5 10-5-10-5z" />
    <path d="M2 17l10 5 10-5" />
    <path d="M2 12l10 5 10-5" />
  </svg>
);

// Category icons mapping
export const categoryIcons: Record<
  SettingsCategory,
  ComponentType<{ className?: string }>
> = {
  account: User,
  general: Settings,
  workplace: FolderOpen,
  model: Cpu,
  mcp: McpIcon,
  skills: Layers,
  connector: Plug,
  about: Info,
};

// Provider icons mapping
export const providerIcons: Record<string, string> = {
  openrouter: '<',
  siliconflow: 'S',
  replicate: 'R',
  fal: 'F',
  openai: 'O',
  anthropic: 'A',
};

// Provider API Key settings URLs
export const providerApiKeyUrls: Record<string, string> = {
  openrouter: 'https://openrouter.ai/keys',
  siliconflow: 'https://cloud.siliconflow.cn/account/ak',
  replicate: 'https://replicate.com/account/api-tokens',
  fal: 'https://fal.ai/dashboard/keys',
  openai: 'https://platform.openai.com/api-keys',
  anthropic: 'https://console.anthropic.com/settings/keys',
};

// Default provider IDs that cannot be deleted
export const defaultProviderIds = [
  'openrouter',
  'siliconflow',
  'replicate',
  'fal',
  'openai',
  'anthropic',
];

// API base URL
export const API_PORT = import.meta.env.PROD ? 2620 : 2026;
export const API_BASE_URL = `http://localhost:${API_PORT}`;
