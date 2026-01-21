/**
 * Setup Guard Component
 *
 * Previously checked if the app setup (dependency installation) is completed.
 * Now directly allows access - environment checks happen during conversations as needed.
 */

import type { ReactNode } from 'react';

interface SetupGuardProps {
  children: ReactNode;
}

export function SetupGuard({ children }: SetupGuardProps) {
  // Skip environment check on first launch, directly enter the app
  // Environment checks will be prompted during conversations as needed
  return <>{children}</>;
}
