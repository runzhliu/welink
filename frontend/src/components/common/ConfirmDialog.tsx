/**
 * 自绘确认弹窗 — 替代 window.confirm()，在 macOS/Windows WebView 里也能正常弹出。
 * 样式跟 WeLink 的 Modal 一致（圆角 + 毛玻璃遮罩 + 绿色主按钮）。
 */

import React, { useId, useRef } from 'react';
import { Dialog } from './Dialog';

interface Props {
  open: boolean;
  title: string;
  message: string;
  hint?: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmDialog: React.FC<Props> = ({
  open,
  title,
  message,
  hint,
  confirmText = '确定',
  cancelText = '取消',
  danger = false,
  onConfirm,
  onCancel,
}) => {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const messageId = useId();

  return (
    <Dialog open={open} title={title} onClose={onCancel} descriptionId={messageId} initialFocusRef={danger ? cancelRef : confirmRef}>
      <p id={messageId} className="ui-caption !text-sm whitespace-pre-line">{message}</p>
      {hint && <p className="ui-caption mt-2">{hint}</p>}
      <div className="ui-dialog-actions">
        <button type="button" ref={cancelRef} onClick={onCancel} className="ui-button ui-button-secondary">
          {cancelText}
        </button>
        <button type="button" ref={confirmRef} onClick={onConfirm} className={`ui-button ${danger ? 'ui-button-danger' : 'ui-button-primary'}`}>
          {confirmText}
        </button>
      </div>
    </Dialog>
  );
};
