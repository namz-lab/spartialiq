/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{vue,js,ts,jsx,tsx}',
  ],
  theme: {
    // Single source of truth for the civic palette.
    // Off-white paper, deep navy ink, one desaturated emerald accent.
    // Avoid the "AI" purple/blue gradient palette and pure black.
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      white: '#ffffff',
      black: '#0b1220', // off-black, never #000

      // Neutrals — slate-tinted toward navy ink so the whole UI feels cohesive.
      ink: {
        50:  '#f7f8fa',
        100: '#eef0f4',
        200: '#dde1e8',
        300: '#c0c6d1',
        400: '#8e96a4',
        500: '#5b6473',
        600: '#404a59',
        700: '#2b333f',
        800: '#1a1f29',
        900: '#0b1220',
      },

      // Single accent. Desaturated emerald — civic, not "SaaS".
      accent: {
        50:  '#eef6f1',
        100: '#d6ebde',
        200: '#aed5be',
        300: '#7eb798',
        400: '#4f9974',
        500: '#1e6b4a',
        600: '#175b3e',
        700: '#114830',
        800: '#0d3624',
        900: '#082519',
      },

      // Semantic — used sparingly, not as decoration.
      danger:  { 50: '#fef3f2', 500: '#b42318', 600: '#9a1c12' },
      warning: { 50: '#fef7e6', 500: '#b54708', 600: '#93390a' },
      success: { 50: '#eef6f1', 500: '#1e6b4a', 600: '#175b3e' },

      // Tailwind compatibility shims so existing utility classes
      // (text-gray-600, bg-blue-500, etc.) still resolve to ink/accent.
      gray:  { 50:'#f7f8fa', 100:'#eef0f4', 200:'#dde1e8', 300:'#c0c6d1', 400:'#8e96a4', 500:'#5b6473', 600:'#404a59', 700:'#2b333f', 800:'#1a1f29', 900:'#0b1220' },
      slate: { 50:'#f7f8fa', 100:'#eef0f4', 200:'#dde1e8', 300:'#c0c6d1', 400:'#8e96a4', 500:'#5b6473', 600:'#404a59', 700:'#2b333f', 800:'#1a1f29', 900:'#0b1220' },
      blue:  { 50:'#eef6f1', 100:'#d6ebde', 200:'#aed5be', 300:'#7eb798', 400:'#4f9974', 500:'#1e6b4a', 600:'#175b3e', 700:'#114830', 800:'#0d3624', 900:'#082519' },
      emerald:{50:'#eef6f1', 100:'#d6ebde', 200:'#aed5be', 300:'#7eb798', 400:'#4f9974', 500:'#1e6b4a', 600:'#175b3e', 700:'#114830', 800:'#0d3624', 900:'#082519' },
      red:   { 50:'#fef3f2', 100:'#fee4e2', 200:'#fccfcb', 300:'#f5a9a1', 400:'#cf3a2e', 500:'#b42318', 600:'#9a1c12', 700:'#7a1610', 800:'#5f110c', 900:'#450d09' },
      green: { 50:'#eef6f1', 100:'#d6ebde', 200:'#aed5be', 300:'#7eb798', 400:'#4f9974', 500:'#1e6b4a', 600:'#175b3e', 700:'#114830', 800:'#0d3624', 900:'#082519' },
      yellow:{ 50:'#fef7e6', 100:'#fdecc4', 200:'#fbdf9d', 300:'#e9b366', 400:'#cc7a2e', 500:'#b54708', 600:'#93390a', 700:'#762e08', 800:'#5a2306', 900:'#421a05' },
      amber: { 50:'#fef7e6', 100:'#fdecc4', 200:'#fbdf9d', 300:'#e9b366', 400:'#cc7a2e', 500:'#b54708', 600:'#93390a', 700:'#762e08', 800:'#5a2306', 900:'#421a05' },

      // Shims for the merged Survey Task Manager UI (formerly SurveyPro),
      // which uses the stock Tailwind families. Cool families resolve to the
      // accent scale, warm/violet families to ink or the semantic scales, so
      // the module keeps the civic palette without touching 120+ components.
      indigo: { 50:'#eef6f1', 100:'#d6ebde', 200:'#aed5be', 300:'#7eb798', 400:'#4f9974', 500:'#1e6b4a', 600:'#175b3e', 700:'#114830', 800:'#0d3624', 900:'#082519' },
      sky:    { 50:'#eef6f1', 100:'#d6ebde', 200:'#aed5be', 300:'#7eb798', 400:'#4f9974', 500:'#1e6b4a', 600:'#175b3e', 700:'#114830', 800:'#0d3624', 900:'#082519' },
      teal:   { 50:'#eef6f1', 100:'#d6ebde', 200:'#aed5be', 300:'#7eb798', 400:'#4f9974', 500:'#1e6b4a', 600:'#175b3e', 700:'#114830', 800:'#0d3624', 900:'#082519' },
      cyan:   { 50:'#eef6f1', 100:'#d6ebde', 200:'#aed5be', 300:'#7eb798', 400:'#4f9974', 500:'#1e6b4a', 600:'#175b3e', 700:'#114830', 800:'#0d3624', 900:'#082519' },
      purple: { 50:'#f7f8fa', 100:'#eef0f4', 200:'#dde1e8', 300:'#c0c6d1', 400:'#8e96a4', 500:'#5b6473', 600:'#404a59', 700:'#2b333f', 800:'#1a1f29', 900:'#0b1220' },
      fuchsia:{ 50:'#f7f8fa', 100:'#eef0f4', 200:'#dde1e8', 300:'#c0c6d1', 400:'#8e96a4', 500:'#5b6473', 600:'#404a59', 700:'#2b333f', 800:'#1a1f29', 900:'#0b1220' },
      pink:   { 50:'#f7f8fa', 100:'#eef0f4', 200:'#dde1e8', 300:'#c0c6d1', 400:'#8e96a4', 500:'#5b6473', 600:'#404a59', 700:'#2b333f', 800:'#1a1f29', 900:'#0b1220' },
      rose:   { 50:'#fef3f2', 100:'#fee4e2', 200:'#fccfcb', 300:'#f5a9a1', 400:'#cf3a2e', 500:'#b42318', 600:'#9a1c12', 700:'#7a1610', 800:'#5f110c', 900:'#450d09' },
      orange: { 50:'#fef7e6', 100:'#fdecc4', 200:'#fbdf9d', 300:'#e9b366', 400:'#cc7a2e', 500:'#b54708', 600:'#93390a', 700:'#762e08', 800:'#5a2306', 900:'#421a05' },
    },

    fontFamily: {
      // Civic-clean sans-serif. Loaded via index.html.
      sans: [
        '"Geist"',
        'ui-sans-serif',
        'system-ui',
        '-apple-system',
        'BlinkMacSystemFont',
        '"Segoe UI"',
        'sans-serif',
      ],
      // Reserved for ceremonial display moments only.
      display: ['"Fraunces"', 'ui-serif', 'Georgia', 'serif'],
      mono: ['"Geist Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
    },

    extend: {
      // Stronger custom easing curves (Emil Kowalski's recommended).
      transitionTimingFunction: {
        out:    'cubic-bezier(0.23, 1, 0.32, 1)',
        inout:  'cubic-bezier(0.77, 0, 0.175, 1)',
        drawer: 'cubic-bezier(0.32, 0.72, 0, 1)',
      },
      transitionDuration: {
        100: '100ms',
        160: '160ms',
        200: '200ms',
      },

      // Sober radii — no 9999px pill buttons by default.
      borderRadius: {
        sm: '4px',
        DEFAULT: '6px',
        md: '8px',
        lg: '12px',
        xl: '16px',
      },

      // Tinted-to-ink shadows. No raw black drop shadows.
      boxShadow: {
        sm:   '0 1px 2px 0 rgba(11, 18, 32, 0.05)',
        DEFAULT: '0 1px 3px 0 rgba(11, 18, 32, 0.08), 0 1px 2px -1px rgba(11, 18, 32, 0.04)',
        md:   '0 4px 12px -2px rgba(11, 18, 32, 0.08), 0 2px 4px -2px rgba(11, 18, 32, 0.04)',
        lg:   '0 12px 28px -8px rgba(11, 18, 32, 0.12), 0 4px 8px -4px rgba(11, 18, 32, 0.06)',
        ring: '0 0 0 3px rgba(30, 107, 74, 0.18)',
      },

      maxWidth: {
        prose: '65ch',
        page: '76rem',
      },

      // Fluid type for ceremonial moments.
      fontSize: {
        'display-1': ['clamp(2.5rem, 5vw + 1rem, 4.75rem)', { lineHeight: '1.05', letterSpacing: '-0.025em' }],
        'display-2': ['clamp(2rem, 3vw + 1rem, 3.25rem)', { lineHeight: '1.1', letterSpacing: '-0.02em' }],
      },
    },
  },
  plugins: [],
}
