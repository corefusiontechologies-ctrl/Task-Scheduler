'use client';
import { useDarkMode } from './useDarkMode';

export default function BrandLogo({ className, alt = 'CoreFusion Technologies', style }) {
  const [dark] = useDarkMode();
  return <img src={dark ? '/logo-dark.png' : '/logo.png'} alt={alt} className={className} style={style} />;
}
