import i18n from 'i18next';

const MINUTES_PER_BLOCK = 10;
const BLOCKS_PER_HOUR = 6;
const BLOCKS_PER_DAY = 144;

export function formatBlockWait(blocks: number): string {
  if (blocks <= 0) return i18n.t('common:labels.readyNow');
  if (blocks < BLOCKS_PER_HOUR) return `~${blocks * MINUTES_PER_BLOCK} min`;
  if (blocks < BLOCKS_PER_DAY) return `~${Math.round(blocks / BLOCKS_PER_HOUR)} h`;
  return `~${Math.round(blocks / BLOCKS_PER_DAY)} d`;
}

export function formatDaysLeft(blocks: number): string {
  if (blocks <= 0) return '0';
  const days = Math.round(blocks / BLOCKS_PER_DAY);
  return days < 1 ? '<1' : `~${days}`;
}
