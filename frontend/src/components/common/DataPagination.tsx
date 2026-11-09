import './data-table.css';

interface Props {
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}

export function DataPagination({ total, page, pageSize, onPageChange, onPageSizeChange }: Props) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const visible = [...new Set([1, pages, ...Array.from({ length: 5 }, (_, i) => page - 2 + i).filter(p => p > 1 && p < pages)])].sort((a, b) => a - b);
  const start = (page - 1) * pageSize + 1;
  return <nav className="data-pagination" aria-label="表格分页">
    <div className="data-pagination-info"><span>{start.toLocaleString()}–{Math.min(page * pageSize, total).toLocaleString()} / {total.toLocaleString()}</span><div className="data-pagination-sizes" aria-label="每页条数">
      {[10, 20, 50, 100].map(size => <button key={size} type="button" aria-pressed={pageSize === size} onClick={() => onPageSizeChange(size)}>{size}</button>)}<span>条/页</span>
    </div></div>
    <div className="data-pagination-pages"><button type="button" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>上一页</button><div className="data-pagination-numbers">
      {visible.map((p, index) => <span key={p} className="data-pagination-number">{index > 0 && p - visible[index - 1] > 1 && <span className="data-pagination-ellipsis">…</span>}<button type="button" aria-label={`第 ${p} 页`} aria-current={page === p ? 'page' : undefined} onClick={() => onPageChange(p)}>{p}</button></span>)}
    </div><span className="data-pagination-mobile">{page} / {pages}</span><button type="button" disabled={page >= pages} onClick={() => onPageChange(page + 1)}>下一页</button></div>
  </nav>;
}
