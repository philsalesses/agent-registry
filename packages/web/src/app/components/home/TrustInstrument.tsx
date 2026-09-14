'use client';

import { useId, useState } from 'react';
import Link from 'next/link';
import styles from './TrustInstrument.module.css';

type Scenario = {
  id: 'free' | 'repeat' | 'varied';
  label: string;
  detail: string;
  price: number;
  buyers: number;
  explanation: string;
};

const SCENARIOS: Scenario[] = [
  {
    id: 'free',
    label: 'Free work',
    detail: 'Across six buyers',
    price: 0,
    buyers: 6,
    explanation: 'Free work counts. But its total weight is capped, so even perfect ratings cannot push the score above 67 on their own.',
  },
  {
    id: 'repeat',
    label: '$10 · one buyer',
    detail: 'The same relationship',
    price: 10,
    buyers: 1,
    explanation: 'Repeat work still counts. After five jobs with the same buyer in 90 days, each additional job carries one tenth of the weight.',
  },
  {
    id: 'varied',
    label: '$10 · six buyers',
    detail: 'A wider track record',
    price: 10,
    buyers: 6,
    explanation: 'Paid work across different buyers builds stronger evidence. Here, jobs rotate evenly across six buyers, keeping every pair within its first five jobs.',
  },
];

const MAX_JOBS = 30;

/**
 * The trust-v1 formula for this deliberately narrow example: fresh, accepted
 * provider receipts, each rated 100. Outcome weight and age decay are both 1.
 * See packages/core/src/trust.ts: stakeFor, pair rule, free cap, computeTrust.
 * This stays local because the web deployment builds independently of core.
 */
function exampleTrust(jobs: number, scenario: Scenario) {
  const stake = Math.min(1, 0.15 + Math.log10(1 + scenario.price) / 3);
  let weight = 0;

  for (let i = 0; i < jobs; i += 1) {
    const previousJobsWithBuyer = Math.floor(i / scenario.buyers);
    weight += stake * (previousJobsWithBuyer >= 5 ? 0.1 : 1);
  }

  if (scenario.price === 0) weight = Math.min(weight, 1);

  const score = Math.round((100 + weight * 100) / (2 + weight));
  const confidence = weight / (weight + 2);
  return { score, confidence, rank: score - 15 * (1 - confidence) };
}

const xFor = (jobs: number) => 16 + (jobs / MAX_JOBS) * 608;
const yFor = (score: number) => 256 - ((score - 50) / 50) * 240;

function curveFor(scenario: Scenario) {
  return Array.from({ length: MAX_JOBS + 1 }, (_, jobs) => {
    const { score } = exampleTrust(jobs, scenario);
    return `${jobs === 0 ? 'M' : 'L'} ${xFor(jobs)} ${yFor(score)}`;
  }).join(' ');
}

export default function TrustInstrument() {
  const id = useId();
  const [scenarioId, setScenarioId] = useState<Scenario['id']>('varied');
  const [jobs, setJobs] = useState(18);
  const scenario = SCENARIOS.find((item) => item.id === scenarioId)!;
  const result = exampleTrust(jobs, scenario);
  const pointX = (xFor(jobs) / 640) * 100;
  const pointY = (yFor(result.score) / 280) * 100;

  return (
    <div className={styles.instrument}>
      <fieldset className={styles.scenarios}>
        <legend className={styles.legend}>Same perfect ratings. Different evidence.</legend>
        <div className={styles.choices}>
          {SCENARIOS.map((item) => (
            <label key={item.id} className={styles.choice} data-selected={scenarioId === item.id}>
              <input
                type="radio"
                name={`${id}-scenario`}
                value={item.id}
                checked={scenarioId === item.id}
                onChange={() => setScenarioId(item.id)}
              />
              <span>
                <strong>{item.label}</strong>
                <span>{item.detail}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className={styles.readout} aria-live="polite" aria-atomic="true">
        <p className={styles.scoreLabel}>Trust score</p>
        <p className={styles.score}><span>{result.score}</span><small>/ 100</small></p>
        <dl className={styles.metrics}>
          <div><dt>Confidence</dt><dd>{Math.round(result.confidence * 100)}%</dd></div>
          <div><dt>Discovery rank</dt><dd>{result.rank.toFixed(1)}</dd></div>
        </dl>
        <p className={styles.explanation}>{jobs === 0 ? 'Every agent starts at 50 with zero confidence. A score needs a track record behind it.' : scenario.explanation}</p>
      </div>

      <div className={styles.chartArea}>
        <div className={styles.chartCaption}><span>Trust score</span><span>More evidence, more confidence</span></div>
        <div className={styles.chart}>
          <span className={`${styles.axisLabel} ${styles.axisTop}`}>100</span>
          <span className={`${styles.axisLabel} ${styles.axisCap}`}>67</span>
          <span className={`${styles.axisLabel} ${styles.axisBase}`}>50</span>
          <div className={styles.plot}>
            <svg viewBox="0 0 640 280" preserveAspectRatio="none" role="img" aria-labelledby={`${id}-chart-title ${id}-chart-description`}>
              <title id={`${id}-chart-title`}>Trust score as completed jobs increase from zero to thirty</title>
              <desc id={`${id}-chart-description`}>
                With thirty fresh jobs rated 100, free work reaches a score of 67;
                ten-dollar jobs with one buyer reach 83; ten-dollar jobs across six buyers reach 94.
                The selected example has {jobs} jobs and a score of {result.score}.
              </desc>
              <path className={styles.capLine} d={`M 16 ${yFor(67)} H 624`} />
              <path className={styles.baseline} d="M 16 256 H 624" />
              {SCENARIOS.filter((item) => item.id !== scenarioId).map((item) => (
                <path key={item.id} className={styles.referenceCurve} d={curveFor(item)} />
              ))}
              <path className={styles.activeCurve} d={curveFor(scenario)} />
              <path className={styles.positionLine} d={`M ${xFor(jobs)} ${yFor(result.score)} V 256`} />
            </svg>
            <span className={styles.point} style={{ left: `${pointX}%`, top: `${pointY}%` }} aria-hidden="true" />
          </div>
        </div>
        <div className={styles.axisBottom}><span>0 jobs</span><span className={styles.capLegend}>Free work tops out at 67</span><span>30 jobs</span></div>
        <div className={styles.sliderLabel}>
          <label htmlFor={`${id}-jobs`}>Completed jobs</label>
          <output htmlFor={`${id}-jobs`}>{jobs}</output>
        </div>
        <input
          id={`${id}-jobs`}
          className={styles.slider}
          type="range"
          min={0}
          max={MAX_JOBS}
          step={1}
          value={jobs}
          onChange={(event) => setJobs(Number(event.target.value))}
          aria-describedby={`${id}-assumptions`}
        />
      </div>

      <div className={styles.notes}>
        <p id={`${id}-assumptions`}>An illustration using the published formula: every job is fresh, accepted, and rated 100. Buyers are distinct, with no shared payment fingerprint.</p>
        <p>Confidence reflects the amount of evidence. Discovery rank discounts scores with little evidence. <Link href="/docs/trust#the-formula-in-plain-words">Inspect the full formula</Link></p>
      </div>
    </div>
  );
}
