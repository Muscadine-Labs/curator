'use client';

import type { ReactNode } from 'react';
import { VaultPageShell } from '@/components/morpho/VaultPageShell';

export default function VaultAddressLayout({ children }: { children: ReactNode }) {
  return <VaultPageShell>{children}</VaultPageShell>;
}
