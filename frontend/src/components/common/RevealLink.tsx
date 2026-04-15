/**
 * 在 toast 里渲染「在 Finder 中显示」链接。仅 App 模式下显示。
 * 浏览器模式（无 reveal 能力）或路径不是绝对路径时返回 null。
 */
import React from 'react';
import { canReveal, revealPath, isAbsoluteSavedPath } from '../../utils/reveal';

interface Props {
  path?: string | null;
  className?: string;
  label?: string;
}

export const RevealLink: React.FC<Props> = ({ path, className = '', label = '在 Finder 中显示' }) => {
  if (!path || !isAbsoluteSavedPath(path) || !canReveal()) return null;
  return (
    <button
      type="button"
      onClick={() => revealPath(path)}
      className={`underline hover:no-underline ${className}`}
    >
      {label}
    </button>
  );
};
