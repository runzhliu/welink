import { useState } from 'react';
import type { Contact } from '../../types';
import { avatarSrc } from '../../utils/avatar';

/** Keep a stable avatar surface when an image is missing or unavailable. */
export const Avatar: React.FC<{
  src?: string;
  contact?: Pick<Contact, 'small_head_url' | 'big_head_url'>;
  name: string;
  className?: string;
}> = ({ src, contact, name, className = 'h-10 w-10' }) => {
  const [failedSources, setFailedSources] = useState<string[]>([]);
  // Current contact data also fills missing or stale avatars in cached summaries.
  const sources = [contact?.small_head_url, contact?.big_head_url, src].map(avatarSrc);
  const source = sources.find((url): url is string => !!url && !failedSources.includes(url));
  return (
    <span role="img" aria-label={name} className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--bg-subtle)] text-[var(--text-secondary)] text-sm font-semibold ${className}`}>
      {source
        ? <img key={source} loading="lazy" src={source} alt="" className="h-full w-full object-cover" onError={() => setFailedSources(previous => [...previous, source])} />
        : <span aria-hidden="true">{Array.from(name.trim())[0]?.toLocaleUpperCase() || '?'}</span>}
    </span>
  );
};
