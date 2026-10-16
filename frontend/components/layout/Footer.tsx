import Link from 'next/link';

export function Footer() {
  return (
    <footer className="border-t">
      <div className="mx-auto flex w-full max-w-shell flex-col gap-4 px-gutter py-8 text-small text-muted-foreground md:flex-row md:items-center md:justify-between">
        <p>
          Agentic Test Case Generator — crawl, plan, generate, execute,
          and self-correct.
        </p>

        <nav aria-label="Footer" className="flex flex-wrap gap-5">
          <Link className="rounded-control hover:text-foreground" href="/">
            Generate tests
          </Link>
          <Link className="rounded-control hover:text-foreground" href="/jobs">
            Test history
          </Link>
          <Link className="rounded-control hover:text-foreground" href="/privacy">
            Privacy policy
          </Link>
        </nav>
      </div>
    </footer>
  );
}
