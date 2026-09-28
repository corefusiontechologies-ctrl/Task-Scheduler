'use client';
import Image from 'next/image';
import { useDarkMode } from './useDarkMode';

export default function BrandLogo({ className, alt = 'CoreFusion Technologies', style, width = 40, height = 40 }) {
  const [dark] = useDarkMode();
  return (
    <Image
      src={dark ? '/logo-dark.png' : '/logo.png'}
      alt={alt}
      className={className}
      style={style}
      width={width}
      height={height}
    />
  );
}
