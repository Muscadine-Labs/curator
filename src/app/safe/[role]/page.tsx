import { notFound } from 'next/navigation';
import { getSafeByRole, isSafeRole } from '@/lib/safe/config';
import { SafeOverviewPanel } from '@/components/safe/SafeOverviewPanel';

type PageProps = {
  params: Promise<{ role: string }>;
};

export default async function SafeRolePage({ params }: PageProps) {
  const { role } = await params;
  if (!isSafeRole(role)) notFound();

  return <SafeOverviewPanel account={getSafeByRole(role)} />;
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
