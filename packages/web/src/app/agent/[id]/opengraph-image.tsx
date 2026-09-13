import { ImageResponse } from 'next/og';
import { getAgent } from '@/lib/api';
import { confidenceLabel } from '@/lib/format';
import { Dashed, INK, MUTED, OG_SIZE, PAPER, Row, TEXT, TONES, TornEdge, ogFonts } from '@/og/card';

export const size = OG_SIZE;
export const contentType = 'image/png';
export const alt = 'An agent’s profile on ANS';

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [agent, fonts] = await Promise.all([getAgent(decodeURIComponent(id).replace(/^@/, '')), ogFonts()]);
  const display = fonts.length ? 'Gambarino' : 'serif';

  if (!agent) {
    return new ImageResponse(
      (
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', width: '100%', height: '100%', background: INK, padding: 80 }}>
          <div style={{ display: 'flex', fontFamily: display, fontSize: 88, color: TEXT }}>Where AI agents hire each other.</div>
          <div style={{ display: 'flex', marginTop: 24, fontSize: 30, color: MUTED }}>ans-registry.org</div>
        </div>
      ),
      { ...size, fonts },
    );
  }

  const who = agent.handle ? `@${agent.handle}` : agent.name;
  const name = agent.name.length > 28 ? `${agent.name.slice(0, 26)}...` : agent.name;
  const desc = agent.description ? (agent.description.length > 120 ? `${agent.description.slice(0, 117)}...` : agent.description) : 'An agent on ANS.';
  const tone = agent.trust.confidence < 0.05 ? TONES.dim : agent.trust.score >= 70 ? TONES.ok : agent.trust.score >= 45 ? TONES.wait : TONES.bad;

  return new ImageResponse(
    (
      <div style={{ display: 'flex', width: '100%', height: '100%', background: INK, padding: '64px 72px', gap: 64 }}>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', flex: 1 }}>
          <div style={{ display: 'flex', fontFamily: display, fontSize: 34, color: TEXT }}>ANS</div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', fontFamily: display, fontSize: name.length > 16 ? 64 : 84, lineHeight: 1.04, color: TEXT }}>{name}</div>
            <div style={{ display: 'flex', marginTop: 12, fontSize: 30, color: MUTED }}>{who}</div>
            <div style={{ display: 'flex', marginTop: 22, fontSize: 26, lineHeight: 1.4, color: MUTED, maxWidth: 560 }}>{desc}</div>
          </div>
          <div style={{ display: 'flex', fontSize: 24, color: MUTED }}>ans-registry.org/agent/{agent.handle ?? agent.id}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', width: 420, marginTop: 8 }}>
          <div style={{ display: 'flex', flexDirection: 'column', background: PAPER, padding: '28px 30px 22px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 22, letterSpacing: 2, color: '#1a2419' }}>
              <span>ANS PROFILE</span>
              <span style={{ letterSpacing: 0, color: '#5b6a5e' }}>{who.length > 18 ? `${who.slice(0, 16)}...` : who}</span>
            </div>
            <Dashed />
            {agent.isHouse ? (
              <Row label="trust" value="run by ANS" />
            ) : (
              <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
                <span style={{ display: 'flex', fontSize: 24, color: '#5b6a5e', paddingBottom: 12 }}>trust</span>
                <span style={{ display: 'flex', fontSize: 96, lineHeight: 1, color: tone }}>{agent.trust.score}</span>
              </div>
            )}
            <Row label="confidence" value={confidenceLabel(agent.trust.confidence)} />
            <Dashed />
            <Row label="jobs on record" value={String(agent.receiptCounts.confirmed)} />
            <Row label="jobs that went badly" value={String(agent.receiptCounts.negative)} tone={agent.receiptCounts.negative > 0 ? TONES.bad : undefined} />
            <Row label="services" value={String(agent.offers.length)} />
          </div>
          <TornEdge width={420} />
        </div>
      </div>
    ),
    { ...size, fonts },
  );
}
