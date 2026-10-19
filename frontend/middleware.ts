import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export const config = {
  matcher: '/api/:path*',
};

export function middleware(request: NextRequest) {
  const backendUrl = process.env.BACKEND_URL;
  const edgeSecret = process.env.EDGE_SHARED_SECRET;

  if (backendUrl && edgeSecret) {
    const rawIp =
      request.ip ||
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      '';

    const requestHeaders = new Headers(request.headers);

    // Strip any incoming x-agt-* headers from the client first
    for (const key of Array.from(requestHeaders.keys())) {
      if (key.toLowerCase().startsWith('x-agt-')) {
        requestHeaders.delete(key);
      }
    }

    // Set authenticated edge headers
    requestHeaders.set('x-agt-edge-secret', edgeSecret);
    if (rawIp) {
      requestHeaders.set('x-agt-client-ip', rawIp);
    }

    const base = backendUrl.replace(/\/+$/, '');
    const { pathname, search } = request.nextUrl;
    const destination = `${base}${pathname}${search}`;

    return NextResponse.rewrite(new URL(destination), {
      request: {
        headers: requestHeaders,
      },
    });
  }

  return NextResponse.next();
}
