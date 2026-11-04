import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, ChevronDown, ChevronUp, FlaskConical, Loader2, Play,
  Server, Square, Terminal, Trash2,
} from 'lucide-react';
import {
  sftApi,
  type SFTEvaluationResult,
  type SFTDeployment,
  type SFTTrainingJob,
} from '../../services/api';
import { RelativeTime } from '../common/RelativeTime';

interface Props {
  privacyMode: boolean;
}

const deploymentStatus: Record<SFTDeployment['status'], { label: string; className: string }> = {
  starting: { label: '启动中', className: 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-300' },
  running: { label: '服务中', className: 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-300' },
  stopped: { label: '已停止', className: 'bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-gray-300' },
  failed: { label: '失败', className: 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-300' },
};

const errorText = (error: unknown, fallback: string) => {
  const typed = error as { response?: { data?: { error?: string } }; message?: string };
  return typed.response?.data?.error || typed.message || fallback;
};

export const SFTDeploymentPanel: React.FC<Props> = ({ privacyMode }) => {
  const [jobs, setJobs] = useState<SFTTrainingJob[]>([]);
  const [deployments, setDeployments] = useState<SFTDeployment[]>([]);
  const [selectedJobID, setSelectedJobID] = useState('');
  const [backend, setBackend] = useState<'transformers' | 'vllm'>('transformers');
  const [port, setPort] = useState(8000);
  const [gpu, setGPU] = useState(0);
  const [servedModel, setServedModel] = useState('');
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [stoppingID, setStoppingID] = useState<string | null>(null);
  const [deletingID, setDeletingID] = useState<string | null>(null);
  const [expandedID, setExpandedID] = useState<string | null>(null);
  const [logText, setLogText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [evaluatingID, setEvaluatingID] = useState<string | null>(null);
  const [evaluation, setEvaluation] = useState<SFTEvaluationResult | null>(null);
  const logOffset = useRef(0);
  const logLoading = useRef(false);

  const successfulJobs = useMemo(() => jobs.filter(job => job.status === 'succeeded' && job.adapter_path), [jobs]);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [nextJobs, nextDeployments] = await Promise.all([sftApi.listJobs(), sftApi.listDeployments()]);
      setJobs(nextJobs);
      setDeployments(nextDeployments);
    } catch (loadError) {
      if (!silent) setError(errorText(loadError, '部署信息加载失败'));
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!successfulJobs.length) {
      setSelectedJobID('');
    } else if (!successfulJobs.some(job => job.id === selectedJobID)) {
      setSelectedJobID(successfulJobs[0].id);
    }
  }, [successfulJobs, selectedJobID]);

  const hasActive = deployments.some(item => item.status === 'starting' || item.status === 'running');
  useEffect(() => {
    if (!hasActive) return;
    const timer = window.setInterval(() => void load(true), 2000);
    return () => window.clearInterval(timer);
  }, [hasActive, load]);

  const appendLog = useCallback(async (id: string) => {
    if (logLoading.current) return;
    logLoading.current = true;
    try {
      const chunk = await sftApi.getDeploymentLog(id, logOffset.current);
      if (chunk.content) setLogText(previous => previous + chunk.content);
      logOffset.current = chunk.next_offset;
    } catch (logError) {
      setError(errorText(logError, '部署日志读取失败'));
    } finally {
      logLoading.current = false;
    }
  }, []);

  useEffect(() => {
    if (!expandedID) return;
    setLogText('');
    setEvaluation(null);
    logOffset.current = 0;
    void appendLog(expandedID);
    const timer = window.setInterval(() => void appendLog(expandedID), 2000);
    return () => window.clearInterval(timer);
  }, [expandedID, appendLog]);

  const start = async () => {
    const job = successfulJobs.find(item => item.id === selectedJobID);
    if (!job) return;
    if (!window.confirm(`启动「${job.dataset_name}」的本地推理服务？\n\n监听：127.0.0.1:${port}\nGPU：${gpu}\n服务会持续占用显存，关闭页面不会停止。`)) return;
    setStarting(true);
    setError(null);
    try {
      const created = await sftApi.createDeployment({
        training_job_id: job.id, backend, port, gpu,
        served_model: servedModel.trim() || undefined,
      });
      setDeployments(previous => [created, ...previous]);
      setExpandedID(created.id);
    } catch (startError) {
      setError(errorText(startError, '启动部署失败'));
    } finally {
      setStarting(false);
    }
  };

  const stop = async (deployment: SFTDeployment) => {
    if (!window.confirm(`停止「${deployment.target_name}」的推理服务？正在进行的对话会中断。`)) return;
    setStoppingID(deployment.id);
    try {
      await sftApi.stopDeployment(deployment.id);
      await load(true);
    } catch (stopError) {
      setError(errorText(stopError, '停止部署失败'));
    } finally {
      setStoppingID(null);
    }
  };

  const remove = async (deployment: SFTDeployment) => {
    if (!window.confirm(`删除「${deployment.target_name}」的部署记录和日志？\n\nAdapter 与训练任务不会删除。`)) return;
    setDeletingID(deployment.id);
    try {
      await sftApi.deleteDeployment(deployment.id);
      setDeployments(previous => previous.filter(item => item.id !== deployment.id));
      if (expandedID === deployment.id) setExpandedID(null);
    } catch (deleteError) {
      setError(errorText(deleteError, '删除部署失败'));
    } finally {
      setDeletingID(null);
    }
  };

  const evaluate = async (deployment: SFTDeployment) => {
    setEvaluatingID(deployment.id);
    setEvaluation(null);
    setError(null);
    try {
      setEvaluation(await sftApi.evaluateDeployment(deployment.id, 5));
    } catch (evaluationError) {
      setError(errorText(evaluationError, '基线评估失败'));
    } finally {
      setEvaluatingID(null);
    }
  };

  return (
    <section className="mb-6 rounded-2xl border border-blue-200/80 dark:border-blue-800/50 bg-gradient-to-br from-blue-50/70 to-white dark:from-blue-950/20 dark:to-white/[0.02] overflow-hidden">
      <div className="px-5 py-4 border-b border-blue-100 dark:border-blue-900/40">
        <h2 className="font-black text-lg dk-text flex items-center gap-2"><Server size={19} className="text-blue-500" />Adapter 部署与评估</h2>
        <p className="text-xs text-gray-400 mt-0.5">启动仅监听本机的 OpenAI 兼容服务，并用留出的测试集做小样本基线</p>
      </div>
      <div className="p-5 space-y-5">
        <div className="grid sm:grid-cols-[minmax(0,1.5fr)_110px_90px_90px_minmax(0,1fr)_auto] gap-2 items-end">
          <label className="block min-w-0">
            <span className="text-[9px] font-bold text-gray-400 uppercase">已训练 Adapter</span>
            <select value={selectedJobID} onChange={event => setSelectedJobID(event.target.value)} className={`mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dk-card px-2 py-2 text-[11px] ${privacyMode ? 'privacy-blur' : ''}`}>
              {!successfulJobs.length && <option value="">先完成一个训练任务</option>}
              {successfulJobs.map(job => <option key={job.id} value={job.id}>{job.dataset_name} · {job.model}</option>)}
            </select>
          </label>
          <label className="block"><span className="text-[9px] font-bold text-gray-400 uppercase">推理后端</span>
            <select value={backend} onChange={event => setBackend(event.target.value as typeof backend)} className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dk-card px-2 py-2 text-[11px]"><option value="transformers">transformers</option><option value="vllm">vLLM</option></select>
          </label>
          <label className="block"><span className="text-[9px] font-bold text-gray-400 uppercase">端口</span><input type="number" min={1024} max={65535} value={port} onChange={event => setPort(Number(event.target.value))} className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dk-card px-2 py-2 text-[11px]" /></label>
          <label className="block"><span className="text-[9px] font-bold text-gray-400 uppercase">GPU</span><input type="number" min={0} max={127} value={gpu} onChange={event => setGPU(Number(event.target.value))} className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dk-card px-2 py-2 text-[11px]" /></label>
          <label className="block min-w-0"><span className="text-[9px] font-bold text-gray-400 uppercase">服务模型名（可选）</span><input value={servedModel} onChange={event => setServedModel(event.target.value)} placeholder="welink-sft-me" className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dk-card px-2 py-2 text-[11px] font-mono" /></label>
          <button onClick={() => void start()} disabled={starting || !selectedJobID || port < 1024} className="h-[34px] inline-flex items-center justify-center gap-1.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold disabled:opacity-40">
            {starting ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}部署
          </button>
        </div>

        {backend === 'vllm' && <div className="text-[10px] text-amber-600">vLLM 吞吐更高，但需要额外安装兼容版本；量化 LoRA 不兼容时请用 transformers。</div>}
        {error && <div className="rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-3 text-xs text-red-500">{error}</div>}

        <div>
          <h3 className="text-xs font-black dk-text flex items-center gap-1.5 mb-2"><Activity size={14} />部署实例 {loading && <Loader2 size={12} className="animate-spin text-gray-300" />}</h3>
          {!loading && !deployments.length ? (
            <div className="rounded-xl border border-dashed border-gray-200 dark:border-gray-700 py-6 text-center text-xs text-gray-400">还没有部署记录</div>
          ) : (
            <div className="space-y-2">
              {deployments.map(deployment => {
                const active = deployment.status === 'starting' || deployment.status === 'running';
                const expanded = expandedID === deployment.id;
                const meta = deploymentStatus[deployment.status];
                return (
                  <div key={deployment.id} className="rounded-xl bg-white/80 dark:bg-white/5 border border-gray-100 dark:border-white/5 overflow-hidden">
                    <div className="p-3 flex items-center gap-3">
                      <button onClick={() => setExpandedID(expanded ? null : deployment.id)} className="text-gray-400 hover:text-blue-500">{expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}</button>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2"><span className={`text-xs font-bold dk-text truncate ${privacyMode ? 'privacy-blur' : ''}`}>{deployment.target_name}</span><span className={`px-2 py-0.5 rounded-full text-[9px] font-bold inline-flex items-center gap-1 ${meta.className}`}>{deployment.status === 'starting' && <Loader2 size={9} className="animate-spin" />}{meta.label}</span></div>
                        <div className="text-[9px] text-gray-400 mt-0.5 truncate">{deployment.served_model} · {deployment.backend} · 127.0.0.1:{deployment.port} · GPU {deployment.gpu} · <RelativeTime ts={deployment.created_at} /></div>
                      </div>
                      {deployment.status === 'running' && <button onClick={() => void evaluate(deployment)} disabled={evaluatingID === deployment.id} className="p-1.5 rounded-lg text-purple-500 hover:bg-purple-50 dark:hover:bg-purple-900/20" title="评估 5 条测试样本">{evaluatingID === deployment.id ? <Loader2 size={14} className="animate-spin" /> : <FlaskConical size={14} />}</button>}
                      {active ? <button onClick={() => void stop(deployment)} disabled={stoppingID === deployment.id} className="p-1.5 rounded-lg text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/20">{stoppingID === deployment.id ? <Loader2 size={14} className="animate-spin" /> : <Square size={14} />}</button> : <button onClick={() => void remove(deployment)} disabled={deletingID === deployment.id} className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20">{deletingID === deployment.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}</button>}
                    </div>
                    {expanded && <div className="border-t border-gray-100 dark:border-white/5 p-3 space-y-3">
                      {deployment.error_msg && <div className="text-[11px] text-red-500">{deployment.error_msg}</div>}
                      <div className="text-[10px] text-blue-600">API：<span className="font-mono">http://127.0.0.1:{deployment.port}/v1</span></div>
                      {evaluation && evaluation.deployment_id === deployment.id && <div className="rounded-lg border border-purple-100 dark:border-purple-900/40 p-3 space-y-2">
                        <div className="text-[11px] font-bold text-purple-600">测试集基线 · Bigram F1 {(evaluation.average_bigram_f1 * 100).toFixed(1)}% · 长度比 {evaluation.average_length_ratio.toFixed(2)}</div>
                        <div className="text-[9px] text-gray-400">{evaluation.note}</div>
                        {evaluation.samples.map((sample, index) => <details key={index} className={`text-[10px] ${privacyMode ? 'privacy-blur' : ''}`}><summary className="cursor-pointer text-gray-500">样本 {index + 1} · F1 {(sample.bigram_f1 * 100).toFixed(1)}%</summary><div className="mt-1 space-y-1"><div>问：{sample.prompt}</div><div className="text-green-600">真实：{sample.expected}</div><div className="text-blue-600">生成：{sample.generated || sample.error}</div></div></details>)}
                      </div>}
                      <div className="flex items-center gap-1 text-[10px] text-gray-400"><Terminal size={11} />部署日志</div>
                      <pre className="max-h-72 overflow-auto rounded-lg bg-[#111827] text-gray-200 p-3 text-[10px] leading-relaxed whitespace-pre-wrap break-all font-mono">{logText || (active ? '等待部署日志…' : '没有部署日志')}</pre>
                    </div>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  );
};
