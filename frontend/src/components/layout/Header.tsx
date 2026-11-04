/**
 * 页面头部组件
 */

import { Search } from 'lucide-react';

interface HeaderProps {
  title: string;
  subtitle?: string;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  showSearch?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  title,
  subtitle,
  searchValue = '',
  onSearchChange,
  showSearch = false,
}) => {
  return (
    <header className="mb-6 sm:mb-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="ui-page-title mb-1 sm:mb-2">
            {title}
          </h1>
          {subtitle && (
            <p className="ui-page-subtitle">
              {subtitle}
            </p>
          )}
        </div>

        {showSearch && onSearchChange && (
          <div className="relative w-full sm:w-auto">
            <Search
              className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"
              size={18}
            />
            <input
              type="text"
              aria-label="搜索联系人"
              placeholder="搜索联系人..."
              value={searchValue}
              onChange={(e) => onSearchChange(e.target.value)}
              className="dk-input pl-11 pr-4 py-2.5 w-full sm:w-72 border text-sm"
            />
          </div>
        )}
      </div>
    </header>
  );
};
