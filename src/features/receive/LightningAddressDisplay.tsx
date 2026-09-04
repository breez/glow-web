import React, { type ReactNode } from 'react';
import type { LightningAddressInfo } from '@breeztech/breez-sdk-spark';
import { AlertCard } from '../../components/AlertCard';
import { QRCodeContainer, QrPlaceholder, PrimaryButton, CopyableText, TextButton } from '../../components/ui';
import { useToast } from '../../contexts/ToastContext';
import { EditIcon } from '../../components/Icons';
import { useTranslation } from 'react-i18next';

export interface LightningAddressDisplayProps {
  address: LightningAddressInfo | null;
  isLoading: boolean;
  isSupported: boolean;
  /** Opens the edit sheet, which also creates the first address. */
  onEdit: () => void;
  onCustomizeAmount: () => void;
  /** The QR slot beside the side dock, or the address and actions under it. */
  section: 'qr' | 'details';
  qrSize?: number;
  qrCardClassName?: string;
}

const EditButton: React.FC<{ onClick: () => void }> = ({ onClick }) => {
  const { t } = useTranslation('common');
  return (
  <button
    onClick={onClick}
    className="flex items-center gap-2 px-4 border border-spark-border text-spark-text-secondary rounded-xl font-medium text-sm hover:text-spark-text-primary hover:border-spark-border-light transition-colors"
    title={t('receive.editLightningAddress')}
  >
    <EditIcon />
    {t('actions.edit')}
  </button>
  );
};

const LightningAddressDisplay: React.FC<LightningAddressDisplayProps> = ({
  address,
  isLoading,
  isSupported,
  onEdit,
  onCustomizeAmount,
  section,
  qrSize = 200,
  qrCardClassName,
}) => {
  const { t } = useTranslation('common');
  const { showToast } = useToast();
  const amountLink = (className: string) => (
    <TextButton
      onClick={onCustomizeAmount}
      className={`${className} show-amount-panel-button`}
      data-testid="show-amount-panel-button"
    >
      Create invoice with specific amount →
    </TextButton>
  );
  // A message in the QR slot takes the card's width, so the dock and caption stay put.
  const slot = (children: ReactNode) => <div style={{ width: qrSize + 32 }}>{children}</div>;

  if (!isSupported) {
    return section === 'qr' ? slot(
      <AlertCard variant="info" title={t('receive.lightningUnavailable')} className="w-full text-left">
        <p className="text-spark-text-secondary text-sm" data-testid="lightning-address-unsupported">
          They&apos;re not supported in this environment.
        </p>
      </AlertCard>,
    ) : (
      <div className="w-full flex justify-center">{amountLink('text-sm')}</div>
    );
  }

  // Loading state — gated on `!address` so we only show the placeholder
  // while the address is genuinely unknown. The first open after
  // passkey onboarding (new label, no LN address registered yet)
  // lands here: `useLightningAddress.load()` hits
  // `getLightningAddress() → null`, auto-registers a random
  // username, then re-fetches. `isLoading=true` and `address=null`
  // for the full lookup→register→re-lookup span — without this
  // branch the user saw the `!address` fallback
  // ("Create Lightning Address" button) flash during auto-creation,
  // which is confusing because they didn't ask to create anything.
  //
  // The earlier version of this branch gated on plain `isLoading`
  // and caused a flash on every tab switch because
  // `load()` refires on Lightning-tab re-entry even when `address`
  // is already cached. Gating on `!address` fixes that regression
  // too: cached-address + in-flight refresh now stays on the QR
  // view.
  if (isLoading && !address) {
    return section === 'qr' ? <QrPlaceholder size={qrSize} cardClassName={qrCardClassName} /> : null;
  }

  if (!address) {
    return section === 'qr' ? slot(
      <div className="text-center">
        <h3 className="font-display text-lg font-semibold text-spark-text-primary mb-2">{t('methods.lightningAddress')}</h3>
        <p className="text-spark-text-secondary text-sm mb-4">
          {t('receive.createAddressBody')}
        </p>
        <PrimaryButton onClick={onEdit}>{t('receive.createAddress')}</PrimaryButton>
      </div>,
    ) : (
      <div className="w-full flex justify-center">{amountLink('text-sm')}</div>
    );
  }

  if (section === 'qr') {
    return <QRCodeContainer value={address.lnurl.bech32.toUpperCase()} size={qrSize} cardClassName={qrCardClassName} />;
  }

  return (
    <div className="w-full flex flex-col items-center gap-4">
      <CopyableText
        text={address.lightningAddress}
        truncate
        showShare
        label={t('methods.lightningAddress')}
        textColor="text-spark-primary"
        onCopied={() => showToast('success', t('actions.copied'))}
        onShareError={() => showToast('error', t('receive.shareFailed'))}
        additionalActions={<EditButton onClick={onEdit} />}
        textToCopy={address.lightningAddress}
        textToShare={address.lnurl.bech32}
        shareLabel="LNURL-Pay"
        data-testid="lightning-address-text"
      />

      {amountLink('mt-2')}
    </div>
  );
};

export default LightningAddressDisplay;
