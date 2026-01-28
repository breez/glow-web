import React, { createContext, useContext, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import ToastNotification, { ToastType } from '../components/ToastNotification';

interface Toast {
  id: number;
  type: ToastType;
  message: string;
  detail?: string;
}

interface ToastContextType {
  showToast: (type: ToastType, message: string, detail?: string) => void;
}

const ToastContext = createContext<ToastContextType>({
  showToast: () => { },
});

export const useToast = () => useContext(ToastContext);

let toastIdCounter = 0;

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((type: ToastType, message: string, detail?: string) => {
    const id = toastIdCounter++;
    setToasts(prevToasts => [...prevToasts, { id, type, message, detail }]);
  }, []);

  const removeToast = useCallback((id: number) => {
    setToasts(prevToasts => prevToasts.filter(toast => toast.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {createPortal(
        <div className="toast-container">
          {toasts.map(toast => (
            <ToastNotification
              key={toast.id}
              type={toast.type}
              message={toast.message}
              detail={toast.detail}
              onClose={() => removeToast(toast.id)}
            />
          ))}
        </div>,
        document.body
      )}
    </ToastContext.Provider>
  );
};
