import { AlertTriangle, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ErrorStateProps {
  title: string;
  description: string;
  onRetry: () => void;
}

export function ErrorState({ title, description, onRetry }: ErrorStateProps) {
  return (
    <section className="panel mx-auto my-section-sm max-w-reading p-8 text-center" role="alert">
      <AlertTriangle aria-hidden="true" className="mx-auto h-10 w-10 text-danger" />
      <h2 className="mt-4 text-heading-2 font-bold">{title}</h2>
      <p className="mt-3 text-body text-muted-foreground">{description}</p>
      <Button className="mt-6" onClick={onRetry} size="lg" type="button">
        <RotateCcw aria-hidden="true" />
        Retry Request
      </Button>
    </section>
  );
}
