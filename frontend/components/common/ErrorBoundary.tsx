import { AlertTriangle, RotateCcw } from 'lucide-react';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = {
    error: null,
  };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    if (process.env.NODE_ENV !== 'production') {
      console.error(error, info);
    }
  }

  render(): ReactNode {
    if (this.state.error !== null) {
      return (
        <section className="panel mx-auto my-section-sm max-w-reading p-6 text-center">
          <AlertTriangle aria-hidden="true" className="mx-auto h-10 w-10 text-danger" />
          <h1 className="mt-4 text-heading-2 font-bold">
            This job view could not be rendered
          </h1>
          <p className="mt-3 text-body text-muted-foreground">
            The job data may still be available from the backend. Reload this
            view or return to the job history.
          </p>
          <Button
            className="mt-6"
            onClick={() => this.setState({ error: null })}
            type="button"
          >
            <RotateCcw aria-hidden="true" />
            Retry Rendering
          </Button>
        </section>
      );
    }

    return this.props.children;
  }
}
