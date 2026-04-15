/**
 * 全局错误边界。子组件抛异常时渲染友好 fallback，带：
 *   - 错误摘要
 *   - 「反馈此问题」按钮 → 预填 FeedbackModal 的 title / body
 *   - 「刷新页面」按钮
 *
 * 用法：包在 App 主区域外。子树抛的非 async 错误会被 React 捕获；
 * promise rejection 不会进 ErrorBoundary（我们已有 frontendLogger 收集，
 * 这里不重复处理）。
 */

import React from 'react';
import { AlertTriangle, Bug, RefreshCw } from 'lucide-react';
import { FeedbackModal } from './FeedbackModal';

interface Props {
  children: React.ReactNode;
  appVersion?: string;
}

interface State {
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
  feedbackOpen: boolean;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null, errorInfo: null, feedbackOpen: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    this.setState({ errorInfo: info });
    // 上报给 frontend logger（如果它已注入 console.error 拦截会被一起收走）
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  reset = () => this.setState({ error: null, errorInfo: null });

  render() {
    if (!this.state.error) return this.props.children;

    const err = this.state.error;
    const info = this.state.errorInfo;
    const stack = (err.stack || '').split('\n').slice(0, 8).join('\n');
    const componentStack = (info?.componentStack || '').split('\n').slice(0, 6).join('\n');
    const prefill = [
      '### 错误信息',
      '```',
      `${err.name}: ${err.message}`,
      '```',
      '',
      '### 堆栈（前 8 行）',
      '```',
      stack,
      '```',
      '',
      '### 组件栈（前 6 行）',
      '```',
      componentStack,
      '```',
      '',
      '### 用户操作（请补充）',
      '在触发错误前我正在…',
    ].join('\n');

    return (
      <>
        <div className="min-h-screen bg-[#f8f9fb] dk-page flex items-center justify-center p-6">
          <div className="w-full max-w-xl bg-white dk-card rounded-2xl shadow-sm border border-gray-100 dk-border p-8">
            <div className="flex items-start gap-4 mb-5">
              <div className="w-12 h-12 rounded-xl bg-red-50 flex items-center justify-center flex-shrink-0">
                <AlertTriangle size={24} className="text-red-500" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-[#1d1d1f] dk-text mb-1">界面崩溃了</h1>
                <p className="text-sm text-gray-500">
                  遇到一个未处理的错误，当前页面已停止渲染。你可以把错误反馈给我们，或刷新页面重试。
                </p>
              </div>
            </div>

            <div className="mb-6">
              <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">错误信息</div>
              <pre className="text-xs bg-gray-50 dk-bg-soft rounded-lg p-3 overflow-x-auto max-h-40 font-mono text-gray-700 dk-text-soft whitespace-pre-wrap">
                {err.name}: {err.message}
                {'\n\n'}
                {stack}
              </pre>
            </div>

            <div className="flex flex-wrap gap-2 justify-end">
              <button
                onClick={() => window.location.reload()}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-300 text-sm font-semibold hover:bg-gray-200 dark:hover:bg-white/15 transition-colors"
              >
                <RefreshCw size={14} />
                刷新页面
              </button>
              <button
                onClick={() => this.setState({ feedbackOpen: true })}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#07c160] text-white text-sm font-semibold hover:bg-[#06ad56] transition-colors"
              >
                <Bug size={14} />
                反馈此问题
              </button>
            </div>

            <div className="mt-6 pt-4 border-t border-gray-100 dk-border text-xs text-gray-400">
              <p>如果反复出现，建议先在「诊断」页检查 LLM 配置和数据目录；常见根因是 LLM 端点返回了意外的格式。</p>
            </div>
          </div>
        </div>

        <FeedbackModal
          open={this.state.feedbackOpen}
          onClose={() => this.setState({ feedbackOpen: false })}
          appVersion={this.props.appVersion}
          initialTitle={`前端崩溃：${err.name}: ${err.message.slice(0, 80)}`}
          initialBody={prefill}
        />
      </>
    );
  }
}
