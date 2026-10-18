import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { JobStatus } from '@/types/api';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function isTerminalJobStatus(status: JobStatus): boolean {
  return status === 'completed' || status === 'failed';
}

export function formatDateTime(value: string | null): string {
  if (value === null) return '—';

  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(new Date(value));
}

export function formatTime(value: string): string {
  return new Intl.DateTimeFormat('en', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value));
}

export function formatDurationMs(value: number | null): string {
  if (value === null) return '—';
  if (value < 1000) return `${value} ms`;

  const seconds = value / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)} s`;

  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return `${minutes}m ${remainder}s`;
}

export function formatJobDuration(
  startedAt: string | null,
  completedAt: string | null,
): string {
  if (startedAt === null || completedAt === null) return '—';

  return formatDurationMs(
    new Date(completedAt).getTime() - new Date(startedAt).getTime(),
  );
}

export function truncateMiddle(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;

  const side = Math.floor((maxLength - 1) / 2);
  return `${value.slice(0, side)}…${value.slice(-side)}`;
}

// 6 hex chars collide eventually; it is a display label, the UUID remains identity.
export function formatJobShortId(id: string): string {
  return `#${id.replace(/-/g, '').slice(0, 6).toUpperCase()}`;
}
