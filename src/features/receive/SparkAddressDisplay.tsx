import React from 'react';
import LoadingSpinner from '../../components/LoadingSpinner';
import { QRCodeContainer, CopyableText } from '../../components/ui';
import { useToast } from '../../contexts/ToastContext';
import { useTranslation } from 'react-i18next';

interface Props {
  address: string | null;
  isLoading: boolean;
}

const SparkAddressDisplay: React.FC<Props> = ({ address, isLoading }) => {
  const { t } = useTranslation('common');
  const { showToast } = useToast();

  if (isLoading || !address) {
    return (
      <div className="text-center py-8">
        <LoadingSpinner text={t('receive.generatingSpark')} />
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-6">
      <QRCodeContainer value={address} />

      <CopyableText
        text={address}
        showShare
        label={t('receive.sparkAddress')}
        textColor="text-spark-primary"
        onCopied={() => showToast('success', t('actions.copied'))}
        onShareError={() => showToast('error', t('labels.shareFailed'))}
        data-testid="spark-address-text"
      />
    </div>
  );
};

export default SparkAddressDisplay;
