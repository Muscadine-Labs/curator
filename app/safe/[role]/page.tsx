import { notFound } from 'next/navigation';
import { getSafeByRole, isSafeRole } from '@/lib/safe/config';
import { SafeRoleHeader, SafeOverviewPanel } from '@/components/safe/SafeOverviewPanel';
import { SafeTransactionQueue } from '@/components/safe/SafeTransactionQueue';

type PageProps = {
  params: Promise<{ role: string }>;
};

export default async function SafeRolePage({ params }: PageProps) {
  const { role } = await params;
  if (!isSafeRole(role)) notFound();

  const account = getSafeByRole(role);

  return (
    <div className="space-y-6">
      <SafeRoleHeader account={account} />
      <SafeOverviewPanel account={account} />
      <SafeTransactionQueue account={account} />
    </div>
  );
}

export function generateStaticParams() {
  return [
    { role: 'owner' },
    { role: 'curator' },
    { role: 'allocator' },
    { role: 'sentinel' },
    { role: 'treasury' },
  ];
}
