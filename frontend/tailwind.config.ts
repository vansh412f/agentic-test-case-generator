import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './pages/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        background: 'rgb(var(--background) / <alpha-value>)',
        surface: 'rgb(var(--surface) / <alpha-value>)',
        raised: 'rgb(var(--raised) / <alpha-value>)',
        border: 'rgb(var(--border) / <alpha-value>)',
        input: 'rgb(var(--input) / <alpha-value>)',
        ring: 'rgb(var(--ring) / <alpha-value>)',
        foreground: 'rgb(var(--foreground) / <alpha-value>)',
        muted: {
          DEFAULT: 'rgb(var(--muted) / <alpha-value>)',
          foreground: 'rgb(var(--muted-foreground) / <alpha-value>)',
        },
        brand: {
          DEFAULT: 'rgb(var(--brand) / <alpha-value>)',
          strong: 'rgb(var(--brand-strong) / <alpha-value>)',
          foreground: 'rgb(var(--brand-foreground) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'rgb(var(--accent) / <alpha-value>)',
          foreground: 'rgb(var(--accent-foreground) / <alpha-value>)',
        },
        success: 'rgb(var(--success) / <alpha-value>)',
        warning: 'rgb(var(--warning) / <alpha-value>)',
        danger: 'rgb(var(--danger) / <alpha-value>)',
        info: 'rgb(var(--info) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-system', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      fontSize: {
        display: ['3.75rem', { lineHeight: '0.98', letterSpacing: '-0.045em' }],
        'heading-1': ['2.5rem', { lineHeight: '1.08', letterSpacing: '-0.035em' }],
        'heading-2': ['1.75rem', { lineHeight: '1.18', letterSpacing: '-0.025em' }],
        'card-title': ['1.0625rem', { lineHeight: '1.35', letterSpacing: '-0.01em' }],
        body: ['1rem', { lineHeight: '1.65' }],
        small: ['0.875rem', { lineHeight: '1.55' }],
        caption: ['0.75rem', { lineHeight: '1.45', letterSpacing: '0.01em' }],
      },
      spacing: {
        gutter: '1.5rem',
        section: '6rem',
        'section-sm': '3.5rem',
      },
      maxWidth: {
        shell: '80rem',
        reading: '46rem',
      },
      gridTemplateColumns: {
        'job-detail': 'minmax(0, 1fr) 22.5rem',
        'how-desktop': 'minmax(0, 1.55fr) minmax(0, 1fr)',
      },
      borderRadius: {
        panel: '0.875rem',
        control: '0.625rem',
      },
      boxShadow: {
        panel: '0 18px 50px rgb(0 0 0 / 0.22)',
        raised: '0 10px 30px rgb(0 0 0 / 0.18)',
        glow: '0 0 0 1px rgb(var(--brand) / 0.22), 0 12px 40px rgb(var(--brand) / 0.12)',
      },
      keyframes: {
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(14px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          from: { backgroundPosition: '200% 0' },
          to: { backgroundPosition: '-200% 0' },
        },
        blink: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.25' },
        },
      },
      animation: {
        'fade-up': 'fade-up 560ms cubic-bezier(0.22, 1, 0.36, 1) both',
        shimmer: 'shimmer 1.8s linear infinite',
        blink: 'blink 1.15s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};

export default config;
