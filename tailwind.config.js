/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        spark: {
          // Base backgrounds — all driven by CSS variables from brand config
          void: 'rgb(var(--spark-void-rgb) / <alpha-value>)',
          dark: 'rgb(var(--spark-dark-rgb) / <alpha-value>)',
          surface: 'rgb(var(--spark-surface-rgb) / <alpha-value>)',
          elevated: 'rgb(var(--spark-elevated-rgb) / <alpha-value>)',

          // Borders
          border: 'rgb(var(--spark-border-rgb) / <alpha-value>)',
          'border-light': 'rgb(var(--spark-border-light-rgb) / <alpha-value>)',

          // Primary accent
          primary: 'rgb(var(--spark-primary-rgb) / <alpha-value>)',
          'primary-light': 'rgb(var(--spark-primary-light-rgb) / <alpha-value>)',
          'primary-glow': 'var(--glow-primary)',

          // Secondary accent
          electric: 'rgb(var(--spark-electric-rgb) / <alpha-value>)',
          'electric-light': 'rgb(var(--spark-electric-light-rgb) / <alpha-value>)',

          // Semantic
          success: 'rgb(var(--spark-success-rgb) / <alpha-value>)',
          error: 'rgb(var(--spark-error-rgb) / <alpha-value>)',
          warning: 'rgb(var(--spark-warning-rgb) / <alpha-value>)',

          // Text
          'text-primary': 'rgb(var(--spark-text-primary-rgb) / <alpha-value>)',
          'text-secondary': 'var(--spark-text-secondary)',
          'text-muted': 'var(--spark-text-muted)',
        }
      },
      fontFamily: {
        display: ['var(--brand-font-display)', 'system-ui', 'sans-serif'],
        sans: ['var(--brand-font-display)', 'system-ui', 'sans-serif'],
        mono: ['var(--brand-font-mono)', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        'display-xl': ['4rem', { lineHeight: '1.1', letterSpacing: '-0.02em' }],
        'display-lg': ['3rem', { lineHeight: '1.1', letterSpacing: '-0.02em' }],
        'display-md': ['2.25rem', { lineHeight: '1.2', letterSpacing: '-0.01em' }],
        'display-sm': ['1.5rem', { lineHeight: '1.3', letterSpacing: '-0.01em' }],
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'gradient-conic': 'conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))',
        'glow-primary': 'radial-gradient(ellipse at center, var(--glow-primary) 0%, transparent 70%)',
        'glow-electric': 'radial-gradient(ellipse at center, var(--glow-electric) 0%, transparent 70%)',
      },
      boxShadow: {
        'glow-primary': '0 0 40px var(--glow-primary)',
        'glow-electric': '0 0 40px var(--glow-electric)',
        'glow-success': '0 0 30px var(--glow-success)',
        'glow-error': '0 0 30px var(--glow-error)',
        'glass': '0 8px 32px rgba(0, 0, 0, 0.4)',
        'glass-lg': '0 16px 48px rgba(0, 0, 0, 0.5)',
      },
      dropShadow: {
        'brand': '0 0 15px var(--glow-primary)',
        'brand-lg': '0 0 30px var(--glow-primary)',
      },
      animation: {
        'pulse-slow': 'pulse 3s ease-in-out infinite',
        'glow-pulse': 'glow-pulse 2s ease-in-out infinite',
        'float': 'float 6s ease-in-out infinite',
        'shimmer': 'shimmer 2s linear infinite',
        'spin-slow': 'spin 3s linear infinite',
        'bounce-subtle': 'bounce-subtle 2s ease-in-out infinite',
      },
      keyframes: {
        'glow-pulse': {
          '0%, 100%': { opacity: '0.6' },
          '50%': { opacity: '1' },
        },
        'float': {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        'shimmer': {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        'bounce-subtle': {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-5px)' },
        },
      },
      backdropBlur: {
        'xs': '2px',
      },
    },
  },
  plugins: [],
  darkMode: 'class',
}
