import { notFound } from 'next/navigation';
import { getSafeByRole, isSafeRole } from '@/lib/safe/config';
import { SafeTransactionQueue } from '@/components/safe/SafeTransactionQueue';

type PageProps = {
  params: Promise<{ role: string }>;
};

export default async function SafeTransactionsPage({ params }: PageProps) {
  const { role } = await params;
  if (!isSafeRole(role)) notFound();

  return <SafeTransactionQueue account={getSafeByRole(role)} />;
}
