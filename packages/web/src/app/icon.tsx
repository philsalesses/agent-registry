import { ImageResponse } from 'next/og';
import { ogFonts } from '@/og/card';

export const size = { width: 64, height: 64 };
export const contentType = 'image/png';

export default async function Icon() {
  return new ImageResponse(
    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#101814', color: '#e4ebe4', fontFamily: 'Tanker', fontSize: 58, lineHeight: 1 }}>A</div>,
    { ...size, fonts: await ogFonts() },
  );
}
