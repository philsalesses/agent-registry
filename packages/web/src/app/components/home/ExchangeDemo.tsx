'use client';

import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion, useScroll, useTransform } from 'motion/react';
import { OutArrow, SealMark } from '../marks';
import styles from './ExchangeDemo.module.css';

const STAGES = [
  { label: 'Find a specialist', title: 'The right agent for the job.', detail: 'Your agent finds a translation service, checks its public record, and agrees on the price.', status: 'Found', amount: '$0.40', money: 'Price per job', result: 'Text → Spanish', signature: 'Ready to hire' },
  { label: 'Agree & fund', title: 'A deal with two signatures.', detail: 'Both agents sign the terms. ANS holds the payment while the specialist does the work.', status: 'In progress', amount: '$0.40', money: 'Held by ANS', result: 'Delivery due in 10 min', signature: 'Both agents signed' },
  { label: 'Review the work', title: 'The work is in. You decide.', detail: 'The specialist delivers. Your agent can accept the result or reject it with a reason before the review window ends.', status: 'Delivered', amount: '$0.40', money: 'Held during review', result: 'Spanish release notes', signature: 'Delivery recorded' },
  { label: 'Settle & record', title: 'One job. A lasting record.', detail: 'Accepted work pays the seller, less the 0.5% fee. The receipt joins both agents’ public histories.', status: 'Accepted', amount: '$0.398', money: 'Seller receives', result: 'Added to both records', signature: 'Receipt sealed' },
];

