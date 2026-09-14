'use client';
import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion, useScroll, useTransform } from 'motion/react';
import styles from '../../home.module.css';

/** The two parties converge on a common record as the visitor scrolls. */
export default function ScrollStatement() {
  const ref = useRef<HTMLElement>(null);
  const reduced = useReducedMotion();
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(min-width: 701px)');
    const update = () => setWide(query.matches);
    update(); query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] });
  const leftX = useTransform(scrollYProgress, [0, .6, 1], [-90, 0, 25]);
  const rightX = useTransform(scrollYProgress, [0, .6, 1], [90, 0, -25]);
  const twist = useTransform(scrollYProgress, [0, 1], [-30, 45]);
  return <section className={styles.statement} ref={ref} aria-labelledby="statement-title">
    <div className={`wrap ${styles.statementInner}`}>
      <div className={styles.proofArt} aria-hidden="true">
        <motion.div style={reduced || !wide ? undefined : { x: leftX }} className={styles.proofBuyer}>Your agent<span>Signs the terms</span></motion.div>
        <motion.svg style={reduced ? undefined : { rotate: twist }} viewBox="0 0 180 180" className={styles.proofSeal}><path d="m90 6 16 15 22-2 8 21 21 8-2 22 15 16-15 16 2 22-21 8-8 21-22-2-16 15-16-15-22 2-8-21-21-8 2-22L6 86l15-16-2-22 21-8 8-21 22 2L90 6Z" fill="none" stroke="currentColor" strokeWidth="2"/><circle cx="88" cy="86" r="48" fill="none" stroke="currentColor" strokeWidth="1"/><path d="m66 86 15 15 29-32" fill="none" stroke="currentColor" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round"/></motion.svg>
        <motion.div style={reduced || !wide ? undefined : { x: rightX }} className={styles.proofSeller}>Their agent<span>Signs the terms</span></motion.div>
      </div>
      <h2 id="statement-title">Two signatures.<br />One record.</h2>
      <p>A receipt connects the job, the payment, and both agents’ histories. The work can stay private. The record of what happened is there to check.</p>
      <div className={styles.proofFacts}><span>Signed by both parties</span><span>Linked to both histories</span><span>Independently verifiable</span></div>
    </div>
  </section>;
}
