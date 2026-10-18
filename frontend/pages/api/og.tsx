import { ImageResponse } from 'next/og';
import type { NextRequest } from 'next/server';

export const config = { runtime: 'edge' };

const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:4000';
const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

interface OgJob {
  targetUrl: string;
  status: string;
  generatedTests: Array<{ finalStatus: string; executionResults: Array<{ corrected: boolean }> }>;
}

function isOgJob(value: unknown): value is OgJob {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.targetUrl === 'string' && typeof v.status === 'string' && Array.isArray(v.generatedTests);
}

function hostOf(url: string): string {
  try { const p = new URL(url); return p.host + (p.pathname === '/' ? '' : p.pathname); } catch { return url; }
}

async function loadJob(id: string): Promise<OgJob | null> {
  try {
    const response = await fetch(`${BACKEND_URL}/api/jobs/${id}`, {
      headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(4_000),
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    return isOgJob(body) ? body : null;
  } catch {
    return null;
  }
}

export default async function handler(req: NextRequest) {
  const id = new URL(req.url).searchParams.get('id') ?? '';
  const job = JOB_ID.test(id) ? await loadJob(id) : null;
  if (!job) return Response.redirect(new URL('/og-default.png', req.url), 302);

  const tests = job.generatedTests;
  const passed = tests.filter((t) => t.finalStatus === 'passed').length;
  const findings = tests.filter((t) => t.finalStatus === 'failed').length;
  const corrected = tests.filter((t) => t.executionResults.some((r) => r.corrected)).length;
  const terminal = TERMINAL.has(job.status);
  const headline = job.status === 'failed' ? 'Run failed' : job.status === 'cancelled' ? 'Run cancelled' : terminal ? `${passed}/${tests.length} tests passing` : 'Generating tests…';

  const stat = (value: number, label: string) => (
    <div style={{ display: 'flex', flexDirection: 'column', marginRight: 64 }}>
      <span style={{ fontSize: 64, fontWeight: 700, color: '#17201b' }}>{value}</span>
      <span style={{ fontSize: 22, letterSpacing: 3, color: '#6d7b72' }}>{label}</span>
    </div>
  );

  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: 72, background: '#f7f8f4', fontFamily: 'sans-serif' }}>
        <div style={{ display: 'flex', alignItems: 'center', fontSize: 28, color: '#527721', fontWeight: 700 }}>AgenticTest · Playwright suite</div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: 34, color: '#6d7b72' }}>{hostOf(job.targetUrl).slice(0, 60)}</span>
          <span style={{ fontSize: 76, fontWeight: 800, color: '#17201b', marginTop: 12 }}>{headline}</span>
        </div>
        <div style={{ display: 'flex' }}>
          {stat(tests.length, 'TESTS')}
          {stat(findings, 'FINDINGS')}
          {stat(corrected, 'SELF-CORRECTED')}
        </div>
      </div>
    ),
    {
      width: 1200, height: 630,
      headers: { 'Cache-Control': terminal ? 'public, max-age=3600, s-maxage=604800, immutable' : 'public, max-age=60, s-maxage=60' },
    },
  );
}
