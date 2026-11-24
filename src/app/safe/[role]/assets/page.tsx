import { notFound } from 'next/navigation';
import { getSafeByRole, isSafeRole } from '@/lib/safe/config';
import { SafeAssetsPanel } from '@/components/safe/SafeAssetsPanel';

type PageProps = {
  params: Promise<{ role: string }>;
};

export default async function SafeAssetsPage({ params }: PageProps) {
  const { role } = await params;
  if (!isSafeRole(role)) notFound();

  return <SafeAssetsPanel account={getSafeByRole(role)} />;
}
