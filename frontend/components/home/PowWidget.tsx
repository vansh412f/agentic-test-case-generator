import { useEffect } from 'react';

interface PowWidgetProps {
  challengeUrl?: string;
  onPayload: (payload: string | null) => void;
}

interface AltchaChallenge {
  algorithm: string;
  challenge: string;
  maxnumber: number;
  salt: string;
  signature: string;
}

function bufToHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

async function solveChallenge(ch: AltchaChallenge): Promise<string> {
  const { algorithm, challenge, maxnumber, salt, signature } = ch;
  const max = maxnumber || 50000;
  const encoder = new TextEncoder();

  for (let num = 0; num <= max; num++) {
    const text = salt + num;
    const buf = encoder.encode(text);
    const hashBuf = await crypto.subtle.digest('SHA-256', buf);
    const hashHex = bufToHex(hashBuf);

    if (hashHex === challenge) {
      const payloadObj = {
        algorithm,
        challenge,
        number: num,
        salt,
        signature,
      };
      return btoa(JSON.stringify(payloadObj));
    }
  }

  throw new Error('No PoW solution found within maxnumber');
}

export function PowWidget({
  challengeUrl = '/api/pow/challenge',
  onPayload,
}: PowWidgetProps) {
  useEffect(() => {
    let unmounted = false;

    async function run() {
      try {
        const resp = await fetch(challengeUrl);
        if (!resp.ok) {
          throw new Error(`Failed to fetch PoW challenge: ${resp.status}`);
        }
        const challengeData: AltchaChallenge = await resp.json();
        const payload = await solveChallenge(challengeData);

        if (!unmounted) {
          onPayload(payload);
        }
      } catch (err) {
        if (!unmounted) {
          console.warn('PoW verification failed:', err);
          onPayload(null);
        }
      }
    }

    void run();

    return () => {
      unmounted = true;
    };
  }, [challengeUrl, onPayload]);

  return null;
}

export default PowWidget;
