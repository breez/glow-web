import React, { useState } from 'react';

const TW_BASE = 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains';

// Only map chain names that differ from their Trust Wallet folder name
const CHAIN_NAME_OVERRIDES: Record<string, string> = {
  'arbitrum one': 'arbitrum',
  'avalanche': 'avalanchec',
  'bsc': 'smartchain',
  'polygon pos': 'polygon',
};

// Well-known Ethereum mainnet contract addresses for common assets
const ASSET_CONTRACTS: Record<string, string> = {
  'USDC': '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  'USDT': '0xdAC17F958D2ee523a2206206994597C13D831ec7',
  'USDT0': '0xdAC17F958D2ee523a2206206994597C13D831ec7',
};

function twChainName(chain: string): string {
  const lower = chain.toLowerCase();
  return CHAIN_NAME_OVERRIDES[lower] ?? lower;
}

function getChainLogoUrl(chain: string): string {
  return `${TW_BASE}/${twChainName(chain)}/info/logo.png`;
}

function getAssetLogoUrl(asset: string): string | null {
  const contract = ASSET_CONTRACTS[asset];
  if (!contract) return null;
  return `${TW_BASE}/ethereum/assets/${contract}/logo.png`;
}

// Deterministic pastel color from a name string
function nameToColor(name: string): string {
  const hue = name.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;
  return `hsl(${hue}, 35%, 35%)`;
}

interface CryptoIconProps {
  /** Asset name (e.g. "USDC") — used for token icon lookup */
  asset?: string;
  /** Chain name (e.g. "ethereum", "base") — used for chain logo lookup */
  chain?: string;
  /** Icon size in pixels */
  size?: number;
  className?: string;
}

const CryptoIcon: React.FC<CryptoIconProps> = ({ asset, chain, size = 24, className = '' }) => {
  const [imgError, setImgError] = useState(false);

  const label = asset ?? chain ?? '?';
  const url = asset ? getAssetLogoUrl(asset) : chain ? getChainLogoUrl(chain) : null;

  if (imgError || !url) {
    return (
      <div
        className={`rounded-full flex items-center justify-center text-white font-bold shrink-0 ${className}`}
        style={{ width: size, height: size, backgroundColor: nameToColor(label), fontSize: size * 0.4 }}
      >
        {label.slice(0, 2).toUpperCase()}
      </div>
    );
  }

  return (
    <img
      src={url}
      alt={label}
      className={`rounded-full shrink-0 opacity-75 ${className}`}
      style={{ width: size, height: size }}
      onError={() => setImgError(true)}
    />
  );
};

export default CryptoIcon;
