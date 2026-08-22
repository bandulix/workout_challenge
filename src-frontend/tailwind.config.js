/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Signature "volt" accent - the Drill Instructor's whistle.
        volt: {
          100: '#f4ffc4',
          200: '#eaff8a',
          300: '#e1ff5c',
          400: '#d7ff3e',
          500: '#b8e62e',
          600: '#93b819',
          700: '#6f8f0f',
        },
        // Deep green-black "ink" surfaces for the dark athletic look.
        ink: {
          950: '#0a0d06',
          900: '#10150a',
          850: '#161c0e',
          800: '#1c2412',
          700: '#27331a',
          600: '#3a4a26',
        },
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'Helvetica', 'Arial', 'sans-serif'],
        display: ['"Archivo Black"', 'Inter', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        '4xl': '2rem',
      },
      boxShadow: {
        'glow-volt': '0 0 24px rgba(215, 255, 62, 0.35)',
        'glow-volt-lg': '0 0 48px rgba(215, 255, 62, 0.45)',
        'card-dark': '0 8px 32px rgba(0, 0, 0, 0.45)',
        'card': '0 4px 24px rgba(16, 21, 10, 0.08)',
      },
      keyframes: {
        'slide-up': {
          '0%': { transform: 'translateY(16px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        'pop-in': {
          '0%': { transform: 'scale(0.92)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        'pulse-ring': {
          '0%': { boxShadow: '0 0 0 0 rgba(215, 255, 62, 0.55)' },
          '70%': { boxShadow: '0 0 0 14px rgba(215, 255, 62, 0)' },
          '100%': { boxShadow: '0 0 0 0 rgba(215, 255, 62, 0)' },
        },
        'float-slow': {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-6px)' },
        },
        'blink-caret': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0' },
        },
        'nav-rise': {
          '0%': { transform: 'translateY(110%)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        'volt-breathe': {
          '0%, 100%': { opacity: '0.35', transform: 'scale(1)' },
          '50%': { opacity: '0.8', transform: 'scale(1.08)' },
        },
        'kenburns': {
          '0%': { transform: 'scale(1) translate3d(0,0,0)' },
          '100%': { transform: 'scale(1.12) translate3d(0,-2%,0)' },
        },
      },
      animation: {
        'slide-up': 'slide-up 0.35s cubic-bezier(0.22, 1, 0.36, 1) both',
        'pop-in': 'pop-in 0.25s cubic-bezier(0.22, 1, 0.36, 1) both',
        'pulse-ring': 'pulse-ring 2.2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'float-slow': 'float-slow 4s ease-in-out infinite',
        'blink-caret': 'blink-caret 1s step-end infinite',
        'nav-rise': 'nav-rise 0.55s cubic-bezier(0.22, 1, 0.36, 1) both',
        'volt-breathe': 'volt-breathe 3.2s ease-in-out infinite',
        'kenburns': 'kenburns 28s ease-out forwards',
      },
    },
  },
  plugins: [],
}
