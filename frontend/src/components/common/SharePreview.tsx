import { useState } from 'react';
import { Dialog } from './Dialog';
import { downloadPng, generateShareImage, type ShareImageOptions } from '../../utils/shareImage';

/** Preview and download exactly the same rendered image, with editable share content. */
export function SharePreview({ options, onClose }: { options: ShareImageOptions; onClose: () => void }) {
  const [question, setQuestion] = useState(options.question || '');
  const [answer, setAnswer] = useState(options.answer);
  const [hideName, setHideName] = useState(true);
  const [hideAvatar, setHideAvatar] = useState(true);
  const [hideDate, setHideDate] = useState(true);
  const [image, setImage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const invalidate = () => { setImage(''); setSaved(''); };
  const render = async () => {
    setBusy(true); setError(''); setImage('');
    try { setImage(await generateShareImage({ question, answer, contactName: hideName ? undefined : options.contactName, avatarUrl: options.avatarUrl, hideAvatar, stats: options.stats ? { ...options.stats, timestamp: hideDate ? undefined : options.stats.timestamp } : undefined }, true)); }
    catch (e) { setError(e instanceof Error ? e.message : '生成预览失败'); }
    finally { setBusy(false); }
  };
  const save = async () => {
    setBusy(true); setError('');
    try { setSaved(await downloadPng(image, `welink-share-${Date.now()}.png`)); }
    catch (e) { setError(e instanceof Error ? e.message : '保存失败'); }
    finally { setBusy(false); }
  };
  return <Dialog open title="分享图片预览" onClose={onClose} className="max-w-4xl"><div className="grid gap-4 md:grid-cols-2"><div className="space-y-3"><p className="text-xs text-gray-500">可修改分享内容，原对话不会改变。请逐项检查正文中仍可能出现的姓名、日期和隐私信息。</p><label className="block text-xs font-semibold">问题<textarea aria-label="分享问题" className="dk-input mt-1 w-full" rows={2} value={question} onChange={e => { setQuestion(e.target.value); invalidate(); }} /></label><label className="block text-xs font-semibold">回答<textarea aria-label="分享回答" className="dk-input mt-1 w-full" rows={8} value={answer} onChange={e => { setAnswer(e.target.value); invalidate(); }} /></label><div className="flex flex-wrap gap-3 text-xs"><label><input type="checkbox" checked={hideName} onChange={e => { setHideName(e.target.checked); invalidate(); }} /> 隐藏标题姓名</label><label><input type="checkbox" checked={hideAvatar} onChange={e => { setHideAvatar(e.target.checked); invalidate(); }} /> 隐藏头像</label><label><input type="checkbox" checked={hideDate} onChange={e => { setHideDate(e.target.checked); invalidate(); }} /> 隐藏生成时间</label></div><button type="button" className="ui-button ui-button-secondary" disabled={busy || !answer.trim()} onClick={() => void render()}>{busy ? '处理中…' : '生成图片预览'}</button>{image && <button type="button" className="ui-button ui-button-primary ml-2" disabled={busy} onClick={() => void save()}>下载预览图片</button>}{error && <p role="alert" className="text-xs text-red-600">{error}</p>}{saved && <p role="status" className="text-xs text-green-700">已保存：{saved}</p>}</div><div className="max-h-[65vh] overflow-auto rounded-lg bg-gray-100 p-2">{image ? <img src={image} alt="分享图片预览" className="w-full h-auto" /> : <p className="p-4 text-xs text-gray-500">选择要隐藏的内容后，生成图片预览。</p>}</div></div></Dialog>;
}
