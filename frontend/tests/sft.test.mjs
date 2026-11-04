import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, test } from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { Window } from 'happy-dom';

const window = new Window({ url: 'http://localhost/#/sft', width: 390, height: 844 });
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'Event', 'MouseEvent', 'PointerEvent', 'KeyboardEvent', 'ResizeObserver', 'localStorage']) globalThis[key] = key === 'window' ? window : window[key];
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: window.navigator });
globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
window.HTMLElement.prototype.getClientRects = function () { return [this.getBoundingClientRect()]; };
window.HTMLElement.prototype.getBoundingClientRect = function () { return { x: 20, y: 200, left: 20, right: 370, top: 200, bottom: 240, width: 350, height: 40 }; };
window.HTMLElement.prototype.scrollIntoView = function () {};
const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { Simulate } = await import('react-dom/test-utils');
const { act } = React;
const require = createRequire(import.meta.url);
for (const extension of ['.ts', '.tsx']) require.extensions[extension] = (module, filename) => { module._compile(ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }, fileName: filename }).outputText, filename); };
require.extensions['.css'] = () => {};
const { sftApi } = require('../src/services/sftApi.ts');
const { appApi } = require('../src/services/appApi.ts');
const { default: SFTPage, LossChart } = require('../src/components/sft/SFTPage.tsx');
const { PrivacyModeContext } = require('../src/contexts/PrivacyModeContext.tsx');
const original = { ...sftApi };
let root, state, calls;
const frozen = () => ({ id: 'ds_1', project_id: 'p_1', name: '已审核的版本', state: 'frozen', revision: 3, created_at: 1, pipeline: 'conversation-v1', sha256: 'a'.repeat(64), report: { raw: 2000, candidates: 1000, kept: 1000, unreviewed: 0, excluded: {}, splits: { train: 800, valid: 100, test: 100 }, contributions: { anon: 200 } } });
const worker = () => ({ id: 'w_1', project_id: 'p_1', name: '我的 Mac', revoked: false, last_seen: Date.now() / 1000, capabilities: { os: 'Darwin', arch: 'arm64', devices: [{ id: 'metal', name: 'Apple Silicon' }], engines: { mlx: { available: true } }, free_disk_bytes: 64 * 1024 ** 3 } });
beforeEach(() => {
  calls = []; state = { projects: [{ id: 'p_1', name: '我的沟通风格' }], datasets: [], workers: [], jobs: [], models: [], deployments: [] };
  appApi.getInfo = async () => ({ self_info: { nickname: '测试账号', avatar_url: '/avatar.png' } });
  sftApi.capabilities = async () => ({ owner: 'owner-1', protocol: 1 });
  sftApi.projects = async () => state.projects;
  sftApi.datasets = async () => state.datasets;
  sftApi.workers = async () => state.workers;
  sftApi.jobs = async () => state.jobs;
  sftApi.models = async () => ({ models: state.models, deployments: state.deployments });
  sftApi.events = async () => [];
  sftApi.checkpoints = async () => [];
});
afterEach(async () => { if (root) await act(async () => root.unmount()); root = undefined; document.body.replaceChildren(); Object.assign(sftApi, original); });
after(async () => window.happyDOM.close());
async function render(node = React.createElement(SFTPage)) { const host = document.createElement('div'); document.body.append(host); root = createRoot(host); await act(async () => { root.render(node); }); }
const buttons = text => [...document.querySelectorAll('button')].filter(b => b.textContent.trim() === text);
async function click(button) { assert.ok(button, 'button exists'); await act(async () => button.click()); }
async function change(input, value) { assert.ok(input, 'input exists'); await act(async () => Simulate.change(input, { target: { value } })); }
async function choose(label, option) { await click(document.querySelector(`[role="combobox"][aria-label="${label}"]`)); await click([...document.querySelectorAll('[role="option"]')].find(o => o.textContent.trim() === option)); }

