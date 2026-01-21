import { FolderOpen } from 'lucide-react';
import { getAppDataDir } from '@/shared/lib/paths';
import { useLanguage } from '@/shared/providers/language-provider';
import type { WorkplaceSettingsProps } from '../types';

export function WorkplaceSettings({
  settings,
  onSettingsChange,
  defaultPaths,
}: WorkplaceSettingsProps) {
  const { t } = useLanguage();

  return (
    <div className="space-y-6">
      <div>
        <p className="text-muted-foreground text-sm">
          {t.settings.workplaceDescription}
        </p>
      </div>

      {/* Working Directory */}
      <div className="flex flex-col gap-2">
        <label className="text-foreground block text-sm font-medium">
          {t.settings.workingDirectory}
        </label>
        <p className="text-muted-foreground text-xs">
          {t.settings.workingDirectoryDescription}
        </p>
        <div className="flex items-center gap-2">
          <div className="relative max-w-md flex-1">
            <FolderOpen className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <input
              type="text"
              value={settings.workDir}
              onChange={(e) =>
                onSettingsChange({
                  ...settings,
                  workDir: e.target.value,
                })
              }
              placeholder={defaultPaths.workDir || 'Loading...'}
              className="border-input bg-background text-foreground placeholder:text-muted-foreground focus:ring-ring h-10 w-full rounded-lg border pr-3 pl-10 text-sm focus:border-transparent focus:ring-2 focus:outline-none"
            />
          </div>
          <button
            onClick={async () => {
              const workDir = await getAppDataDir();
              onSettingsChange({
                ...settings,
                workDir,
              });
            }}
            className="text-muted-foreground hover:text-foreground border-border hover:bg-accent h-10 cursor-pointer rounded-lg border px-3 text-sm transition-colors"
          >
            {t.common.reset}
          </button>
        </div>
        <p className="text-muted-foreground text-xs">
          {t.settings.directoryStructure.replace('{path}', settings.workDir)}
        </p>
      </div>
    </div>
  );
}
