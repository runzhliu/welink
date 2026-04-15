/**
 * WeLink — 微信聊天数据分析平台
 * Copyright (C) 2026 runzhliu
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { initFrontendLogger } from './utils/frontendLogger'
import { ToastProvider, ToastBridge } from './components/common/Toast'
import { ErrorBoundary } from './components/common/ErrorBoundary'

// 初始化前端日志收集（捕获 console.error、未捕获异常，批量上报后端）
initFrontendLogger()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ToastProvider>
      <ToastBridge />
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </ToastProvider>
  </React.StrictMode>,
)
