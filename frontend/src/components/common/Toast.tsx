/**
 * 全局 Toast 系统。
 *
 * 用法：在 App 最外层包 <ToastProvider>，然后任意后代：
 *   const toast = useToast();
 *   toast.success('已保存');
 *   toast.error('失败：' + err);
 *   toast.info('提示');
 *
 * 设计：顶部右侧堆叠，4s 自动消失（error 是 6s）；点击关闭。
 * 不引入第三方库，避免 bundle 膨胀和 WebView 兼容性问题。
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

type ToastKind = 'success' | 'error' | 'info';
interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
  action?: { label: string; onClick: () => void };
  createdAt: number;
}

interface ToastCtx {
  success: (msg: string, opts?: { action?: { label: string; onClick: () => void } }) => void;
  error:   (msg: string, opts?: { action?: { label: string; onClick: () => void } }) => void;
  info:    (msg: string, opts?: { action?: { label: string; onClick: () => void } }) => void;
}

const Ctx = createContext<ToastCtx | null>(null);

export function useToast(): ToastCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [items, setItems] = useState<ToastItem[]>([]);

  const push = useCallback((kind: ToastKind, message: string, opts?: { action?: { label: string; onClick: () => void } }) => {
    const id = Date.now() + Math.random();
    setItems(list => [...list, { id, kind, message, action: opts?.action, createdAt: Date.now() }]);
    const ttl = kind === 'error' ? 6000 : 4000;
    setTimeout(() => setItems(list => list.filter(t => t.id !== id)), ttl);
  }, []);

  const api = useMemo<ToastCtx>(() => ({
    success: (m, o) => push('success', m, o),
    error:   (m, o) => push('error', m, o),
    info:    (m, o) => push('info', m, o),
  }), [push]);

  return (
    <Ctx.Provider value={api}>
      {children}
      <ToastContainer items={items} onDismiss={id => setItems(list => list.filter(t => t.id !== id))} />
    </Ctx.Provider>
  );
};

const KIND_STYLES: Record<ToastKind, { icon: React.ReactNode; bg: string; border: string; text: string }> = {
  success: {
    icon: <CheckCircle2 size={16} className="text-[#07c160] flex-shrink-0" />,
    bg: 'bg-[#07c160]/5 dark:bg-[#07c160]/15',
    border: 'border-[#07c160]/30',
    text: 'text-[#1d1d1f] dark:text-gray-100',
  },
  error: {
    icon: <AlertCircle size={16} className="text-red-500 flex-shrink-0" />,
    bg: 'bg-red-50 dark:bg-red-900/20',
    border: 'border-red-200 dark:border-red-800',
    text: 'text-red-700 dark:text-red-300',
  },
  info: {
    icon: <Info size={16} className="text-[#576b95] flex-shrink-0" />,
    bg: 'bg-[#f8f9fb] dark:bg-white/5',
    border: 'border-gray-200 dark:border-white/10',
    text: 'text-[#1d1d1f] dark:text-gray-100',
  },
};

const ToastContainer: React.FC<{ items: ToastItem[]; onDismiss: (id: number) => void }> = ({ items, onDismiss }) => {
  if (items.length === 0) return null;
  return (
    <div className="fixed top-4 right-4 z-[300] flex flex-col gap-2 max-w-sm pointer-events-none">
      {items.map(t => {
        const s = KIND_STYLES[t.kind];
        return (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-start gap-2.5 px-4 py-3 rounded-xl shadow-lg border ${s.bg} ${s.border} animate-slide-in-right`}
          >
            {s.icon}
            <div className={`flex-1 min-w-0 text-sm ${s.text}`}>
              <p className="leading-relaxed break-words">{t.message}</p>
              {t.action && (
                <button
                  onClick={() => { t.action!.onClick(); onDismiss(t.id); }}
                  className="mt-1 text-xs font-semibold underline hover:no-underline"
                >
                  {t.action.label}
                </button>
              )}
            </div>
            <button onClick={() => onDismiss(t.id)} className="text-gray-400 hover:text-gray-600 flex-shrink-0">
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
};

// 兼容"非组件上下文"场景：用全局事件总线桥接。
// 极少数情况（如某个 util 里需要弹 toast）用 emitToast，组件内优先 useToast。
const BUS = new EventTarget();

export function emitToast(kind: ToastKind, message: string) {
  BUS.dispatchEvent(new CustomEvent('welink-toast', { detail: { kind, message } }));
}

export const ToastBridge: React.FC = () => {
  const toast = useToast();
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ kind: ToastKind; message: string }>;
      toast[ce.detail.kind](ce.detail.message);
    };
    BUS.addEventListener('welink-toast', handler);
    return () => BUS.removeEventListener('welink-toast', handler);
  }, [toast]);
  return null;
};
