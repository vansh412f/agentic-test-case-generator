import type { ConfidenceScore } from '@/types/api';

interface ConfidenceMeterProps {
  confidence: ConfidenceScore;
}

const barClassByBand: Record<ConfidenceScore['band'], string> = {
  high: 'bg-success',
  medium: 'bg-warning',
  low: 'bg-danger',
};

const textClassByBand: Record<ConfidenceScore['band'], string> = {
  high: 'text-success',
  medium: 'text-warning',
  low: 'text-danger',
};

export function ConfidenceMeter({ confidence }: ConfidenceMeterProps) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-caption font-semibold uppercase tracking-wide text-muted-foreground">
          Confidence
        </p>
        <p className={`font-mono text-small font-bold ${textClassByBand[confidence.band]}`}>
          {confidence.score}/100 · {confidence.band}
        </p>
      </div>

      <div
        aria-label={`Confidence ${confidence.score} out of 100, ${confidence.band}`}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={confidence.score}
        className="mt-2 h-2 overflow-hidden rounded-full bg-muted"
        role="progressbar"
      >
        <div
          className={`h-full rounded-full ${barClassByBand[confidence.band]}`}
          style={{ width: `${confidence.score}%` }}
        />
      </div>

      <details className="mt-3">
        <summary className="cursor-pointer rounded-control text-caption font-medium text-muted-foreground hover:text-foreground">
          Why this score?
        </summary>
        <ul className="mt-2 space-y-1 font-mono text-caption text-muted-foreground">
          {confidence.factors.map((factor) => (
            <li className="flex justify-between gap-4" key={factor.label}>
              <span>{factor.label}</span>
              <span>
                {factor.points >= 0 ? '+' : ''}
                {factor.points}
              </span>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
