import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

export interface PowWidgetRef {
  getPayload(): string | null;
}

interface PowWidgetProps {
  challengeUrl?: string;
}

export const PowWidget = forwardRef<PowWidgetRef, PowWidgetProps>(function PowWidget(
  { challengeUrl = '/api/pow/challenge' },
  ref,
) {
  const widgetRef = useRef<HTMLElement | null>(null);
  const payloadRef = useRef<string | null>(null);

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
        payloadRef.current = custom.detail.payload;
      }
    };

    el.addEventListener('statechange', handleStateChange);
    return () => {
      el.removeEventListener('statechange', handleStateChange);
    };
  }, []);

  useImperativeHandle(ref, () => ({
    getPayload(): string | null {
      if (payloadRef.current) return payloadRef.current;
      if (!widgetRef.current) return null;
      const input = widgetRef.current.querySelector<HTMLInputElement>('input[name="altcha"]');
      if (input?.value) return input.value;
      const anyWidget = widgetRef.current as unknown as { value?: string; getPayload?: () => string };
      if (typeof anyWidget.getPayload === 'function') {
        const p = anyWidget.getPayload();
        if (p) return p;
      }
      if (anyWidget.value) return anyWidget.value;
      return null;
    },
  }));

  return (
    <div style={{ display: 'none' }} aria-hidden="true">
      <altcha-widget
        ref={widgetRef}
        challengeurl={challengeUrl}
        challenge={challengeUrl}
        auto="onload"
        hidefooter="true"
        hidelogo="true"
      />
    </div>
  );
});

export default PowWidget;
