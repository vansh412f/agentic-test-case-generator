import { useState } from 'react';
import { Check, ShareNetwork } from '@phosphor-icons/react';
import { toast } from 'sonner';

interface ShareButtonProps {
  jobId: string;
  targetUrl: string;
}

export function ShareButton({ jobId, targetUrl }: ShareButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleShare = async () => {
    if (typeof window === 'undefined') return;
    const url = `${window.location.origin}/jobs/${jobId}?share=1`;
    const title = `Playwright tests for ${targetUrl}`;

    if (
      typeof navigator.share === 'function' &&
      window.matchMedia('(pointer: coarse)').matches
    ) {
      try {
        await navigator.share({ title, url });
        return;
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
      }
    }

    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success('Share link copied');
      window.setTimeout(() => setCopied(false), 2000);
    } catch (_err) {
      toast.error('Failed to copy share link');
    }
  };

  return (
    <button
      className="secondary-button"
      onClick={handleShare}
      type="button"
      title="Share test run"
    >
      {copied ? (
        <>
          <Check aria-hidden="true" className="h-4 w-4" />
          <span>Copied</span>
        </>
      ) : (
        <>
          <ShareNetwork aria-hidden="true" className="h-4 w-4" />
          <span>Share</span>
        </>
      )}
    </button>
  );
}
