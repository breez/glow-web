import React from 'react';
import type { Contact } from '@breeztech/breez-sdk-spark';

interface ContactAutocompleteProps {
  contacts: Contact[];
  isVisible: boolean;
  isLoading: boolean;
  onSelect: (paymentIdentifier: string) => void;
}

const ContactAutocomplete: React.FC<ContactAutocompleteProps> = ({ contacts, isVisible, isLoading, onSelect }) => {
  if (!isVisible || !contacts.length || isLoading) return null;

  return (
    <div
      className={`absolute left-0 right-0 top-full -mt-5 z-10 bg-spark-dark border border-spark-border border-t-0 rounded-b-xl shadow-lg max-h-[192px] overflow-y-auto ${contacts.length === 1 ? 'pb-[8px]' : 'pb-[3px]'}`}
      onMouseDown={(e) => e.preventDefault()}
    >
      {contacts.map((contact) => (
        <button
          key={contact.id}
          onClick={() => onSelect(contact.paymentIdentifier)}
          className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-white/5 transition-colors text-left border-t border-spark-border/50`}
        >
          <div className="w-8 h-8 rounded-full bg-spark-primary/15 flex items-center justify-center shrink-0">
            <span className="text-spark-primary font-display font-bold text-xs">
              {contact.name.charAt(0).toUpperCase()}
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-spark-text-primary truncate">
              {contact.name}
            </p>
            <p className="text-xs text-spark-text-muted truncate">
              {contact.paymentIdentifier}
            </p>
          </div>
        </button>
      ))}
    </div>
  );
};

export default ContactAutocomplete;
