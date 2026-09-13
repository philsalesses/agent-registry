import { ImageResponse } from 'next/og';
import { getReceipt } from '@/lib/api';
import { partyLabel, priceLabel, shortId, stateWord } from '@/lib/format';
import { receiptStory } from '@/lib/story';
import { Dashed, INK, MUTED, OG_SIZE, PAPER, Row, TEXT, TONES, TornEdge, ogFonts } from '@/og/card';

export const size = OG_SIZE;
export const contentType = 'image/png';
export const alt = 'An ANS receipt';

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [r, fonts] = await Promise.all([getReceipt(id), ogFonts()]);
  const display = fonts.length ? 'Gambarino' : 'serif';

  if (!r) {
    return new ImageResponse(
      (
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', width: '100%', height: '100%', background: INK, padding: 80 }}>
          <div style={{ display: 'flex', fontFamily: display, fontSize: 88, color: TEXT }}>Every job leaves a receipt.</div>
          <div style={{ display: 'flex', marginTop: 24, fontSize: 30, color: MUTED }}>ans-registry.org</div>
        </div>
      ),
      { ...size, fonts },
    );
  }

  const story = receiptStory(r);
  const state = stateWord(r.state);
  const provider = r.provider ? partyLabel(r.provider) : r.counterpartyHint?.name ?? 'provider';
  const client = r.client ? partyLabel(r.client) : r.counterpartyHint?.name ?? 'client';
  const line = story.line.length > 70 ? `${story.line.slice(0, 67)}...` : story.line;

  return new ImageResponse(
    (
      <div style={{ display: 'flex', width: '100%', height: '100%', background: INK, padding: '64px 72px', gap: 64 }}>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', flex: 1 }}>
          <div style={{ display: 'flex', fontFamily: display, fontSize: 34, color: TEXT }}>ANS</div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', fontFamily: display, fontSize: line.length > 44 ? 46 : line.length > 22 ? 56 : 70, lineHeight: 1.06, color: TEXT }}>{line}</div>
            <div style={{ display: 'flex', marginTop: 22, fontSize: 26, lineHeight: 1.4, color: MUTED, maxWidth: 560 }}>
              {r.task.length > 90 ? `${r.task.slice(0, 87)}...` : r.task}
            </div>
          </div>
          <div style={{ display: 'flex', fontSize: 24, color: MUTED }}>ans-registry.org/r/{r.id}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', width: 420, marginTop: 8 }}>
          <div style={{ display: 'flex', flexDirection: 'column', background: PAPER, padding: '28px 30px 22px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 22, letterSpacing: 2, color: '#1a2419' }}>
              <span>ANS RECEIPT</span>
              <span style={{ letterSpacing: 0, color: '#5b6a5e' }}>{shortId(r.id)}</span>
            </div>
            <Dashed />
            <Row label="provider" value={provider} />
            <Row label="client" value={client} />
            <Dashed />
            <Row label="price" value={priceLabel(r.priceMicros)} />
            <Row label="state" value={state.label} tone={TONES[state.tone]} />
            <Row label="signatures" value={`${[r.signatures.initiator, r.signatures.counterparty, r.signatures.deliver, r.signatures.verdict].filter(Boolean).length} of ${r.state === 'proposed' ? 2 : 4}`} />
            {r.provider?.trust ? <Dashed /> : null}
            {r.provider?.trust ? <Row label={`${provider} trust`} value={String(r.provider.trust.score)} /> : null}
          </div>
          <TornEdge width={420} />
        </div>
      </div>
    ),
    { ...size, fonts },
  );
}