test('empty workspace creates a project and never invents jobs, metrics or environments', async () => {
  state.projects = [];
  sftApi.createProject = async name => { calls.push(name); state.projects = [{ id: 'p_1', name }]; return state.projects[0]; };
  await render();
  assert.match(document.body.textContent, /先建立一个训练项目/);
  await click(buttons('创建项目')[0]);
  await change(document.querySelector('[role="dialog"] input'), '我的 4.0 模型');
  await click([...document.querySelectorAll('[role="dialog"] button')].find(b => b.textContent === '创建项目'));
  assert.deepEqual(calls, ['我的 4.0 模型']);
  assert.match(document.body.textContent, /没有运行中的任务/);
  assert.equal(document.querySelectorAll('select, datalist, input[type=date], input[type=time]').length, 0);
  assert.equal(buttons('新建训练')[0].disabled, true);
  assert.ok(document.querySelector('img[src="/avatar.png"]'), 'account uses an avatar');
  assert.equal(document.querySelector('.privacy-blur'), null, 'ordinary mode must keep avatars and samples readable');
});

test('workflow guides a new user to create a project and shows the next required step', async () => {
  state.projects = [];
  await render();
  const workflow = document.querySelector('section[aria-labelledby="sft-workflow-heading"]');
  assert.ok(workflow);
  assert.equal(workflow.querySelectorAll('ol > li').length, 5);
  const explainer = workflow.querySelector('[aria-label="SFT 原理与用途"]');
  assert.match(explainer.textContent, /聊天上下文.*你的回复.*LoRA Adapter/);
  assert.match(explainer.textContent, /表达方式.*评测.*试聊/);
  assert.match(explainer.textContent, /聊天细节.*检索（RAG）/);
  assert.match(workflow.textContent, /训练数据和模型可能包含或记住聊天内容/);
  assert.match(workflow.textContent, /建议下一步：准备数据/);
  await click(workflow.querySelector('button'));
  assert.ok(document.querySelector('[role="dialog"]'));
  assert.match(document.querySelector('[role="dialog"]').textContent, /新建训练项目/);
});

test('workflow reflects project progress and links to the relevant workbench sections', async () => {
  state.datasets = [frozen()]; state.workers = [worker()];
  await render();
  const workflow = document.querySelector('section[aria-labelledby="sft-workflow-heading"]');
  assert.match(workflow.textContent, /建议下一步：预检与训练/);
  assert.match(workflow.textContent, /已冻结/);
  assert.match(workflow.textContent, /已连接/);
  const steps = workflow.querySelectorAll('ol > li > button');
  assert.equal(steps[2].getAttribute('aria-current'), 'step');
  await click(steps[2]);
  assert.equal(document.querySelector('.sft-tabs button[aria-current]').textContent, '训练');
  await click(steps[3]);
  assert.equal(document.querySelector('.sft-tabs button[aria-current]').textContent, '评测');
  await click(steps[4]);
  assert.equal(document.querySelector('.sft-tabs button[aria-current]').textContent, '模型');
});

test('preparing chat data requires an explicit scope and does not expand an empty selection', async () => {
  const contacts = [{ username: 'wxid_alice', nickname: '小明', remark: '' }, { username: 'wxid_bob', nickname: '小林', remark: '' }];
  sftApi.createDataset = async (project, body) => { calls.push({ project, body }); };
  await render(React.createElement(SFTPage, { contacts }));
  await click(buttons('准备数据')[0]);
  assert.match(document.body.textContent, /先生成可检查的草稿，不会立即开始训练/);
  assert.match(document.body.textContent, /未选择时不会自动使用全部私聊/);
  const submit = buttons('生成待审核草稿')[0];
  assert.equal(submit.disabled, true);
  const alice = [...document.querySelectorAll('.sft-contact-list button')].find(button => button.textContent.includes('小明'));
  await click(alice);
  assert.equal(submit.disabled, false);
  await click(alice);
  assert.equal(submit.disabled, true, 'removing the last contact must not select all chats');
  await click([...document.querySelectorAll('.sft-choice-grid button')].find(button => button.textContent.includes('全部可用私聊')));
  assert.equal(submit.disabled, false);
  await click(submit);
  assert.deepEqual(calls[0].body.scope, { contacts: [], from: 0, to: 0 });
});

