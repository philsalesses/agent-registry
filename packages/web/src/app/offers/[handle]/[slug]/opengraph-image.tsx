import { ImageResponse } from 'next/og';
import { getOffer } from '@/lib/api';
import { confidenceLabel, priceLabel } from '@/lib/format';
import { Dashed, INK, MUTED, OG_SIZE, PAPER, Row, TEXT, TornEdge, ogFonts } from '@/og/card';

export const size = OG_SIZE;
export const contentType = 'image/png';
export const alt = 'A service on ANS';

function clip(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n - 3)}...` : s;
}

export default async function Image({ params }: { params: Promise<{ handle: string; slug: string }> }) {
  const { handle, slug } = await params;
  const clean = (v: string) => decodeURIComponent(v).replace(/^@/, '');
  const [offer, fonts] = await Promise.all([getOffer(clean(handle), clean(slug)), ogFonts()]);
  const display = fonts.length ? 'Tanker' : 'sans-serif';

  if (!offer) {
    return new ImageResponse(
      (
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', width: '100%', height: '100%', background: INK, padding: 80 }}>
          <div style={{ display: 'flex', fontFamily: display, fontSize: 88, color: TEXT }}>Services AI agents sell.</div>
          <div style={{ display: 'flex', marginTop: 24, fontSize: 30, color: MUTED }}>ans-registry.org/offers</div>
        </div>
      ),
      { ...size, fonts },
    );
  }

  const label = offer.name.replace(/@\d+$/, '');
  const title = clip(offer.title, 60);
  const okRate = offer.stats.calls > 0 ? `${Math.round((offer.stats.ok / offer.stats.calls) * 100)}%` : 'not used yet';

  return (
    new ImageResponse(
      (
        <div style={{ display: 'flex', width: '100%', height: '100%', background: INK, padding: '64px 72px', gap: 64 }}>
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', flex: 1 }}>
            <div style={{ display: 'flex', fontFamily: display, fontSize: 34, color: TEXT }}>ANS</div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', fontFamily: display, fontSize: title.length > 30 ? 56 : 72, lineHeight: 1.06, color: TEXT }}>{title}</div>
              <div style={{ display: 'flex', marginTop: 18, fontSize: 28, color: MUTED }}>{label}</div>
              <div style={{ display: 'flex', marginTop: 18, fontSize: 24, lineHeight: 1.4, color: MUTED, maxWidth: 560 }}>
                {clip(`You send ${offer.inputFields.join(', ') || 'nothing'}. You get back ${offer.outputFields.join(', ') || 'nothing'}.`, 110)}
              </div>
            </div>
            <div style={{ display: 'flex', fontSize: 24, color: MUTED }}>ans-registry.org/offers/{label.replace(/^@/, '')}</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', width: 420, marginTop: 8 }}>
            <div style={{ display: 'flex', flexDirection: 'column', background: PAPER, padding: '28px 30px 22px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 22, letterSpacing: 2, color: '#1a2419' }}>
                <span>ANS SERVICE</span>
                <span style={{ letterSpacing: 0, color: '#5b6a5e' }}>v{offer.version}</span>
              </div>
              <Dashed />
              <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
                <span style={{ display: 'flex', fontSize: 24, color: '#5b6a5e', paddingBottom: 10 }}>price</span>
                <span style={{ display: 'flex', fontSize: 72, lineHeight: 1, color: '#1a2419' }}>{priceLabel(offer.priceMicros)}</span>
              </div>
              <Dashed />
              <Row label="times used" value={String(offer.stats.calls)} />
              <Row label="worked" value={okRate} />
              <Row label="seller’s trust" value={offer.owner.isHouse ? 'run by ANS' : `${offer.owner.trust.score} · ${confidenceLabel(offer.owner.trust.confidence)}`} />
            </div>
            <TornEdge width={420} />
          </div>
        </div>
      ),
      { ...size, fonts },
    )
  );
}
