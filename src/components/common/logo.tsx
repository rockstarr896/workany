import { cn } from '@/shared/lib/utils';

export function Logo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={cn('size-7', className)}
      xmlns="http://www.w3.org/2000/svg"
    >
        <defs>
          <linearGradient id="logoGradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#1890FF" />
            <stop offset="100%" stopColor="#096DD9" />
          </linearGradient>
        </defs>
        <rect
          x="0"
          y="0"
          width="32"
          height="32"
          rx="6"
          ry="6"
          fill="url(#logoGradient)"
        />
        <text
          x="16"
          y="23"
          fontFamily="PingFang SC, Noto Sans SC, Microsoft YaHei, sans-serif"
          fontSize="18"
          fontWeight="700"
          fill="white"
          textAnchor="middle"
        >
          灵
        </text>
    </svg>
  );
}
