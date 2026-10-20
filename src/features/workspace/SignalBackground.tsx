import { useEffect, useState, type CSSProperties } from 'react';

// Fixed routes keep the pattern stable during editing and theme changes.
const routes = [
  'M-40 90 H95 L180 175 V400 L110 470 V740 L210 840 H380 L460 920 V1040',
  'M-40 130 H65 L145 210 V375 L75 445 V770 L180 875 H345 L415 945 V1040',
  'M-40 340 H15 L65 290 V90 L155 0',
  'M160 -40 V60 L255 155 H410 L475 90 H650 L720 20 V-40',
  'M205 -40 V30 L295 120 H395 L460 55 H620 L680 -5',
  'M450 -40 V10 L520 80 H810 L860 130 H1040 L1160 10 V-40',
  'M1640 150 H1515 L1430 235 V445 L1510 525 V740 L1410 840 H1240 L1160 920 V1040',
  'M1640 190 H1550 L1465 275 V420 L1545 500 V775 L1440 880 H1270 L1200 950 V1040',
  'M1640 420 H1590 L1540 370 V110 L1430 0',
  'M1380 -40 V45 L1290 135 H1170 L1110 75 H980 L930 25 V-40',
  'M-40 970 H150 L245 875 H410 L520 985 H720 L800 905 H1000 L1095 1000',
  'M1640 960 H1490 L1390 910 H1300 L1210 1000',
];

export function SignalBackground({ animated }: { animated: boolean }) {
  const [visible, setVisible] = useState(() => !document.hidden);
  useEffect(() => {
    const update = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  return <svg className="pm-signal-background" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice"
    aria-hidden="true" focusable="false" data-animated={animated && visible}>
    {routes.map((d, i) => <g key={d} style={{ '--signal-duration': `${16 + i % 5 * 3}s`, '--signal-delay': `${-i * 3.7}s` } as CSSProperties}>
      <path className="pm-signal-track" d={d} />
      <path className="pm-signal-halo" d={d} pathLength={1000} />
      <path className="pm-signal-packet" d={d} pathLength={1000} />
    </g>)}
    {[[180,175],[110,470],[210,840],[475,90],[860,130],[1430,235],[1510,525],[1410,840],[1290,135],[800,905]].map(([cx,cy]) =>
      <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="2.5" className="pm-signal-node" />)}
  </svg>;
}
