import { notFound } from 'next/navigation';
import { getSafeByRole, isSafeRole } from '@/lib/safe/config';
import { SafeSettingsPanel } from '@/components/safe/SafeSettingsPanel';

type PageProps = {
  params: Promise<{ role: string }>;
};

export default async function SafeSettingsPage({ params }: PageProps) {
  const { role } = await params;
  if (!isSafeRole(role)) notFound();
  return <SafeSettingsPanel account={getSafeByRole(role)} />;
}
