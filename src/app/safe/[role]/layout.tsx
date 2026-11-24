import { notFound } from 'next/navigation';
import { getSafeByRole, isSafeRole } from '@/lib/safe/config';
import { SafeAccountHeader } from '@/components/safe/SafeAccountHeader';
import { SafeRoleSubnav } from '@/components/safe/SafeRoleSubnav';

type LayoutProps = {
  children: React.ReactNode;
  params: Promise<{ role: string }>;
};

export default async function SafeRoleLayout({ children, params }: LayoutProps) {
  const { role } = await params;
  if (!isSafeRole(role)) notFound();

  const account = getSafeByRole(role);

  return (
    <div className="space-y-5">
      <SafeAccountHeader account={account} />
      <SafeRoleSubnav role={role} />
      {children}
    </div>
  );
}
