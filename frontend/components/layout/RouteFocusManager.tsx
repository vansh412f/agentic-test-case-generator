import { useRouter } from 'next/router';
import { useEffect } from 'react';

export function RouteFocusManager() {
  const router = useRouter();

  useEffect(() => {
    function handleRouteChange(): void {
      const main = document.getElementById('main-content');
      if (main === null) return;

      main.setAttribute('tabindex', '-1');
      main.focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: 'auto' });
    }

    router.events.on('routeChangeComplete', handleRouteChange);
    return () => {
      router.events.off('routeChangeComplete', handleRouteChange);
    };
  }, [router.events]);

  return null;
}
