import i18n from 'i18next';

const MINUTES_PER_BLOCK = 10;
const BLOCKS_PER_HOUR = 6;
const BLOCKS_PER_DAY = 144;

export function formatBlockWait(blocks: number): string {
  if (blocks <= 0) return i18n.t('labels.readyNow');
  if (blocks < BLOCKS_PER_HOUR) return i18n.t('labels.approxMinutes', { value: blocks * MINUTES_PER_BLOCK });
  if (blocks < BLOCKS_PER_DAY) return i18n.t('labels.approxHours', { value: Math.round(blocks / BLOCKS_PER_HOUR) });
  return i18n.t('labels.approxDays', { value: Math.round(blocks / BLOCKS_PER_DAY) });
}

export function formatDaysLeft(blocks: number): string {
  if (blocks <= 0) return '0';
  const days = Math.round(blocks / BLOCKS_PER_DAY);
  return days < 1 ? '<1' : `~${days}`;
}
