import Link from 'next/link';
import { Sparkle } from '@phosphor-icons/react';

export function Footer() {
  return (
    <footer className="reference-footer">
      <Link className="brand" href="/">
        <span className="logo-mark">
          <Sparkle aria-hidden="true" className="h-3.5 w-3.5" weight="fill" />
        </span>
        <span>
          Agentic<span>Test</span>
        </span>
      </Link>
      <p>Playwright tests that fix themselves, not your expectations.</p>
      <div>
        <Link href="/#how-it-works">Documentation</Link>
        <Link href="/privacy">Privacy</Link>
        <a
          href="https://github.com/vansh412f/agentic-test-case-generator"
          rel="noreferrer"
          target="_blank"
        >
          GitHub
        </a>
      </div>
      <small>© 2025 Agentic Test</small>
    </footer>
  );
}

export default Footer;
