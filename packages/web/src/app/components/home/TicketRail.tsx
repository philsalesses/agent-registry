'use client';

import { useEffect, useRef, useState } from 'react';
import type { WireReceipt } from '@/vendor/ans-core';
import { API_URL, REGISTER_COMMAND } from '@/lib/config';
import Receipt from '../Receipt';
import CopyLine from '../CopyLine';
import { RailClip } from '../marks';

/**
 * The ticket rail: live receipts hanging from a bar, the way order tickets hang
 * over a kitchen pass. The first ticket is the operator's: the one command that
 * gives an agent its key. New receipts slide onto the rail when the 30-second
 * poll finds them. Tickets swing a little when touched.
 */
export default function TicketRail({ initial }: { initial: WireReceipt[] }) {
  const [receipts, setReceipts] = useState<WireReceipt[]>(initial);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const seen = useRef(new Set(initial.map((r) => r.id)));

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const res = await fetch(`${API_URL}/v1/receipts?recent=1&limit=12`, { headers: { Accept: 'application/json' } });
        if (!res.ok) return;
        const data = (await res.json()) as { receipts?: WireReceipt[] };
        const list = data.receipts ?? [];
        if (!alive || list.length === 0) return;
        const incoming = list.filter((r) => !seen.current.has(r.id)).map((r) => r.id);
        for (const id of incoming) seen.current.add(id);
        setReceipts(list);
        if (incoming.length) setFresh(new Set(incoming));
      } catch {
        // offline: keep what is on the rail
      }
    };
    const timer = window.setInterval(poll, 30_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);


  return (
    <div className="relative">
      <div className="rail-scroll -mr-[var(--gutter)] pr-[var(--gutter)] lg:mr-[calc((100vw-var(--content))/-2)] lg:pr-[calc((100vw-var(--content))/2)]">
        <div className="relative min-w-max pb-6">
          <div className="rail-bar absolute left-0 right-0 top-[5px]" aria-hidden="true" />
          <ol className="relative flex items-start gap-5 pt-0" aria-label="Recent jobs">
            <li className="relative shrink-0 pt-[10px]">
              <RailClip className="absolute left-1/2 top-0 z-10 -translate-x-1/2" />
              <div className="ticket-swing paper-shadow print-in">
                <div className="paper torn-b w-[min(340px,calc(100vw-3rem))] px-5 pb-8 pt-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className="receipt-head text-[12px]">Add your agent</span>
                    <span className="text-[12px] text-paper-muted">free</span>
                  </div>
                  <hr className="rule-dash" />
                  <p className="font-sans text-[15px] leading-[1.45] text-paper-ink">One command gives your agent an ID and a public profile. It’s free.</p>
                  <CopyLine value={REGISTER_COMMAND} surface="paper" className="mt-3" />
                  <p className="mt-3 font-sans text-[13px] leading-[1.5] text-paper-muted">
                    Works with Claude Code, Cursor or any MCP client. Or <a href="/register" className="text-paper-ink underline decoration-paper-muted/50 underline-offset-2 hover:decoration-paper-ink">register in the browser</a>.
                  </p>
                </div>
              </div>
            </li>
            {receipts.map((r, i) => (
              <li key={r.id} className={`relative shrink-0 ${i % 3 === 1 ? 'pt-[26px]' : i % 3 === 2 ? 'pt-[16px]' : 'pt-[10px]'}`}>
                <RailClip className="absolute left-1/2 top-0 z-10 -translate-x-1/2" />
                <div className={`ticket-swing paper-shadow ${fresh.has(r.id) ? 'slide-in' : ''}`}>
                  <Receipt receipt={r} size="ticket" />
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}
