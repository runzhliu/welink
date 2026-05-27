import React, { useState } from 'react';
import { X, Plus } from 'lucide-react';

export const TagList: React.FC<{
  items: string[];
  onRemove: (v: string) => void;
  emptyText: string;
  labelFor?: (id: string) => string;
  privacyMode?: boolean;
}> = ({ items, onRemove, emptyText, labelFor, privacyMode }) => (
  <div className="min-h-[56px] flex flex-wrap gap-2">
    {items.length === 0 ? (
      <span className="text-sm text-gray-400 self-center">{emptyText}</span>
    ) : (
      items.map((item) => {
        const label = labelFor ? labelFor(item) : item;
        const showId = label !== item;
        return (
          <span
            key={item}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium bg-gray-100 dark:bg-white/10 text-gray-700 dark:text-gray-300"
          >
            <span className={privacyMode ? 'privacy-blur' : ''}>{label}</span>
            {showId && <span className={`text-xs text-gray-400${privacyMode ? ' privacy-blur' : ''}`}>{item}</span>}
            <button
              onClick={() => onRemove(item)}
              className="text-gray-400 hover:text-red-500 transition-colors"
            >
              <X size={13} />
            </button>
          </span>
        );
      })
    )}
  </div>
);

export const AddInput: React.FC<{
  placeholder: string;
  onAdd: (v: string) => void;
}> = ({ placeholder, onAdd }) => {
  const [value, setValue] = useState('');

  const submit = () => {
    if (value.trim()) {
      onAdd(value.trim());
      setValue('');
    }
  };

  return (
    <div className="flex flex-col sm:flex-row gap-2 mt-3">
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        placeholder={placeholder}
        className="flex-1 px-4 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#07c160]/20 focus:border-[#07c160] transition-all dk-input"
      />
      <button
        onClick={submit}
        className="flex items-center gap-1.5 px-4 py-2 bg-[#07c160] text-white text-sm font-semibold rounded-xl hover:bg-[#06ad56] transition-colors"
      >
        <Plus size={15} />
        添加
      </button>
    </div>
  );
};
