// 版权所有：波哥
import { Component, StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

class AppBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <main className="startup-message" role="alert"><h1>暂时无法显示禅阅</h1><p>书库未被清除。请重新打开；若仍失败，请检查系统 WebView 更新并反馈此提示。</p><button onClick={() => window.location.reload()}>重新打开</button></main> : this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(<StrictMode><AppBoundary><App /></AppBoundary></StrictMode>);
