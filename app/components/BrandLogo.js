'use client';
import Image from 'next/image';
import { useDarkMode } from './useDarkMode';

// variant: 'auto' follows the theme. 'light' always renders logo.png, which
// is the correct asset on a light background even while dark mode is on —
// the invoice and any printed document are always light, so they pin it.
export default function BrandLogo({
  className,
  alt = 'CoreFusion Technologies',
  style,
  width = 40,
  height = 40,
  variant = 'auto',
  priority = false,
}) {
  const [dark] = useDarkMode();
  const useDarkAsset = variant === 'auto' ? dark : variant === 'dark';
  return (
    <Image
      src={useDarkAsset ? '/logo-dark.png' : '/logo.png'}
      alt={alt}
      className={className}
      style={style}
      width={width}
      height={height}
      priority={priority}
    />
  );
}
