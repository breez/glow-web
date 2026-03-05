export const brand = {
  name: 'Glow',
  tagline: 'Powered by Breez SDK',
  description: 'Lightning fast Bitcoin payments powered by Breez SDK',
  lnAddressDomain: 'breez.tips',
  logo: '/assets/logo.png',
  version: '1.0.0',

  theme: {
    colors: {
      primary: '#d4a574',
      primaryLight: '#e8c9a8',
      background: '#0a0a0f',
      dark: '#0f0f18',
      surface: '#151520',
      elevated: '#1a1a28',
      border: '#252535',
      borderLight: '#35354a',
      accent: '#00d4ff',
      accentLight: '#7df3ff',
      success: '#10b981',
      error: '#ef4444',
    },
    fonts: {
      display: 'Plus Jakarta Sans',
      mono: 'JetBrains Mono',
    },
  },
} as const;

// Derived from name — integrators never touch these
const slug = brand.name.toLowerCase().replace(/[^a-z0-9]/g, '');

export const derived = {
  logPrefix: slug,
  logDbName: `${slug}-logs`,
  logExportTitle: `${brand.name} Log Export`,
  logShareTitle: `${brand.name} Logs`,
  cacheName: `${slug}-cache`,
} as const;
