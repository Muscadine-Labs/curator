import { notFound } from 'next/navigation';
import { getSafeByRole, isSafeRole } from '@/lib/safe/config';
import { SafeHistoryPanel } from '@/components/safe/SafeHistoryPanel';

type PageProps = {
  params: Promise<{ role: string }>;
};

export default async function SafeHistoryPage({ params }: PageProps) {
  const { role } = await params;
  if (!isSafeRole(role)) notFound();
  return <SafeHistoryPanel account={getSafeByRole(role)} />;
}
