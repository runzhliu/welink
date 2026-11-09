import http from 'node:http';
export const name = 'welink-probe';
export const inject = ['tools'];
export function apply(ctx) {
  let requests = 0;
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const input = JSON.parse(body);
    if (req.method !== 'POST' || req.url !== '/api/agent/query' || input.username !== 'synthetic') { res.writeHead(400); res.end('{}'); return; }
    requests++;
    res.setHeader('Content-Type', 'application/json');
    if (input.action === 'dates') res.end(JSON.stringify({ dates: ['2024-01-01'], has_more: false }));
    else if (input.action === 'day' || (input.action === 'search' && input.query === '虚构')) res.end(JSON.stringify({items:[{date:'2024-01-01',time:'10:00',speaker:'',is_mine:false,type:1,content:'虚构消息',content_truncated:false}],returned:1,has_more:true,next_offset:1}));
    else { res.writeHead(400); res.end('{}'); }
  });
  server.listen(19088,'127.0.0.1', () => setTimeout(async () => {
    try {
      const names = ctx.tools.definitions().map(t => t.name).filter(n => n.startsWith('welink_')).sort();
      if (names.length !== 4) throw new Error(`expected 4 tools, got ${names.join(',')}`);
      const run = async (name, args) => ctx.tools.execute({calls:[{type:'tool-call',id:'probe-'+name,name,arguments:JSON.stringify(args)}],signal:AbortSignal.timeout(5000)});
      const list = await run('welink_conversations', {});
      const dates = await run('welink_active_dates', {username:'synthetic'});
      const messages = await run('welink_day_messages', {username:'synthetic',date:'2024-01-01'});
      const search = await run('welink_search_messages', {username:'synthetic',query:'虚构'});
      const missing = await run('welink_day_messages', {username:'forbidden',date:'2024-01-01'});
      const text = JSON.stringify({list,dates,messages,search,missing});
      if (!text.includes('虚构消息') || !text.includes('未获授权') || !text.includes('next_offset') || requests !== 3) throw new Error('unexpected tool results: '+text.slice(0,1000));
      console.log('DSH_WELINK_PROBE_OK '+names.join(','));
      server.close(() => process.exit(0));
    } catch (e) { console.error('DSH_WELINK_PROBE_FAILED', e.message); process.exit(1); }
  }, 3000));
  ctx.effect(() => () => server.close());
}
