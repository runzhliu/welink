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
          <h1 className="dk-text text-3xl sm:text-5xl font-black tracking-tight text-[#1d1d1f] mb-1 sm:mb-2">
            {title}
          </h1>
          {subtitle && (
            <p className="text-gray-400 font-medium tracking-wide text-sm">
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
              placeholder="搜索联系人..."
              value={searchValue}
              onChange={(e) => onSearchChange(e.target.value)}
              className="
                dk-input pl-11 pr-4 py-3 w-full sm:w-72
                bg-white border border-gray-200
                rounded-2xl
                text-sm font-medium
                placeholder:text-gray-400
                focus:outline-none focus:ring-2 focus:ring-[#07c160]/20 focus:border-[#07c160]
                transition-all duration-200
              "
            />
          </div>
        )}
      </div>
    </header>
  );
};
