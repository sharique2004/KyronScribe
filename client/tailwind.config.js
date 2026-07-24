/** @type {import('tailwindcss').Config} */
// Design tokens map PRD §7.1 exactly. Do not introduce default-Tailwind
// blues/grays in components — use the semantic token names below.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        page: '#F6F7F9',
        surface: '#FFFFFF',
        ink: '#0F172A',
        muted: '#5B6472',
        line: '#E2E8F0',
        primary: {
          DEFAULT: '#1D4FD7',
          hover: '#1A46BE',
        },
        success: '#0E7C6B',
        warning: '#B45309',
        critical: '#B91C1C',
        flag: {
          bg: '#FEF2F2',
        },
      },
      fontFamily: {
        sans: [
          'Inter',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica',
          'Arial',
          'sans-serif',
        ],
        mono: [
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Consolas',
          'monospace',
        ],
      },
      fontSize: {
        // scale from §7.1: body 13.5px/1.45, meta 12px, section 11px, page title 18px
        meta: ['12px', { lineHeight: '1.4' }],
        body: ['13.5px', { lineHeight: '1.45' }],
        base: ['13.5px', { lineHeight: '1.45' }],
        section: ['11px', { lineHeight: '1.3', letterSpacing: '0.06em' }],
        title: ['18px', { lineHeight: '1.3', fontWeight: '600' }],
      },
      borderRadius: {
        DEFAULT: '6px',
        md: '6px',
      },
      boxShadow: {
        card: '0 1px 2px rgba(15,23,42,.05)',
        overlay: '0 12px 32px rgba(15,23,42,.18)',
        menu: '0 6px 20px rgba(15,23,42,.12)',
      },
      maxWidth: {
        content: '1200px',
      },
    },
  },
  plugins: [],
};
