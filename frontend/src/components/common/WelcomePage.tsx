import React, { useState } from 'react';
import { ArrowRight, CalendarDays, Database, ExternalLink, Github, Loader2, Monitor, ShieldCheck, Terminal } from 'lucide-react';
import { DatePicker } from './DatePicker';
import './welcome.css';

interface TimeOption {
  label: string;
  sublabel: string;
  months: number | null;
  custom?: true;
}

const OPTIONS: TimeOption[] = [
  { label: '近 1 个月', sublabel: '最近 30 天的聊天', months: 1 },
  { label: '近 3 个月', sublabel: '最近 90 天的聊天', months: 3 },
  { label: '近 6 个月', sublabel: '最近半年的聊天', months: 6 },
  { label: '近 1 年', sublabel: '最近 365 天的聊天', months: 12 },
  { label: '全部数据', sublabel: '分析所有历史聊天记录', months: null },
  { label: '自定义范围', sublabel: '指定起止日期', months: 0, custom: true },
];

interface WelcomePageProps {
  onStart: (from: number | null, to: number | null, label: string) => void;
  loading: boolean;
  isAppMode?: boolean;
}

export const WelcomePage: React.FC<WelcomePageProps> = ({ onStart, loading, isAppMode = false }) => {
  const [selected, setSelected] = useState(2);
  const today = new Date().toISOString().slice(0, 10);
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState(today);

  const handleStart = () => {
    const opt = OPTIONS[selected];
    if (opt.custom) {
      const from = customFrom ? Math.floor(new Date(customFrom).getTime() / 1000) : null;
      const to = customTo ? Math.floor(new Date(customTo).getTime() / 1000) + 86399 : null;
      const label = customFrom ? `${customFrom} ~ ${customTo || '至今'}` : `至 ${customTo}`;
      onStart(from, to, label);
    } else if (opt.months === null) {
      onStart(null, null, opt.label);
    } else {
      onStart(Math.floor(Date.now() / 1000) - opt.months * 30 * 86400, null, opt.label);
    }
  };

  return <main className="welcome-page">
    <div className="welcome-shell">
      <header className="welcome-header">
        <div className="welcome-brand"><img src="/favicon.svg" alt="" /><div><strong>WeLink</strong><span>让每段关系被看见</span></div></div>
        <a className="welcome-github" href="https://github.com/runzhliu/WeLink" target="_blank" rel="noopener noreferrer"><Github size={15} /> GitHub <ExternalLink size={12} /></a>
      </header>

      <div className="welcome-intro"><span className="welcome-eyebrow">开始使用 WELINK</span><h1>从聊天记录里，读懂关系。</h1><p>选择想要分析的时间范围，准备好数据后就可以开始。</p></div>

      <div className="welcome-layout">
        <section className="welcome-panel welcome-range" aria-labelledby="welcome-range-title">
          <div className="welcome-panel-heading"><div className="welcome-heading-icon"><CalendarDays size={18} /></div><div><h2 id="welcome-range-title">选择分析时间范围</h2><p>范围越小，首次分析通常越快。进入后可随时更改。</p></div></div>
          <div className="welcome-options" role="radiogroup" aria-label="分析时间范围" onKeyDown={event => {
            if (!['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? OPTIONS.length - 1 : (selected + (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1) + OPTIONS.length) % OPTIONS.length;
            setSelected(next);
            event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
          }}>
            {OPTIONS.map((opt, i) => <button key={opt.label} type="button" role="radio" aria-checked={selected === i} tabIndex={selected === i ? 0 : -1} disabled={loading} onClick={() => setSelected(i)} className={`welcome-option ${selected === i ? 'is-selected' : ''}`}>
              <span><strong>{opt.label}</strong><small>{opt.sublabel}</small></span><span className="welcome-radio" aria-hidden="true"><span /></span>
            </button>)}
          </div>
          {OPTIONS[selected].custom && <div className="welcome-dates">
            <div><label htmlFor="welcome-start-date">开始日期</label><DatePicker id="welcome-start-date" aria-label="开始日期" value={customFrom} onValueChange={setCustomFrom} max={customTo || today} /><small>留空则从最早开始</small></div>
            <div><label htmlFor="welcome-end-date">结束日期</label><DatePicker id="welcome-end-date" aria-label="结束日期" value={customTo} onValueChange={setCustomTo} min={customFrom || undefined} max={today} /><small>留空则到今天</small></div>
          </div>}
          <button type="button" className="ui-button ui-button-primary welcome-start" onClick={handleStart} disabled={loading}>
            {loading ? <><Loader2 size={16} className="animate-spin" />正在建立索引…</> : <>开始分析 <ArrowRight size={16} /></>}
          </button>
        </section>

        <div className="welcome-side">
          <section className="welcome-panel" aria-labelledby="welcome-guide-title">
            <div className="welcome-panel-heading"><div className="welcome-heading-icon"><Database size={18} /></div><div><h2 id="welcome-guide-title">使用前准备</h2><p>使用已解密的微信聊天数据库。</p></div></div>
            <ol className="welcome-steps">
              <li><span>1</span><div><strong>将聊天记录同步到电脑</strong><p>在手机微信的「聊天记录迁移与备份」中迁移，获得更完整的历史记录。</p></div></li>
              <li><span>2</span><div><strong>选择兼容的解密工具</strong><p>解密方式取决于系统和微信版本，部分工具需要电脑微信保持运行。原 wechat-decrypt 项目目前不可用，以下社区项目可供参考，其输出与 WeLink 的兼容性尚未验证。</p><a href="https://github.com/WeinanHu/wechat-decrypt" target="_blank" rel="noopener noreferrer">查看社区工具 <ExternalLink size={12} /></a><p>请先核对工具来源、权限与使用说明，并留意密钥和明文数据库的保存位置。</p></div></li>
              <li><span>3</span><div><strong>准备解密后的数据库</strong><div className="welcome-code"><Database size={14} /><code>decrypted/<br />├── contact/contact.db<br />└── message/message_*.db</code></div><p>{isAppMode ? 'App 模式下，可在设置中选择任意位置的 decrypted/ 目录。' : 'Docker 模式下，将 decrypted/ 放在项目仓库根目录内。'}</p></div></li>
              {!isAppMode && <li><span>4</span><div><strong>启动 WeLink</strong><div className="welcome-code"><Terminal size={14} /><code>docker compose up</code></div><p>访问 localhost:3418 即可开始分析。</p></div></li>}
            </ol>
          </section>
          <section className="welcome-note" aria-label="数据安全"><ShieldCheck size={17} /><div><strong>你的数据由你掌控</strong><p>请仅处理有权使用的聊天数据。基础分析在运行 WeLink 的设备上处理；使用云端 AI 或远程 GPU 训练时，相关内容会发送到你选择的服务或训练环境。</p></div></section>
          <div className="welcome-platform"><Monitor size={15} /><span>桌面 App 支持 macOS 12+ 和 Windows 10+</span></div>
        </div>
      </div>
    </div>
  </main>;
};
