import React, { useState, useMemo, useRef } from 'react';
import type { Contact } from '@breeztech/breez-sdk-spark';
import { useContactsContext } from '../../../contexts/ContactsContext';
import { isValidLightningAddress, searchContacts } from '../../../hooks/useContacts';
import { FormInput, FormError, PrimaryButton, ConfirmDialog } from '../../../components/ui';
import { BackIcon, PlusIcon, EditPencilIcon, TrashIcon, ContactsIcon, SearchIcon, CloseIcon } from '../../../components/Icons';
import { useWallet } from '../../../contexts/WalletContext';
import { dismissKeyboard } from '../../../utils/keyboard';

interface ContactsSubViewProps {
  onSelect: (address: string) => void;
  onBack: () => void;
}

const ContactsSubView: React.FC<ContactsSubViewProps> = ({ onSelect, onBack }) => {
  const wallet = useWallet();
  const { contacts, isLoading, hasSynced, addContact, updateContact, deleteContact } = useContactsContext();
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [deletingContact, setDeletingContact] = useState<Contact | null>(null);
  const [formName, setFormName] = useState('');
  const [formAddress, setFormAddress] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  // Ref to the Lightning Address input so the Name field's Enter
  // handler can programmatically focus it (enterKeyHint="next").
  const addressInputRef = useRef<HTMLInputElement>(null);

  const filteredContacts = useMemo(() => {
    if (!searchQuery.trim()) return [...contacts].sort((a, b) => a.name.localeCompare(b.name));
    return searchContacts(contacts, searchQuery);
  }, [contacts, searchQuery]);

  const isFormOpen = showAddForm || !!editingContact;

  const resetForm = () => {
    setFormName('');
    setFormAddress('');
    setFormError(null);
    setShowAddForm(false);
    setEditingContact(null);
  };

  const handleStartEdit = (contact: Contact) => {
    setEditingContact(contact);
    setFormName(contact.name);
    setFormAddress(contact.paymentIdentifier);
    setFormError(null);
    setShowAddForm(false);
  };

  const handleStartAdd = () => {
    resetForm();
    setShowAddForm(true);
  };

  const handleSave = async () => {
    // Dismiss the soft keyboard up front: users expect the keyboard to
    // retract the moment they commit the form, regardless of whether
    // validation passes or fails. Leaving it up while an inline error
    // appears covers the error message and looks broken.
    await dismissKeyboard();

    const name = formName.trim();
    const address = formAddress.trim();
    if (!name) { setFormError('Name is required'); return; }
    if (!address) { setFormError('Address is required'); return; }
    if (!isValidLightningAddress(address)) { setFormError('Invalid Lightning address format'); return; }

    setIsSaving(true);
    setFormError(null);

    // Verify the address actually resolves (skip if editing and address unchanged)
    const addressChanged = !editingContact || editingContact.paymentIdentifier !== address;
    if (addressChanged) {
      try {
        await wallet.parse(address);
      } catch {
        setIsSaving(false);
        setFormError('Lightning address not found');
        return;
      }
    }

    if (editingContact) {
      const result = await updateContact(editingContact.id, name, address);
      if (result) resetForm();
      else setFormError('Failed to update contact');
    } else {
      const result = await addContact(name, address);
      if (result) resetForm();
      else setFormError('Failed to add contact');
    }
    setIsSaving(false);
  };

  const handleDelete = async () => {
    if (!deletingContact) return;
    await deleteContact(deletingContact.id);
    setDeletingContact(null);
  };

  return (
    <div className="flex flex-col flex-1 relative overflow-hidden">
      {/* Contacts list view */}
      <div
        className={`flex flex-col transition-all duration-200 ease-out ${
          isFormOpen
            ? 'absolute inset-0 opacity-0 -translate-x-full pointer-events-none'
            : 'relative flex-1 opacity-100 translate-x-0'
        }`}
      >
        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          <button
            onClick={onBack}
            className="p-1.5 text-spark-text-muted hover:text-spark-text-primary rounded-lg hover:bg-white/5 transition-colors"
          >
            <BackIcon />
          </button>
          <h2 className="font-display text-lg font-bold text-spark-text-primary flex-1">Contacts</h2>
          <button
            onClick={handleStartAdd}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-spark-primary text-white text-sm font-medium rounded-xl hover:bg-spark-primary-light transition-colors"
            aria-label="Add contact"
          >
            <PlusIcon size="sm" />
            <span>Add</span>
          </button>
        </div>

        {/* Search */}
        <div className="relative mb-3">
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-spark-text-muted pointer-events-none" />
          <input
            id="contacts-search"
            name="contacts-search"
            aria-label="Search contacts"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={async (e) => {
              // The search input filters the contact list as the user
              // types — there's no async "submit" action to take on
              // Enter. Just retract the keyboard so the user can see
              // the filtered results without the keyboard covering
              // them.
              if (e.key === 'Enter') {
                e.preventDefault();
                await dismissKeyboard();
              }
            }}
            enterKeyHint="search"
            type="text"
            inputMode="search"
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            placeholder="Search contacts..."
            className="w-full bg-spark-dark border border-spark-border rounded-xl pl-9 pr-9 py-2.5 text-sm text-spark-text-primary placeholder-spark-text-muted focus:border-spark-primary focus:ring-0 transition-all"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-spark-text-muted hover:text-spark-text-primary transition-colors"
            >
              <CloseIcon size="sm" />
            </button>
          )}
        </div>

        {/* Contact list */}
        {isLoading || (!hasSynced && contacts.length === 0) ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-6 h-6 border-2 border-spark-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filteredContacts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 px-6">
            <div className="w-14 h-14 rounded-2xl bg-spark-surface border border-spark-border flex items-center justify-center mb-3">
              <ContactsIcon className="w-7 h-7 text-spark-text-muted" />
            </div>
            <h3 className="text-base font-semibold text-spark-text-primary mb-1">
              {searchQuery ? 'No matches' : 'No contacts yet'}
            </h3>
            <p className="text-spark-text-muted text-sm text-center max-w-xs">
              {searchQuery ? 'Try a different search term.' : 'Add contacts to quickly send payments.'}
            </p>
          </div>
        ) : (
          <div className="space-y-0.5 max-h-[340px] overflow-y-auto scrollbar-hidden">
            {filteredContacts.map((contact) => (
              <div
                key={contact.id}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/5 transition-colors group"
              >
                {/* Avatar */}
                <div className="w-9 h-9 rounded-full bg-spark-primary/15 flex items-center justify-center shrink-0">
                  <span className="text-spark-primary font-display font-bold text-sm">
                    {contact.name.charAt(0).toUpperCase()}
                  </span>
                </div>

                {/* Info - tap to select */}
                <button
                  className="flex-1 min-w-0 text-left"
                  onClick={() => onSelect(contact.paymentIdentifier)}
                >
                  <p className="text-[15px] font-medium text-spark-text-primary truncate">
                    {contact.name}
                  </p>
                  <p className="text-xs text-spark-text-muted truncate">
                    {contact.paymentIdentifier}
                  </p>
                </button>

                {/* Actions — subtle until hover/focus */}
                <div className="flex items-center gap-0.5 shrink-0 md:opacity-50 md:group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => handleStartEdit(contact)}
                    className="p-1.5 text-spark-text-muted hover:text-spark-text-primary rounded-lg hover:bg-white/5 transition-colors"
                    aria-label={`Edit ${contact.name}`}
                  >
                    <EditPencilIcon />
                  </button>
                  <button
                    onClick={() => setDeletingContact(contact)}
                    className="p-1.5 text-spark-text-muted hover:text-spark-error rounded-lg hover:bg-white/5 transition-colors"
                    aria-label={`Delete ${contact.name}`}
                  >
                    <TrashIcon />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add/Edit form view — slides in from right. Uses flex-col so
          the action buttons snap to the bottom of the available card
          space instead of sitting below the last input. */}
      <div
        className={`flex flex-col transition-all duration-200 ease-out ${
          isFormOpen
            ? 'relative flex-1 opacity-100 translate-x-0'
            : 'absolute inset-0 opacity-0 translate-x-full pointer-events-none'
        }`}
      >
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={resetForm}
            className="p-1.5 text-spark-text-muted hover:text-spark-text-primary rounded-lg hover:bg-white/5 transition-colors"
          >
            <BackIcon />
          </button>
          <h2 className="font-display text-lg font-bold text-spark-text-primary">
            {editingContact ? 'Edit Contact' : 'New Contact'}
          </h2>
        </div>

        {/* Form fields take the natural content height */}
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="subview-contact-name" className="text-sm text-spark-text-secondary font-medium">Name</label>
            <input
              id="subview-contact-name"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                // Enter on the Name field moves focus to the
                // Lightning Address field. On Android the soft
                // keyboard's action button is labelled "Next" (via
                // enterKeyHint) so the behaviour matches the label.
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addressInputRef.current?.focus();
                }
              }}
              enterKeyHint="next"
              placeholder="Contact name"
              disabled={isSaving}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              className="w-full bg-spark-dark border border-spark-border rounded-xl px-4 py-3 text-spark-text-primary placeholder-spark-text-muted focus:border-spark-primary focus:ring-0 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="subview-contact-address" className="text-sm text-spark-text-secondary font-medium">Lightning Address</label>
            <FormInput
              id="subview-contact-address"
              inputRef={addressInputRef}
              value={formAddress}
              onChange={(e) => setFormAddress(e.target.value)}
              onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                // Enter on the last field submits. handleSave runs
                // its own validation and surfaces inline errors if
                // any field is empty or malformed, so we don't gate
                // on field state here — the Done button should
                // always trigger a submit attempt.
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleSave();
                }
              }}
              enterKeyHint="done"
              inputMode="email"
              autoCapitalize="none"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
              placeholder="user@domain.com"
              disabled={isSaving}
            />
          </div>
          <FormError error={formError} />
        </div>

        {/* Action buttons pinned to the bottom of the form area via
            mt-auto so the sheet feels consistent with PasskeyPage /
            GeneratePage's bottom-aligned primary actions. */}
        <div className="flex gap-3 pt-4 mt-auto">
          <button
            onClick={resetForm}
            className="flex-1 py-3 text-sm font-medium border border-spark-border text-spark-text-secondary rounded-xl hover:text-spark-text-primary transition-colors"
          >
            Cancel
          </button>
          <PrimaryButton onClick={handleSave} disabled={isSaving} className="flex-1">
            {isSaving ? 'Saving...' : 'Save'}
          </PrimaryButton>
        </div>
      </div>

      {/* Delete confirmation */}
      <ConfirmDialog
        isOpen={!!deletingContact}
        title="Delete Contact"
        message={`Are you sure you want to delete "${deletingContact?.name}"?`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setDeletingContact(null)}
      />
    </div>
  );
};

export default ContactsSubView;
