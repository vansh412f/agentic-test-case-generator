import { useEffect, useRef } from 'react';

interface PowWidgetProps {
  challengeUrl?: string;
  onPayload: (payload: string | null) => void;
}

export function PowWidget({
  challengeUrl = '/api/pow/challenge',
  onPayload,
}: PowWidgetProps) {
  const widgetRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    // Dynamically load the altcha custom element on client
    import('altcha').catch(() => {});
  }, []);

  useEffect(() => {
    const el = widgetRef.current;
    if (!el) return;

    const handleStateChange = (ev: Event) => {
      const custom = ev as CustomEvent<{ state?: string; payload?: string }>;
      if (custom.detail?.state === 'verified' && custom.detail?.payload) {
        onPayload(custom.detail.payload);
      } else if (
        custom.detail?.state === 'error' ||
        custom.detail?.state === 'expired'
      ) {
        onPayload(null);
      }
    };

    el.addEventListener('statechange', handleStateChange);
    return () => {
      el.removeEventListener('statechange', handleStateChange);
    };
  }, [onPayload]);

  return (
    <div style={{ display: 'none' }} aria-hidden="true">
      <altcha-widget
        ref={widgetRef}
        challengeurl={challengeUrl}
        auto="onload"
        hidefooter="true"
        hidelogo="true"
      />
    </div>
  );
}

export default PowWidget;