test('selected contacts and imported training files have distinct preparation instructions', async () => {
  const contacts = [{ username: 'wxid_alice', nickname: '小明', remark: '' }];
  sftApi.createDataset = async (project, body) => { calls.push({ project, body }); };
  await render(React.createElement(SFTPage, { contacts }));
  await click(buttons('准备数据')[0]);
  await click(document.querySelector('.sft-contact-list button'));
  await click(buttons('生成待审核草稿')[0]);
  assert.deepEqual(calls[0].body.scope.contacts, ['wxid_alice']);
  await click(buttons('准备数据')[0]);
  await click([...document.querySelectorAll('.sft-choice-grid button')].find(button => button.textContent.includes('导入训练文件')));
  assert.match(document.body.textContent, /每行是一条对话样本/);
  assert.match(document.body.textContent, /"role":"assistant"/);
  assert.equal(buttons('生成待审核草稿')[0].disabled, true);
});

test('remote GPU pairing requires a reachable HTTPS or loopback tunnel address', async () => {
  sftApi.pairing = async project => { calls.push(project); return { code: 'temporary-code', expires_at: 2000000000 }; };
  await render();
  await click(buttons('环境管理')[0]);
  await choose('环境类型', '远程 Linux / NVIDIA GPU 容器');
  const dialog = document.querySelector('[role="dialog"]');
  assert.match(dialog.textContent, /容器里的 127\.0\.0\.1 指向容器自身/);
  assert.match(dialog.textContent, /ssh -N -L 18080/);
  const address = dialog.querySelector('input[aria-label="训练容器可访问的 WeLink 地址"]');
  const generate = [...dialog.querySelectorAll('button')].find(button => button.textContent === '生成一次性配对码');
  assert.equal(generate.disabled, true);
  await change(address, 'http://10.0.0.1:8080');
  assert.equal(generate.disabled, true);
  await change(address, 'http://127.0.0.1:18080');
  assert.equal(generate.disabled, false);
  await click(generate);
  assert.deepEqual(calls, ['p_1']);
  assert.match(dialog.textContent, /pair --server 'http:\/\/127\.0\.0\.1:18080'/);
});

test('recording privacy mode blurs account information only when enabled', async () => {
  await render(React.createElement(PrivacyModeContext.Provider, { value: { privacyMode: true, setPrivacyMode() {} } }, React.createElement(SFTPage)));
  assert.ok(document.querySelector('.privacy-blur img[src="/avatar.png"]'));
  assert.ok([...document.querySelectorAll('.privacy-blur')].some(element => element.textContent.includes('测试账号')));
});

test('training wizard requires fixed revision, actual preflight and separate submission', async () => {
  state.datasets = [frozen()]; state.workers = [worker()];
  sftApi.preflight = async config => { calls.push({ action: 'preflight', config }); const job = { id: 'pf_1', kind: 'preflight', state: 'succeeded', config, last_seq: 0, created_at: 1 }; state.jobs = [job]; return job; };
  sftApi.train = async id => { calls.push({ action: 'train', id }); return { id: 'run_1' }; };
  await render();
  await click(buttons('新建训练')[0]);
  await click(buttons('下一步')[0]);
  assert.equal(buttons('下一步')[0].disabled, true, 'no model/revision');
  const inputs = [...document.querySelectorAll('.sft-field input')];
  await change(inputs[0], 'org/model');
  await change(inputs[1], 'main');
  assert.equal(buttons('下一步')[0].disabled, true, 'main is not a pinned revision');
  await change(inputs[1], 'a'.repeat(40));
  await click(buttons('下一步')[0]);
  assert.equal(buttons('下一步')[0].disabled, true, 'cannot skip preflight');
  await click(buttons('运行环境与模型预检')[0]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].config.preset, 'validation');
  assert.equal(buttons('下一步')[0].disabled, false);
  await click(buttons('下一步')[0]);
  assert.match(document.body.textContent, /确认训练摘要/);
  assert.equal(calls.some(c => c.action === 'train'), false);
  await click(buttons('开始训练')[0]);
  assert.deepEqual(calls.at(-1), { action: 'train', id: 'pf_1' });
});

