import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4">
      <div className="text-center">
        <h1 className="text-6xl font-bold text-slate-900">404</h1>
        <h2 className="mt-4 text-2xl font-semibold text-slate-700">Page Not Found</h2>
        <p className="mt-2 text-slate-500 dark:text-slate-400">
          The page you&apos;re looking for doesn&apos;t exist.
        </p>
        <div className="mt-6">
          <Button asChild>
            <Link href="/">Go Home</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

