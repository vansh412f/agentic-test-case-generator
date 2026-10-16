import { Braces, History, Home } from 'lucide-react';
import Link from 'next/link';
import { ThemeToggle } from './ThemeToggle';

export function Header() {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur">
      <div className="mx-auto flex min-h-16 w-full max-w-shell items-center justify-between gap-gutter px-gutter">
        <Link
          aria-label="Autonomous Test Suite Generator home"
          className="flex min-h-11 items-center gap-3 rounded-control"
          href="/"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-control bg-brand font-mono text-small font-bold text-brand-foreground">
            &gt;_
          </span>
          <span className="hidden max-w-56 leading-tight sm:block">
            <span className="block font-bold">Autonomous Test Suite</span>
            <span className="block text-caption text-muted-foreground">
              Generator
            </span>
          </span>
        </Link>

        <nav aria-label="Primary" className="flex items-center gap-2">
          <Link
            className="inline-flex min-h-11 items-center gap-2 rounded-control px-3 text-small font-medium transition-colors hover:bg-muted focus-visible:outline-none"
            href="/"
          >
            <Home aria-hidden="true" className="h-4 w-4" />
            <span className="hidden sm:inline">Generate</span>
          </Link>

          <Link
            className="inline-flex min-h-11 items-center gap-2 rounded-control px-3 text-small font-medium transition-colors hover:bg-muted focus-visible:outline-none"
            href="/jobs"
          >
            <History aria-hidden="true" className="h-4 w-4" />
            <span className="hidden sm:inline">Test History</span>
          </Link>

          <span className="hidden items-center gap-2 rounded-full border px-3 py-2 font-mono text-caption text-muted-foreground md:inline-flex">
            <Braces aria-hidden="true" className="h-4 w-4 text-brand" />
            Playwright
          </span>

          <ThemeToggle />
        </nav>
      </div>
    </header>
  );
}
