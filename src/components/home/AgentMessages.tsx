import type { AgentMessage } from '@/shared/hooks/useAgent';
import { useLanguage } from '@/shared/providers/language-provider';
import {
  AlertCircle,
  CheckCircle,
  FileText,
  Globe,
  Search,
  Terminal,
} from 'lucide-react';

interface AgentMessagesProps {
  messages: AgentMessage[];
  isRunning: boolean;
}

function getToolIcon(toolName: string) {
  switch (toolName) {
    case 'Bash':
      return <Terminal className="size-4" />;
    case 'Read':
    case 'Edit':
    case 'Write':
      return <FileText className="size-4" />;
    case 'Glob':
    case 'Grep':
      return <Search className="size-4" />;
    case 'WebSearch':
      return <Globe className="size-4" />;
    default:
      return <Terminal className="size-4" />;
  }
}

export function AgentMessages({ messages, isRunning }: AgentMessagesProps) {
  const { t } = useLanguage();

  if (messages.length === 0 && !isRunning) {
    return null;
  }

  return (
    <div className="mt-6 w-full max-w-3xl space-y-3">
      {messages.map((message, index) => (
        <div
          key={index}
          className="animate-in fade-in slide-in-from-bottom-2 duration-300"
        >
          {message.type === 'text' && message.content && (
            <div className="bg-card text-card-foreground rounded-lg p-4 text-sm whitespace-pre-wrap">
              {message.content}
            </div>
          )}

          {message.type === 'tool_use' && (
            <div className="bg-muted text-muted-foreground flex items-center gap-2 rounded-lg p-3 text-sm">
              {getToolIcon(message.name || '')}
              <span className="font-medium">{message.name}</span>
              {message.input !== undefined && message.input !== null && (
                <span className="max-w-md truncate text-xs opacity-70">
                  {typeof message.input === 'string'
                    ? message.input
                    : JSON.stringify(
                        message.input as Record<string, unknown>
                      ).slice(0, 100)}
                </span>
              )}
            </div>
          )}

          {message.type === 'result' && (
            <div className="flex items-center gap-2 rounded-lg bg-green-50 p-3 text-sm text-green-700 dark:bg-green-950 dark:text-green-300">
              <CheckCircle className="size-4" />
              <span>
                完成 ({message.subtype})
                {message.cost && ` · $${message.cost.toFixed(4)}`}
                {message.duration &&
                  ` · ${(message.duration / 1000).toFixed(1)}s`}
              </span>
            </div>
          )}

          {message.type === 'error' && (
            <div className="flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
              <AlertCircle className="size-4" />
              <span>{message.message}</span>
            </div>
          )}
        </div>
      ))}

      {isRunning && (
        <div className="text-muted-foreground flex items-center gap-2 text-sm">
          <div className="bg-primary size-2 animate-pulse rounded-full" />
          <span>{t.task.thinking}</span>
        </div>
      )}
    </div>
  );
}
