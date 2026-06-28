import { redirect } from 'next/navigation';

export default function SafeIndexPage() {
  redirect('/safe/allocator');
}
