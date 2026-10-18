import { Clock, Key, X } from '@phosphor-icons/react';

interface QuotaExhaustedPanelProps {
  limit?: number;
  resetsAt?: string;
  scope?: string;
  onDismiss?: () => void;
  onOpenKeys?: () => void;
}

export function QuotaExhaustedPanel({
  limit = 8,
  resetsAt,
  scope = 'visitor',
  onDismiss,
  onOpenKeys,
}: QuotaExhaustedPanelProps) {
  const formattedReset = resetsAt
    ? `at ${new Date(resetsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    : 'tomorrow';

  const heading =
    scope === 'visitor'
      ? `You’ve used all ${limit} free runs for today`
      : scope === 'ip'
      ? `This network has used all ${limit} free runs for today`
      : "Today's free demo capacity is used up";

  const handleOpenByok = () => {
    if (onOpenKeys) {
      onOpenKeys();
    } else if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('open-byok-modal'));
    }
  };

  return (
    <section aria-labelledby="quota-panel-title" className="quota-panel relative">
      {onDismiss ? (
        <button
          aria-label="Dismiss quota notice"
          className="absolute right-4 top-4 rounded p-1 text-[#8b6420] hover:bg-[#fff0cc]"
          onClick={onDismiss}
          type="button"
        >
          <X aria-hidden="true" className="h-4 w-4" />
        </button>
      ) : null}

      <div className="state-icon">
        <Clock aria-hidden="true" className="h-6 w-6" />
      </div>

      <div className="state-copy">
        <p className="eyebrow">Daily limit reached</p>
        <h3 id="quota-panel-title">{heading}</h3>
        <p>
          Resets {formattedReset}. Add your own free Groq key for unlimited runs.
        </p>
        <button className="primary-button" onClick={handleOpenByok} type="button">
          <Key aria-hidden="true" className="h-4 w-4" /> Add API key
        </button>
      </div>
    </section>
  );
}
