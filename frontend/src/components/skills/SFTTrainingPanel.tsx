import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Cpu, Loader2,
  Play, RefreshCw, Square, Terminal, Trash2,
} from 'lucide-react';
import {
  sftApi,
  type SFTEnvironment,
  type SFTTrainingJob,
  type SkillRecord,
  type SubmitSFTTrainingRequest,
} from '../../services/api';
import { RevealLink } from '../common/RevealLink';
import { RelativeTime } from '../common/RelativeTime';

interface Props {
  datasets: SkillRecord[];
  privacyMode: boolean;
}

const statusMeta: Record<SFTTrainingJob['status'], { label: string; className: string }> = {
  queued: { label: '排队中', className: 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300' },
  running: { label: '训练中', className: 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-300' },
  succeeded: { label: '已完成', className: 'bg-[#07c160]/10 text-[#07c160]' },
  failed: { label: '失败', className: 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-300' },
  canceled: { label: '已取消', className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
};

const errorText = (error: unknown, fallback: string) => {
  const typed = error as { response?: { data?: { error?: string } }; message?: string };
  return typed.response?.data?.error || typed.message || fallback;
};

const gpuMemory = (mb?: number) => {
  if (!mb) return '';
  return `${(mb / 1024).toFixed(mb >= 10240 ? 0 : 1)} GB`;
};

export const SFTTrainingPanel: React.FC<Props> = ({ datasets, privacyMode }) => {
  const [environment, setEnvironment] = useState<SFTEnvironment | null>(null);
  const [jobs, setJobs] = useState<SFTTrainingJob[]>([]);
  const [loadingEnvironment, setLoadingEnvironment] = useState(true);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [environmentError, setEnvironmentError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [selectedSkillID, setSelectedSkillID] = useState('');
  const [model, setModel] = useState('Qwen/Qwen3-4B-Instruct-2507');
  const [epochs, setEpochs] = useState(2);
  const [learningRate, setLearningRate] = useState(0.0001);
  const [loraRank, setLoraRank] = useState(16);
  const [maxLength, setMaxLength] = useState(1024);
  const [batchSize, setBatchSize] = useState(1);
  const [gradientAccumulation, setGradientAccumulation] = useState(16);
  const [dtype, setDType] = useState<'bfloat16' | 'float16' | 'float32'>('bfloat16');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [cancelingID, setCancelingID] = useState<string | null>(null);
  const [deletingID, setDeletingID] = useState<string | null>(null);
  const [expandedJobID, setExpandedJobID] = useState<string | null>(null);
  const [logText, setLogText] = useState('');
  const logOffsetRef = useRef(0);
  const logLoadingRef = useRef(false);

  const availableDatasets = useMemo(
    () => datasets.filter(item => item.status === 'success' && item.format === 'lora-jsonl'),
    [datasets],
  );

  useEffect(() => {
    if (availableDatasets.length === 0) {
      setSelectedSkillID('');
      return;
    }
    if (!availableDatasets.some(item => item.id === selectedSkillID)) {
      setSelectedSkillID(availableDatasets[0].id);
    }
  }, [availableDatasets, selectedSkillID]);

  const loadEnvironment = useCallback(async () => {
    setLoadingEnvironment(true);
    setEnvironmentError(null);
    try {
      setEnvironment(await sftApi.environment());
    } catch (error) {
      setEnvironmentError(errorText(error, '环境检测失败'));
    } finally {
      setLoadingEnvironment(false);
    }
  }, []);

  const loadJobs = useCallback(async (silent = false) => {
    if (!silent) setLoadingJobs(true);
    try {
      setJobs(await sftApi.listJobs());
    } catch (error) {
      if (!silent) setActionError(errorText(error, '训练任务加载失败'));
    } finally {
      if (!silent) setLoadingJobs(false);
    }
  }, []);

  useEffect(() => {
    void loadEnvironment();
    void loadJobs();
  }, [loadEnvironment, loadJobs]);

  const hasActiveJob = jobs.some(job => job.status === 'queued' || job.status === 'running');
  useEffect(() => {
    if (!hasActiveJob) return;
    const timer = window.setInterval(() => void loadJobs(true), 2000);
    return () => window.clearInterval(timer);
  }, [hasActiveJob, loadJobs]);

  const appendLog = useCallback(async (jobID: string) => {
    if (logLoadingRef.current) return;
    logLoadingRef.current = true;
    try {
      let loops = 0;
      let truncated = true;
      while (truncated && loops < 8) {
        const chunk = await sftApi.getLog(jobID, logOffsetRef.current);
        if (chunk.content) setLogText(previous => previous + chunk.content);
        logOffsetRef.current = chunk.next_offset;
        truncated = chunk.truncated;
        loops++;
      }
    } catch (error) {
      setActionError(errorText(error, '日志读取失败'));
    } finally {
      logLoadingRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!expandedJobID) return;
    setLogText('');
    logOffsetRef.current = 0;
    void appendLog(expandedJobID);
    const timer = window.setInterval(() => void appendLog(expandedJobID), 2000);
    return () => window.clearInterval(timer);
  }, [expandedJobID, appendLog]);

  const startTraining = async () => {
    if (!selectedSkillID || !environment?.ms_swift_installed) return;
    const dataset = availableDatasets.find(item => item.id === selectedSkillID);
    if (!dataset) return;
    if (!window.confirm(`开始训练「${dataset.target_name}」？\n\n模型：${model}\n训练会持续占用 GPU，关闭页面不会停止任务。`)) return;
    setSubmitting(true);
    setActionError(null);
    const request: SubmitSFTTrainingRequest = {
      skill_id: selectedSkillID,
      model,
      epochs,
      learning_rate: learningRate,
      lora_rank: loraRank,
      max_length: maxLength,
      batch_size: batchSize,
      gradient_accumulation: gradientAccumulation,
      dtype,
    };
    try {
      const job = await sftApi.createJob(request);
      setJobs(previous => [job, ...previous]);
      setExpandedJobID(job.id);
    } catch (error) {
      setActionError(errorText(error, '启动训练失败'));
    } finally {
      setSubmitting(false);
    }
  };

  const cancelJob = async (job: SFTTrainingJob) => {
    if (!window.confirm(`停止「${job.dataset_name}」的训练？已产生的 checkpoint 会保留，之后可删除任务彻底清理。`)) return;
    setCancelingID(job.id);
    setActionError(null);
    try {
      await sftApi.cancelJob(job.id);
      await loadJobs(true);
    } catch (error) {
      setActionError(errorText(error, '取消训练失败'));
    } finally {
      setCancelingID(null);
    }
  };

  const deleteJob = async (job: SFTTrainingJob) => {
    if (!window.confirm(`彻底删除「${job.dataset_name}」的训练任务？\n\n训练日志、解包的数据副本、checkpoint 和 adapter 都会删除，无法恢复。`)) return;
    setDeletingID(job.id);
    setActionError(null);
    try {
      await sftApi.deleteJob(job.id);
      setJobs(previous => previous.filter(item => item.id !== job.id));
      if (expandedJobID === job.id) setExpandedJobID(null);
    } catch (error) {
      setActionError(errorText(error, '删除训练任务失败'));
    } finally {
      setDeletingID(null);
    }
  };

  return (
    <section className="mb-6 rounded-2xl border border-purple-200/80 dark:border-purple-800/50 bg-gradient-to-br from-purple-50/80 to-white dark:from-purple-950/20 dark:to-white/[0.02] overflow-hidden">
      <div className="px-5 py-4 border-b border-purple-100 dark:border-purple-900/40">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-black text-lg dk-text flex items-center gap-2"><Cpu size={19} className="text-purple-500" />本地 SFT 训练</h2>
            <p className="text-xs text-gray-400 mt-0.5">由 WeLink 管理 ms-swift 进程；数据、日志和 adapter 留在本机</p>
          </div>
          <button onClick={() => void loadEnvironment()} disabled={loadingEnvironment}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-white dark:bg-white/10 border border-purple-100 dark:border-purple-800 text-purple-600 disabled:opacity-50">
            <RefreshCw size={12} className={loadingEnvironment ? 'animate-spin' : ''} />重新检测
          </button>
        </div>
      </div>

      <div className="p-5 space-y-5">
        {environmentError ? (
          <div className="text-xs text-red-500 flex items-start gap-2"><AlertTriangle size={14} className="mt-0.5 shrink-0" />{environmentError}</div>
        ) : loadingEnvironment ? (
          <div className="text-xs text-gray-400 flex items-center gap-2"><Loader2 size={14} className="animate-spin" />正在检查 ms-swift、PyTorch 和 GPU…</div>
        ) : environment && (
          <div className="grid sm:grid-cols-3 gap-2">
            <div className="rounded-xl bg-white/80 dark:bg-white/5 border border-gray-100 dark:border-white/5 p-3">
              <div className="text-[10px] uppercase tracking-wider text-gray-400 font-bold">ms-swift</div>
              <div className={`mt-1 text-xs font-bold flex items-center gap-1.5 ${environment.ms_swift_installed ? 'text-[#07c160]' : 'text-red-500'}`}>
                {environment.ms_swift_installed ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
                {environment.ms_swift_installed ? environment.ms_swift_version || '已安装' : '未安装或命令冲突'}
              </div>
              {environment.ms_swift_path && <div className="text-[9px] text-gray-300 truncate mt-1" title={environment.ms_swift_path}>{environment.ms_swift_path}</div>}
            </div>
            <div className="rounded-xl bg-white/80 dark:bg-white/5 border border-gray-100 dark:border-white/5 p-3">
              <div className="text-[10px] uppercase tracking-wider text-gray-400 font-bold">PyTorch</div>
              <div className="mt-1 text-xs font-bold dk-text">{environment.torch_version || '未检测到'}</div>
              <div className="text-[9px] text-gray-300 mt-1">CUDA {environment.cuda_available ? '可用' : '不可用'} · {environment.os}/{environment.arch}</div>
            </div>
            <div className="rounded-xl bg-white/80 dark:bg-white/5 border border-gray-100 dark:border-white/5 p-3">
              <div className="text-[10px] uppercase tracking-wider text-gray-400 font-bold">Accelerator</div>
              <div className="mt-1 text-xs font-bold dk-text truncate">
                {environment.gpus.length > 0 ? environment.gpus.map(gpu => `${gpu.name}${gpuMemory(gpu.memory_total_mb) ? ` · ${gpuMemory(gpu.memory_total_mb)}` : ''}`).join(', ') : '未检测到 NVIDIA GPU'}
              </div>
              {environment.gpus[0]?.driver_version && <div className="text-[9px] text-gray-300 mt-1">Driver {environment.gpus[0].driver_version}</div>}
            </div>
          </div>
        )}

        {environment?.warnings && environment.warnings.length > 0 && (
          <div className="rounded-xl bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/50 p-3 text-[11px] text-amber-700 dark:text-amber-300 space-y-1">
            {environment.warnings.map((warning, index) => <div key={index}>• {warning}</div>)}
            {!environment.ms_swift_installed && <div className="pt-1 font-mono text-[10px]">pip install -U ms-swift</div>}
          </div>
        )}

        <div className="grid sm:grid-cols-[1fr_1fr_auto] gap-3 items-end">
          <label className="block min-w-0">
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">训练数据集</span>
            <select value={selectedSkillID} onChange={event => setSelectedSkillID(event.target.value)}
              className={`mt-1 w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dk-card px-3 py-2 text-xs focus:outline-none focus:border-purple-400 ${privacyMode ? 'privacy-blur' : ''}`}>
              {availableDatasets.length === 0 && <option value="">先导出一个 SFT 数据集</option>}
              {availableDatasets.map(item => <option key={item.id} value={item.id}>{item.target_name} · {item.msg_limit} 条上限</option>)}
            </select>
          </label>
          <label className="block min-w-0">
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">基础模型</span>
            <input value={model} onChange={event => setModel(event.target.value)}
              className="mt-1 w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dk-card px-3 py-2 text-xs font-mono focus:outline-none focus:border-purple-400" />
          </label>
          <button onClick={() => void startTraining()}
            disabled={submitting || !selectedSkillID || !environment?.ms_swift_installed || !model.trim()}
            className="h-[34px] inline-flex items-center justify-center gap-1.5 px-4 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold disabled:opacity-40 disabled:hover:bg-purple-600">
            {submitting ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
            开始训练
          </button>
        </div>

        <div>
          <button onClick={() => setShowAdvanced(value => !value)} className="text-[11px] font-bold text-purple-600 inline-flex items-center gap-1">
            {showAdvanced ? <ChevronUp size={12} /> : <ChevronDown size={12} />}训练参数
          </button>
          {showAdvanced && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2">
              <ParameterNumber label="Epochs" value={epochs} onChange={setEpochs} min={0.1} max={10} step={0.5} />
              <ParameterNumber label="Learning rate" value={learningRate} onChange={setLearningRate} min={0.0000001} max={0.01} step={0.00001} />
              <ParameterSelect label="LoRA rank" value={String(loraRank)} onChange={value => setLoraRank(Number(value))} options={['4', '8', '16', '32', '64', '128']} />
              <ParameterSelect label="Max length" value={String(maxLength)} onChange={value => setMaxLength(Number(value))} options={['512', '1024', '2048', '4096', '8192']} />
              <ParameterSelect label="Batch size / GPU" value={String(batchSize)} onChange={value => setBatchSize(Number(value))} options={['1', '2', '4', '8']} />
              <ParameterSelect label="Gradient accumulation" value={String(gradientAccumulation)} onChange={value => setGradientAccumulation(Number(value))} options={['4', '8', '16', '32', '64']} />
              <ParameterSelect label="DType" value={dtype} onChange={value => setDType(value as typeof dtype)} options={['bfloat16', 'float16', 'float32']} />
            </div>
          )}
        </div>

        {actionError && <div className="rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-3 text-xs text-red-500">{actionError}</div>}

        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-black dk-text flex items-center gap-1.5"><Terminal size={14} />训练任务</h3>
            {loadingJobs && <Loader2 size={13} className="animate-spin text-gray-300" />}
          </div>
          {!loadingJobs && jobs.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-200 dark:border-gray-700 py-6 text-center text-xs text-gray-400">还没有训练任务</div>
          ) : (
            <div className="space-y-2">
              {jobs.map(job => {
                const active = job.status === 'queued' || job.status === 'running';
                const expanded = expandedJobID === job.id;
                const meta = statusMeta[job.status];
                return (
                  <div key={job.id} className="rounded-xl bg-white/80 dark:bg-white/5 border border-gray-100 dark:border-white/5 overflow-hidden">
                    <div className="p-3 flex flex-wrap items-center gap-3">
                      <button onClick={() => setExpandedJobID(expanded ? null : job.id)} className="text-gray-400 hover:text-purple-500">
                        {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                      </button>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-bold dk-text truncate ${privacyMode ? 'privacy-blur' : ''}`}>{job.dataset_name}</span>
                          <span className={`shrink-0 px-2 py-0.5 rounded-full text-[9px] font-bold inline-flex items-center gap-1 ${meta.className}`}>
                            {job.status === 'running' && <Loader2 size={9} className="animate-spin" />}{meta.label}
                          </span>
                        </div>
                        <div className="text-[9px] text-gray-400 mt-0.5 truncate">{job.model} · rank {job.lora_rank} · {job.epochs} epochs · <RelativeTime ts={job.created_at} /></div>
                      </div>
                      {active ? (
                        <button onClick={() => void cancelJob(job)} disabled={cancelingID === job.id}
                          className="p-1.5 rounded-lg text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/20 disabled:opacity-50" title="停止训练">
                          {cancelingID === job.id ? <Loader2 size={14} className="animate-spin" /> : <Square size={14} />}
                        </button>
                      ) : (
                        <button onClick={() => void deleteJob(job)} disabled={deletingID === job.id}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50" title="删除任务和全部训练文件">
                          {deletingID === job.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                        </button>
                      )}
                    </div>
                    {expanded && (
                      <div className="border-t border-gray-100 dark:border-white/5 p-3 space-y-2">
                        {job.error_msg && <div className="text-[11px] text-red-500">{job.error_msg}</div>}
                        {job.adapter_path && (
                          <div className="text-[10px] text-[#07c160] break-all">
                            Adapter：<span className={privacyMode ? 'privacy-blur' : ''}>{job.adapter_path}</span>
                            <RevealLink path={job.adapter_path} label="打开" className="ml-2" />
                          </div>
                        )}
                        <pre className="max-h-72 overflow-auto rounded-lg bg-[#111827] text-gray-200 p-3 text-[10px] leading-relaxed whitespace-pre-wrap break-all font-mono">
                          {logText || (active ? '等待训练日志…' : '没有训练日志')}
                        </pre>
                      </div>
                    )}
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

const fieldClass = 'mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dk-card px-2 py-1.5 text-[11px] focus:outline-none focus:border-purple-400';

const ParameterNumber: React.FC<{ label: string; value: number; onChange: (value: number) => void; min: number; max: number; step: number }> =
  ({ label, value, onChange, min, max, step }) => (
    <label className="block">
      <span className="text-[9px] font-bold text-gray-400 uppercase">{label}</span>
      <input type="number" value={value} min={min} max={max} step={step} onChange={event => onChange(Number(event.target.value))} className={fieldClass} />
    </label>
  );

const ParameterSelect: React.FC<{ label: string; value: string; onChange: (value: string) => void; options: string[] }> =
  ({ label, value, onChange, options }) => (
    <label className="block">
      <span className="text-[9px] font-bold text-gray-400 uppercase">{label}</span>
      <select value={value} onChange={event => onChange(event.target.value)} className={fieldClass}>
        {options.map(option => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
  );
