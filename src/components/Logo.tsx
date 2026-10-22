import React from 'react';

interface LogoProps {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  onClick?: () => void;
}

export const Logo: React.FC<LogoProps> = ({ className = '', size = 'md', onClick }) => {
  const iconSizes = {
    sm: 'w-7 h-7 text-sm',
    md: 'w-9 h-9 text-base',
    lg: 'w-11 h-11 text-lg'
  };

  const textSizes = {
    sm: 'text-lg',
    md: 'text-xl',
    lg: 'text-2xl'
  };

  return (
    <div
      onClick={onClick}
      className={`inline-flex items-center gap-2.5 select-none ${onClick ? 'cursor-pointer' : ''} ${className}`}
    >
      {/* Exact circular emblem from screenshot: dark forest green circle with leaf/node sprout in champagne/sage */}
      <div
        className={`${iconSizes[size]} rounded-full bg-[#244C3A] flex items-center justify-center shadow-xs transition-transform hover:scale-105`}
      >
        <svg
          viewBox="0 0 24 24"
          className="w-5 h-5 text-[#E8F0E9]"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {/* Stylized leaf with central branching vein */}
          <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z" />
          <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12" />
        </svg>
      </div>

      <div className="flex items-baseline">
        <span className={`font-serif font-bold text-[#244C3A] tracking-tight ${textSizes[size]}`}>
          CauseConnect
        </span>
        <span className={`ml-1.5 font-serif font-semibold text-white ${textSizes[size]}`}>
          AI
        </span>
      </div>
    </div>
  );
};
