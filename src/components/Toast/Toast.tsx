import { useState, useCallback, createContext, useContext, type ReactNode } from 'react';

export type ToastType = 'info' | 'success' | 'warning' | 'error';

interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
}

interface ToastContextValue {
  toast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue>({ toast: () => {} });

export const useToast = () => useContext(ToastContext);

let nextId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const toast = useCallback((message: string, type: ToastType = 'info') => {
    const id = ++nextId;
    setItems((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 4000);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {items.length > 0 && (
        <div
          style={{
            position: 'fixed',
            bottom: 16,
            right: 16,
            zIndex: 9999,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          {items.map((item) => (
            <div
              key={item.id}
              style={{
                background:
                  item.type === 'error'
                    ? '#d32f2f'
                    : item.type === 'warning'
                      ? '#f57c00'
                      : item.type === 'success'
                        ? '#388e3c'
                        : '#1565c0',
                color: '#fff',
                padding: '10px 16px',
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 500,
                maxWidth: 360,
                boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                animation: 'toast-in 0.3s ease',
              }}
            >
              {item.message}
            </div>
          ))}
        </div>
      )}
      <style>{`@keyframes toast-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }`}</style>
    </ToastContext.Provider>
  );
}
