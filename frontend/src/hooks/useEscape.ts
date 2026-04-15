/**
 * 通用 Esc 键关闭钩子。Modal 打开时挂 window keydown，卸载时清理。
 *
 * 为什么不在容器 div 上 onKeyDown：容器 div 打开时焦点不一定在里面（除非
 * 子组件 autofocus），所以容器 onKeyDown 经常收不到事件。window listener 最稳。
 */
import { useEffect } from 'react';

export function useEscape(active: boolean, onEscape: () => void) {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onEscape();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, onEscape]);
}