test('review preserves revision and shows freeze rejection until sensitive samples are handled', async () => {
  const dataset = { ...frozen(), state: 'draft', revision: 1 };
  state.datasets = [dataset];
  const sample = { id: 's1', messages: [{ role: 'user', content: '约个时间' }, { role: 'assistant', content: '联系 [号码]' }], issues: ['已自动脱敏，请复核'], review: 'pending', contact: 'anonymous' };
  sftApi.samples = async () => ({ samples: [sample], total: 1, revision: dataset.revision });
  sftApi.freeze = async () => { if (sample.review === 'pending') throw new Error('仍有自动脱敏样本未复核'); dataset.state = 'frozen'; state.datasets = [{ ...dataset }]; return dataset; };
  sftApi.review = async (id, body) => { calls.push(body); sample.review = 'kept'; dataset.revision++; state.datasets = [{ ...dataset }]; return dataset; };
  await render(); await click(buttons('审核样本')[0]);
  assert.match(document.body.textContent, /我的目标回复/);
  await click(buttons('冻结版本')[0]); await click(buttons('确认冻结')[0]);
  assert.match(document.querySelector('[role="alert"]').textContent, /未复核/);
  await click(document.querySelector('[aria-label="关闭冻结数据版本"]'));
  await click(buttons('保留')[0]);
  assert.equal(calls[0].revision, 1);
  assert.deepEqual(calls[0].ids, ['s1']);
  await click(buttons('冻结版本')[0]); await click(buttons('确认冻结')[0]);
  assert.equal(dataset.state, 'frozen');
  assert.equal(buttons('编辑脱敏文本').length, 0, 'frozen samples cannot be edited');
});

test('blind evaluation reveals version names and reference only after a vote', async () => {
  const job = { id: 'e_1', kind: 'evaluate', state: 'succeeded', created_at: 1 };
  state.jobs = [job];
  const sample = { id: 's1', messages: [{ role: 'user', content: '几点到' }], a: '七点吧', b: '大约七点到', errors: [], leakage: [], voted: false };
  sftApi.evaluation = async () => ({ job, cases: [{ ...sample }], sample_count: 1 });
  sftApi.vote = async (id, sampleId, choice, dimension) => { calls.push({ id, sampleId, choice, dimension }); Object.assign(sample, { voted: true, a_name: '微调模型', b_name: '基础模型', reference: '七点到楼下' }); };
  await render(); await click(buttons('评测')[0]);
  await choose('评测记录', `${new Date(1000).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · 1 · 已完成`);
  assert.equal(document.body.textContent.includes('七点到楼下'), false);
  await click(buttons('选择 A')[0]);
  assert.deepEqual(calls[0], { id: 'e_1', sampleId: 's1', choice: 'a', dimension: 'style' });
  assert.match(document.body.textContent, /回复 A · 微调模型/);
  assert.match(document.body.textContent, /原始目标回复：七点到楼下/);
});

test('loss chart has no synthetic progress and exposes the same real points as a table', async () => {
  await render(React.createElement(LossChart, { events: [] }));
  assert.equal(document.querySelector('polyline'), null);
  assert.match(document.body.textContent, /只有收到真实/);
  await act(async () => root.render(React.createElement(LossChart, { events: [{ seq: 1, type: 'metric', data: { optimizer_step: 1, train_loss: 2.5 } }, { seq: 2, type: 'metric', data: { optimizer_step: 2, val_loss: 2.2 } }] })));
  assert.equal(document.querySelectorAll('tbody tr').length, 2);
  assert.match(document.querySelector('svg').getAttribute('aria-label'), /2 个真实指标点/);
});

test('trial chat parses real SSE across UTF-8/chunk boundaries and rejects missing completion', async () => {
  const previousFetch = globalThis.fetch;
  const encoder = new TextEncoder();
  const stream = ': heartbeat\n\ndata: {"choices":[{"delta":{"content":"七点到"}}]}\n\ndata: [DONE]\n\n';
  const bytes = encoder.encode(stream);
  globalThis.fetch = async (_url, options) => {
    assert.equal(JSON.parse(options.body).stream, true);
    return new Response(new ReadableStream({ start(controller) { for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7)); controller.close(); } }), { status: 200 });
  };
  try {
    let reply = '';
    await original.streamChat('deployment', [{ role: 'user', content: '几点到？' }], text => reply += text);
    assert.equal(reply, '七点到');
    globalThis.fetch = async () => new Response('data: {"choices":[{"delta":{"content":"不完整"}}]}\n\n', { status: 200 });
    await assert.rejects(() => original.streamChat('deployment', [], () => {}), /中断/);
  } finally { globalThis.fetch = previousFetch; }
});
