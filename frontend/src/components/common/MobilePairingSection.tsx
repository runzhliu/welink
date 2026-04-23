/**
 * 移动端配对 —— PC 设置页的 section
 *
 * 流程：启用配对 → 生成随机 token → 以 http://局域网IP:3418/?server=...&token=...
 * 的形式画成二维码；手机扫码后前端自动存 serverURL + token，之后 axios
 * 请求都带 Authorization: Bearer。
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Smartphone, QrCode, RefreshCw, Loader2, Copy, Check, AlertCircle } from 'lucide-react';
import axios from 'axios';
import QRCode from 'qrcode';

interface PairingStatus {
  enabled: boolean;
  token?: string;
  lan_ips?: string[];
}

export const MobilePairingSection: React.FC = () => {
  const [status, setStatus] = useState<PairingStatus | null>(null);
  const [busy, setBusy] = useState<'' | 'enable' | 'regen' | 'disable'>('');
  const [selectedIP, setSelectedIP] = useState<string>('');
  const [qrDataURL, setQrDataURL] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState('');
  const qrRef = useRef<HTMLCanvasElement>(null);

  const pairingURL = useCallback((): string => {
    if (!status?.enabled || !status.token) return '';
    const ip = selectedIP || (status.lan_ips?.[0] ?? '127.0.0.1');
    // 使用同一个 3418（前端端口）+ query 参数；前端首开时会吸收 token
    return `http://${ip}:3418/?server=http://${ip}:3418&token=${status.token}`;
  }, [status, selectedIP]);

  const refreshStatus = useCallback(async () => {
    try {
      const r = await axios.get<PairingStatus>('/api/app/pairing/status');
      setStatus(r.data);
      if (r.data.lan_ips && r.data.lan_ips.length > 0 && !selectedIP) {
        setSelectedIP(r.data.lan_ips[0]);
      }
    } catch (e: unknown) {
      setErr((e as Error).message || '读取状态失败');
    }
  }, [selectedIP]);

  useEffect(() => { void refreshStatus(); }, [refreshStatus]);

  // 生成二维码
  useEffect(() => {
    const url = pairingURL();
    if (!url) { setQrDataURL(''); return; }
    QRCode.toDataURL(url, { width: 220, margin: 1, color: { dark: '#1d1d1f', light: '#ffffff' } })
      .then(setQrDataURL)
      .catch(() => setQrDataURL(''));
  }, [pairingURL]);

  const enable = async () => {
    setBusy('enable'); setErr('');
    try {
      const r = await axios.post<PairingStatus>('/api/app/pairing/enable');
      setStatus(r.data);
    } catch (e: unknown) {
      setErr((e as { response?: { data?: { error?: string } }; message?: string }).response?.data?.error
        || (e as Error).message || '启用失败');
    } finally { setBusy(''); }
  };
  const regen = async () => {
    if (!confirm('重新生成后，已配对的手机全部失效，需要重新扫码。确认？')) return;
    setBusy('regen'); setErr('');
    try {
      const r = await axios.post<PairingStatus>('/api/app/pairing/regen');
      setStatus(r.data);
    } catch (e: unknown) {
      setErr((e as { response?: { data?: { error?: string } }; message?: string }).response?.data?.error
        || (e as Error).message || '重新生成失败');
    } finally { setBusy(''); }
  };
  const disable = async () => {
    if (!confirm('关闭配对会让已配对的手机全部失效。确认？')) return;
    setBusy('disable'); setErr('');
    try {
      const r = await axios.post<PairingStatus>('/api/app/pairing/disable');
      setStatus(r.data);
    } catch (e: unknown) {
      setErr((e as { response?: { data?: { error?: string } }; message?: string }).response?.data?.error
        || (e as Error).message || '关闭失败');
    } finally { setBusy(''); }
  };

  const copyURL = async () => {
    const url = pairingURL();
    if (!url) return;
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* ignore */ }
  };

  return (
    <section className="mb-8" data-settings-tags="移动 手机 mobile android qr 二维码 配对 pairing">
      <div className="flex items-center gap-2 mb-3">
        <Smartphone size={18} className="text-[#07c160]" />
        <h3 className="text-base font-bold text-[#1d1d1f] dk-text">移动端配对（手机远程访问）</h3>
      </div>
      <p className="text-sm text-gray-400 mb-4">
        启用后，局域网里的手机浏览器 / App 扫描下面二维码就能作为 WeLink 的远程客户端查看分析 —— PC 保持运行，数据不离开本机。
        未启用时 API 完全放行（向后兼容老部署）。
      </p>

      <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-700/50 p-3 text-xs leading-relaxed text-amber-800 dark:text-amber-200">
        <div className="font-semibold mb-1">⚠️ 仅在信任的网络中使用</div>
        局域网通信是 <b>HTTP 明文</b>，同网段设备可被嗅探——咖啡馆、机场、公司访客 Wi-Fi 等不可信网络下请勿启用。
        推荐场景：家里 / 个人热点。<br/>
        二维码里含 token，不要截图分享。若二维码曾被他人看到，请点「重新生成 token」。
      </div>

      {!status ? (
        <div className="text-xs text-gray-400 flex items-center gap-1">
          <Loader2 size={12} className="animate-spin" /> 读取状态中…
        </div>
      ) : !status.enabled ? (
        <div className="flex items-center gap-3">
          <button
            onClick={enable}
            disabled={busy !== ''}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#07c160] text-white text-sm font-semibold hover:bg-[#06ad56] disabled:opacity-50"
          >
            {busy === 'enable' ? <Loader2 size={14} className="animate-spin" /> : <QrCode size={14} />}
            启用配对并生成二维码
          </button>
          <span className="text-[11px] text-gray-400">开启后所有外部 API 请求都需要带 token 才能访问</span>
        </div>
      ) : (
        <div className="rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-[#1c1c1e] p-4 space-y-4">
          <div className="flex items-start gap-4 flex-wrap">
            {/* QR */}
            <div className="flex-shrink-0">
              {qrDataURL ? (
                <img src={qrDataURL} alt="pairing QR" className="w-[220px] h-[220px] rounded-xl border border-gray-100 dark:border-white/10" />
              ) : (
                <div className="w-[220px] h-[220px] flex items-center justify-center text-gray-300">
                  <Loader2 size={20} className="animate-spin" />
                </div>
              )}
            </div>

            {/* 右侧详情 */}
            <div className="flex-1 min-w-0 space-y-3">
              {/* IP 选择 */}
              <div>
                <div className="text-[11px] text-gray-400 mb-1">局域网地址（手机需要和 PC 在同一网络）</div>
                <div className="flex flex-wrap gap-1.5">
                  {(status.lan_ips || []).map(ip => (
                    <button
                      key={ip}
                      onClick={() => setSelectedIP(ip)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-mono transition-colors ${
                        ip === selectedIP
                          ? 'bg-[#07c160] text-white'
                          : 'bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/10'
                      }`}
                    >
                      {ip}
                    </button>
                  ))}
                  {(!status.lan_ips || status.lan_ips.length === 0) && (
                    <span className="text-xs text-gray-400">没嗅到局域网 IP（docker 里可能需要 host 网络模式）</span>
                  )}
                </div>
              </div>

              {/* 链接 */}
              <div>
                <div className="text-[11px] text-gray-400 mb-1">扫码或复制以下链接到手机浏览器打开</div>
                <div className="flex items-stretch gap-2">
                  <input
                    readOnly
                    value={pairingURL()}
                    className="flex-1 min-w-0 text-xs font-mono border border-gray-200 dark:border-white/10 rounded-lg px-2 py-1.5 bg-gray-50 dark:bg-white/5 text-gray-700 dark:text-gray-300 dk-input"
                  />
                  <button
                    onClick={copyURL}
                    className="px-2 rounded-lg border border-gray-200 dark:border-white/10 text-gray-500 dark:text-gray-400 hover:text-[#07c160]"
                    title="复制链接"
                  >
                    {copied ? <Check size={14} className="text-[#07c160]" /> : <Copy size={14} />}
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={regen}
                  disabled={busy !== ''}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-white/10 text-xs text-gray-500 dark:text-gray-400 hover:text-[#07c160] disabled:opacity-50"
                >
                  {busy === 'regen' ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                  换新 token
                </button>
                <button
                  onClick={disable}
                  disabled={busy !== ''}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-red-200 dark:border-red-400/30 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-400/10 disabled:opacity-50"
                >
                  {busy === 'disable' ? <Loader2 size={12} className="animate-spin" /> : null}
                  关闭配对
                </button>
              </div>
            </div>
          </div>

          <div className="text-[11px] text-gray-400 leading-relaxed">
            <strong>提示：</strong>
            Docker 部署时确认 docker-compose.yml 里 frontend 端口映射是 <code>0.0.0.0:3418:80</code>（默认就是）；macOS / Windows App 模式需环境变量 <code>WELINK_LISTEN_LAN=1</code>。
            手机和 PC 必须在同一 Wi-Fi。token 仅保存在 PC preferences.json 里，二维码除了关机也不会自动过期。
          </div>
        </div>
      )}

      {err && (
        <div className="mt-3 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-xs">
          <AlertCircle size={14} /> {err}
        </div>
      )}
    </section>
  );
};

export default MobilePairingSection;
