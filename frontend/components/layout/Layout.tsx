import type { ReactNode } from 'react';
import { Footer } from './Footer';
import { Header } from './Header';

interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <a
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-control focus:bg-brand focus:px-4 focus:py-2 focus:text-brand-foreground"
        href="#main-content"
      >
        Skip to main content
      </a>

      <Header />

      <main className="mx-auto w-full max-w-shell flex-1 px-gutter" id="main-content">
        {children}
      </main>

      <Footer />
    </div>
  );
}