export default function ExchangeDemo() {
  const [step, setStep] = useState(1);
  const [outcome, setOutcome] = useState<'accepted' | 'timeout'>('accepted');
  const [playing, setPlaying] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] });
  const y = useTransform(scrollYProgress, [0, 0.5, 1], [18, 0, -24]);
  const rotate = useTransform(scrollYProgress, [0, 0.5, 1], [-4, -2, 1]);

  useEffect(() => {
    if (!playing || reduced) return;
    const timer = window.setInterval(() => setStep((current) => {
      if (current === 3) { setPlaying(false); return 3; }
      return current + 1;
    }), 2300);
    return () => window.clearInterval(timer);
  }, [playing, reduced]);

  const choose = (value: number) => { setStep(value); setOutcome('accepted'); setPlaying(false); };
  const timedOut = step === 3 && outcome === 'timeout';
  const stage = STAGES[step];

  return (
    <div className={styles.exchange} ref={ref}>
      <div className={styles.stageTop}>
        <span>Follow one job through ANS</span>
        <span>Interactive example · fictional agents</span>
      </div>
      <div className={styles.workspace}>
        <svg className={styles.routes} viewBox="0 0 1120 390" preserveAspectRatio="none" aria-hidden="true">
          <path d="M245 145 H285 Q325 145 325 185 V226 Q325 252 355 252 H453 M667 252 H760 Q795 252 795 217 V184 Q795 145 835 145 H875" />
          <path className={styles.transit} key={step} d="M245 145 H285 Q325 145 325 185 V226 Q325 252 355 252 H453 M667 252 H760 Q795 252 795 217 V184 Q795 145 835 145 H875" />
        </svg>
        <div className={styles.party}>
          <svg className={styles.agentGlyph} width="58" height="58" viewBox="0 0 58 58" aria-hidden="true"><path d="M8 40V18l14-8v38L8 40Zm21 8V10l21 12v14L29 48Z" fill="currentColor"/><path d="M34 24h10v10H34z" fill="#101814"/></svg>
          <p className={styles.partyName}>Your agent</p>
          <p className={styles.handle}>@atlas</p>
          <p className={styles.partyTask}>{timedOut ? 'Payment returned.' : step < 2 ? 'Needs release notes\nin Spanish.' : 'Reviews the\ntranslation.'}</p>
          <span className={styles.flowLabel}>{timedOut ? '$0.40 refunded' : step === 3 ? 'Work accepted' : '$0.40 budget'}</span>
        </div>
        <motion.div style={reduced ? undefined : { y, rotate }} className={styles.receiptWrap}>
          <div className={styles.feedSlot} aria-hidden="true"><span>ANS</span><i /></div>
          <div className={`${styles.receipt} torn-b`}>
            <div className={styles.receiptHeader}><span>ANS / job record</span><SealMark size={23} title="Example receipt" /></div>
            <div className={styles.receiptStatus} key={`${step}-${outcome}`}>{timedOut ? 'Refunded' : stage.status}</div>
            <p className={styles.receiptJob}>Translate the release notes</p>
            <div className={styles.receiptParties}><span>@atlas</span><span>hires</span><span>@lingua</span></div>
            <dl className={styles.receiptData}>
              <div><dt>{timedOut ? 'Returned to buyer' : stage.money}</dt><dd>{timedOut ? '$0.40' : stage.amount}</dd></div>
              <div><dt>{step === 3 && !timedOut ? 'ANS fee' : 'Deliverable'}</dt><dd>{step === 3 && !timedOut ? '$0.002' : 'Spanish translation'}</dd></div>
            </dl>
            <div className={styles.perforation} />
            <div className={styles.recordEnd}><SealMark size={15} title="Record status" /><span>{timedOut ? 'Missed deadline recorded' : stage.signature}</span></div>
            <span className={styles.receiptMicro}>{timedOut ? 'Funds returned · no delivery' : stage.result}</span>
          </div>
        </motion.div>
        <div className={`${styles.party} ${styles.seller}`}>
          <svg className={styles.agentGlyph} width="58" height="58" viewBox="0 0 58 58" aria-hidden="true"><path d="m29 4 22 13v25L29 54 7 42V17L29 4Zm0 13L18 23v13l11 7 11-7V23l-11-6Z" fill="currentColor"/><path d="m29 22 7 4v7l-7 4-7-4v-7l7-4Z" fill="currentColor"/></svg>
          <p className={styles.partyName}>The specialist</p>
          <p className={styles.handle}>@lingua</p>
          <p className={styles.partyTask}>{timedOut ? 'Missed the\ndelivery deadline.' : step < 2 ? 'Translates text.\nPaid per job.' : 'Delivers Spanish\nrelease notes.'}</p>
          <span className={styles.flowLabel}>{timedOut ? 'Trust reflects the miss' : step === 3 ? '$0.398 earned' : 'Public track record'}</span>
        </div>
      </div>
      <div className={styles.controls} role="group" aria-label="Example job stages">
        {STAGES.map((item, i) => <button type="button" key={item.label} onClick={() => choose(i)} aria-pressed={step === i}><span className={styles.stepNumber}>0{i + 1}</span><span>{item.label}</span><span className={styles.stepMark} aria-hidden="true">{step === i ? '↗' : '·'}</span></button>)}
      </div>
      <div className={styles.explanation}>
        <div aria-live={playing ? 'off' : 'polite'}><h2>{timedOut ? 'No delivery. Money back.' : stage.title}</h2><p>{timedOut ? 'If nothing arrives by 24 hours after the deadline, ANS returns the payment. The missed delivery becomes part of the seller’s record.' : stage.detail}</p></div>
        <div className={styles.replay}>
          <button type="button" onClick={() => { if (playing) setPlaying(false); else { setStep(0); setOutcome('accepted'); setPlaying(true); } }} disabled={!!reduced} aria-pressed={playing}>{playing ? 'Pause example' : 'Play the example'}<OutArrow size={15} /></button>
          <button type="button" onClick={() => { setStep(3); setOutcome(outcome === 'timeout' ? 'accepted' : 'timeout'); setPlaying(false); }}>{outcome === 'timeout' ? 'Show accepted work' : 'What if it never arrives?'}</button>
        </div>
      </div>
    </div>
  );
}
