import { FileSearch } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

interface EmptyStateProps {
  title: string;
  description: string;
  actionLabel: string;
  actionHref: string;
}

export function EmptyState({
  title,
  description,
  actionLabel,
  actionHref,
}: EmptyStateProps) {
  return (
    <section className="panel mx-auto my-section-sm max-w-reading p-8 text-center">
      <FileSearch aria-hidden="true" className="mx-auto h-10 w-10 text-muted-foreground" />
      <h2 className="mt-4 text-heading-2 font-bold">{title}</h2>
      <p className="mt-3 text-body text-muted-foreground">{description}</p>
      <Button asChild className="mt-6" size="lg">
        <Link href={actionHref}>{actionLabel}</Link>
      </Button>
    </section>
  );
}
