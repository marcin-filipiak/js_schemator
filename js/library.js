/* Wbudowana biblioteka podzespołów (SVG + porty) */
import { emptyDoc, labelBlockLayout, LABEL_BLOCK_LAYOUT } from './model.js';

const S = 'fill="none" stroke="#111827" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
const BOX = 'fill="#ffffff" stroke="#111827" stroke-width="2" stroke-linejoin="round"';
const BLOCK_BOX = 'fill="#eff6ff" stroke="#2563eb" stroke-width="2" stroke-linejoin="round"';

const label = (x, y, text, size = 10) =>
  `<text x="${x}" y="${y}" font-family="Inter, system-ui, sans-serif" font-size="${size}" font-weight="600" fill="#111827" text-anchor="middle" dominant-baseline="middle">${text}</text>`;

const def = (name, category, w, h, inner, ports, extra = {}) => ({
  name,
  category,
  manufacturer: extra.manufacturer || '',
  partNumber: extra.partNumber || '',
  width: w,
  height: h,
  ...(extra.stretch ? { stretch: extra.stretch } : {}),
  graphic: {
    format: 'svg',
    data: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${inner}</svg>`,
    width: w,
    height: h
  },
  layout: extra.layout || '',
  ports: ports.map(([id, type, dir, x, y]) => ({ id, type, dir, x, y }))
});

const P = (id, x, y, dir = 'bi') => [id, 'pneumatic', dir, x, y];
const H = (id, x, y, dir = 'bi') => [id, 'hydraulic', dir, x, y];
const E = (id, x, y, dir = 'bi') => [id, 'electric', dir, x, y];
const G = (id, x, y, dir = 'bi') => [id, 'signal', dir, x, y];

/* ---------- symbole pneumatyczne wg ISO 1219 ---------- */
const VLV_TOP = 22;   // górna krawędź kwadratów położenia
const VLV_BOT = 70;   // dolna krawędź kwadratów
const VLV_H = 90;     // wysokość całego symbolu
const VLV_W = 138;    // szerokość całego symbolu
const VLV_MID = (VLV_TOP + VLV_BOT) / 2;

/** Linia przepływu z grotem (ISO 1219: strzałka = otwarte połączenie). */
const flowArrow = (x1, y1, x2, y2, head = 10) => {
  const a = Math.atan2(y2 - y1, x2 - x1);
  const back = head * 0.8;
  const half = head * 0.46;
  const bx = x2 - Math.cos(a) * back;
  const by = y2 - Math.sin(a) * back;
  const nx = Math.cos(a + Math.PI / 2) * half;
  const ny = Math.sin(a + Math.PI / 2) * half;
  const n = (v) => (Math.round(v * 10) / 10).toString();
  return `<path d="M${x1} ${y1}L${n(bx)} ${n(by)}" ${S}/>` +
    `<path d="M${x2} ${y2}L${n(bx + nx)} ${n(by + ny)}L${n(bx - nx)} ${n(by - ny)}Z" fill="#111827"/>`;
};

/** Zablokowane przyłącze (znak „T" przy dolnej krawędzi kwadratu). */
const blockedPort = (x) =>
  `<path d="M${x - 6} ${VLV_BOT - 8}H${x + 6}M${x} ${VLV_BOT - 8}V${VLV_BOT}" ${S}/>`;

/** Zawartość jednego kwadratu położenia (przesunięcie lokalne). */
const valveSquare = (x0, links, blocks) =>
  links.map(([ax, ay, bx, by]) => flowArrow(x0 + ax, ay, x0 + bx, by)).join('') +
  blocks.map((bx) => blockedPort(x0 + bx)).join('');

/** Sprężyna powrotna zaczepiona o prawą ścianę zaworu. */
const valveSpringRight = (x = 112) =>
  `<path d="M${x} ${VLV_MID}L${x + 3} ${VLV_MID - 10}L${x + 7} ${VLV_MID + 10}L${x + 11} ${VLV_MID - 10}L${x + 15} ${VLV_MID + 10}L${x + 19} ${VLV_MID - 10}L${x + 20} ${VLV_MID}" ${S}/>`;

/** Sprężyna wewnątrz siłownika (rysowana jako zygzak). */
const cylinderSpring = (x1, x2, y, amp = 14, half = 8) => {
  const step = (x2 - x1) / half;
  const pts = [`M${x1} ${y}`];
  for (let i = 1; i <= half; i++) {
    pts.push(`L${(x1 + step * i).toFixed(1)} ${y + (i % 2 ? -amp : amp)}`);
  }
  pts.push(`L${x2} ${y}`);
  return pts.join('');
};

/** Elektromagnes: prostokąt z przekątną i dwoma zaciskami prądowymi. */
const solenoid = (cx) =>
  `<rect x="${cx - 10}" y="${VLV_MID - 10}" width="20" height="20" ${BOX}/>` +
  `<path d="M${cx - 7} ${VLV_MID + 7}L${cx + 7} ${VLV_MID - 7}" ${S}/>` +
  `<path d="M${cx} ${VLV_MID - 10}V0M${cx} ${VLV_MID + 10}V${VLV_H}" ${S}/>`;

/**
 * Zawór rozdzielający 2-położeniowy wg ISO 1219.
 * ways: 3 lub 5, no: normalnie otwarty, bistable: dwa elektromagnesy.
 */
const pneumaticValve = (name, ways, no, bistable, extra) => {
  const X0 = 24;
  const X1 = X0 + 44;
  const XR = X0 + 88;

  const nc = ways === 3
    ? { links: [[14, VLV_TOP, 30, VLV_BOT]], blocks: [14] }        // 2→3, port 1 zamknięty
    : { links: [[35, VLV_TOP, 35, VLV_BOT], [22, VLV_BOT, 9, VLV_TOP]], blocks: [9] };
  const noOpen = ways === 3
    ? { links: [[14, VLV_BOT, 14, VLV_TOP]], blocks: [30] }        // 1→2, port 3 zamknięty
    : { links: [[22, VLV_BOT, 35, VLV_TOP], [9, VLV_TOP, 9, VLV_BOT]], blocks: [35] };

  const rest = no ? noOpen : nc;
  const actuated = no ? nc : noOpen;

  const stubs = ways === 3
    ? `<path d="M${X1 + 14} ${VLV_TOP}V0" ${S}/>` +
      `<path d="M${X1 + 14} ${VLV_BOT}V${VLV_H}M${X1 + 30} ${VLV_BOT}V${VLV_H}" ${S}/>`
    : `<path d="M${X1 + 9} ${VLV_TOP}V0M${X1 + 35} ${VLV_TOP}V0" ${S}/>` +
      `<path d="M${X1 + 9} ${VLV_BOT}V${VLV_H}M${X1 + 22} ${VLV_BOT}V${VLV_H}M${X1 + 35} ${VLV_BOT}V${VLV_H}" ${S}/>`;

  const axis = bistable
    ? solenoid(11) + `<path d="M21 ${VLV_MID}H${X0}" ${S}/>` +
      solenoid(124) + `<path d="M${XR} ${VLV_MID}H114" ${S}/>`
    : solenoid(11) + `<path d="M21 ${VLV_MID}H${X0}" ${S}/>` +
      valveSpringRight(XR);

  const ports = ways === 3
    ? [
      P('p', X1 + 14, VLV_H, 'in'),
      P('a', X1 + 14, 0, 'out'),
      P('r', X1 + 30, VLV_H, 'out')
    ]
    : [
      P('p', X1 + 22, VLV_H, 'in'),
      P('a', X1 + 35, 0, 'out'),
      P('b', X1 + 9, 0, 'out'),
      P('r', X1 + 35, VLV_H, 'out'),
      P('s', X1 + 9, VLV_H, 'out')
    ];

  if (bistable) {
    ports.push(E('y1_a', 11, 0), E('y1_b', 11, VLV_H), E('y2_a', 124, 0), E('y2_b', 124, VLV_H));
  } else {
    ports.push(E('y1_a', 11, 0), E('y1_b', 11, VLV_H));
  }

  const inner = `
    <rect x="${X0}" y="${VLV_TOP}" width="88" height="${VLV_BOT - VLV_TOP}" ${BOX}/>
    <path d="M${X1} ${VLV_TOP}V${VLV_BOT}" ${S}/>
    ${valveSquare(X1, rest.links, rest.blocks)}
    ${valveSquare(X0, actuated.links, actuated.blocks)}
    ${stubs}
    ${axis}
  `;

  return def(name, 'pneumatic', VLV_W, VLV_H, inner, ports, extra);
};

/* ---------- sterownik PLC ---------- */
const PLC_W = 220;
const PLC_H = 180;
const PLC_COLS = [70, 95, 120, 145, 170, 195];  // kolumny wejść I1..I6 i wyjść Q1..Q6

/**
 * Sterownik PLC: prostokąt z listwą zasilania po lewej
 * (24 V + GND u góry, 230 V + N + GND u dołu) oraz polami I/Q.
 */
const plcSymbol = () => {
  const ticks = PLC_COLS.map((x) => `M${x} 0V12M${x} 168V180`).join('') +
    'M0 36H12M0 56H12M0 124H12M0 142H12M0 160H12';
  const names = PLC_COLS
    .map((x, i) => label(x, 26, `I${i + 1}`, 8) + label(x, 154, `Q${i + 1}`, 8))
    .join('');

  const inner = `
    <rect x="12" y="12" width="196" height="156" ${BOX}/>
    <path d="M58 12V168" stroke="#cbd5e1" stroke-width="1" stroke-dasharray="6 5"/>
    <path d="${ticks}" ${S}/>
    ${label(33, 36, '24V', 8)}
    ${label(33, 56, 'GND', 8)}
    ${label(33, 124, '230V', 8)}
    ${label(33, 142, 'N', 8)}
    ${label(33, 160, 'GND', 8)}
    ${label(133, 92, 'PLC', 16)}
    ${names}
  `;

  const ports = [
    E('l24', 0, 36, 'in'),
    E('gnd24', 0, 56, 'in'),
    E('l230', 0, 124, 'in'),
    E('n230', 0, 142, 'in'),
    E('gnd230', 0, 160, 'in'),
    ...PLC_COLS.map((x, i) => E(`i${i + 1}`, x, 0, 'in')),
    ...PLC_COLS.map((x, i) => E(`q${i + 1}`, x, PLC_H, 'out'))
  ];

  return def('Sterownik PLC', 'electrical', PLC_W, PLC_H, inner, ports,
    { manufacturer: 'Siemens', partNumber: 'S7-1200' });
};

const blockBase = labelBlockLayout('Blok funkcjonalny');

export const BUILTIN_DEFINITIONS = {
  /* ---------------- Pneumatyka ---------------- */
  PNEU_VALVE_32_NC_MONO: pneumaticValve(
    'Elektrozawór 3/2 NZ monostabilny', 3, false, false,
    { manufacturer: 'Festo', partNumber: 'VUVG-L10-M32C-AZT-G18' }),

  PNEU_VALVE_32_NO_MONO: pneumaticValve(
    'Elektrozawór 3/2 NO monostabilny', 3, true, false,
    { manufacturer: 'Festo', partNumber: 'VUVG-L10-M32U-AZT-G18' }),

  PNEU_VALVE_32_NC_BI: pneumaticValve(
    'Elektrozawór 3/2 NZ bistabilny', 3, false, true,
    { manufacturer: 'Festo', partNumber: 'VUVG-L10-B32C-AZT-G18' }),

  PNEU_VALVE_32_NO_BI: pneumaticValve(
    'Elektrozawór 3/2 NO bistabilny', 3, true, true,
    { manufacturer: 'Festo', partNumber: 'VUVG-L10-B32U-AZT-G18' }),

  PNEU_VALVE_52_NC_MONO: pneumaticValve(
    'Elektrozawór 5/2 NZ monostabilny', 5, false, false,
    { manufacturer: 'Festo', partNumber: 'VUVG-L14-M52C-AZT-G18' }),

  PNEU_VALVE_52_NO_MONO: pneumaticValve(
    'Elektrozawór 5/2 NO monostabilny', 5, true, false,
    { manufacturer: 'Festo', partNumber: 'VUVG-L14-M52U-AZT-G18' }),

  PNEU_VALVE_52_NC_BI: pneumaticValve(
    'Elektrozawór 5/2 NZ bistabilny', 5, false, true,
    { manufacturer: 'Festo', partNumber: 'VUVG-L14-B52C-AZT-G18' }),

  PNEU_VALVE_52_NO_BI: pneumaticValve(
    'Elektrozawór 5/2 NO bistabilny', 5, true, true,
    { manufacturer: 'Festo', partNumber: 'VUVG-L14-B52U-AZT-G18' }),

  PNEU_CYLINDER_DA: def('Siłownik dwustronnego działania', 'pneumatic', 160, 100, `
    <rect x="20" y="22" width="100" height="52" ${BOX}/>
    <rect x="32" y="22" width="6" height="52" fill="#111827"/>
    <path d="M38 43H150M38 53H150" ${S}/>
    <path d="M30 74V100M100 74V100" ${S}/>
  `, [
    P('a', 30, 100, 'in'),
    P('b', 100, 100, 'in')
  ], { manufacturer: 'Festo', partNumber: 'DSBC-32-100-PPVA' }),

  PNEU_CYLINDER_SA: def('Siłownik jednostronny ze sprężyną', 'pneumatic', 160, 100, `
    <rect x="20" y="22" width="100" height="52" ${BOX}/>
    <rect x="32" y="22" width="6" height="52" fill="#111827"/>
    <path d="M38 43H150M38 53H150" ${S}/>
    <path d="${cylinderSpring(46, 114, 48)}" ${S}/>
    <path d="M30 74V100" ${S}/>
  `, [P('a', 30, 100, 'in')], { manufacturer: 'Festo', partNumber: 'DSNU-32-100-P-A' }),

  PNEU_SUPPLY: def('Zasilanie sprężonym powietrzem', 'pneumatic', 60, 40, `
    <path d="M15 8L15 32L45 20Z" ${BOX}/>
    <path d="M45 20H60" ${S}/>
    <circle cx="23" cy="20" r="3.5" fill="#111827"/>
  `, [P('out_1', 60, 20, 'out')], { manufacturer: 'Atlas Copco', partNumber: 'FD 10' }),

  PNEU_FRL: def('Zespół przygotowania powietrza', 'pneumatic', 150, 96, `
    <rect x="6" y="12" width="138" height="70" rx="2" stroke-dasharray="10 4 2 4" ${S}/>
    <path d="M0 49H26M52 49H64M90 49H100M126 49H150" ${S}/>
    <rect x="26" y="36" width="26" height="26" ${BOX}/>
    <path d="M26 62L52 36" ${S}/>
    <path d="M39 62V67M33 67H45M33 67L39 74L45 67" ${S}/>
    <rect x="64" y="36" width="26" height="26" ${BOX}/>
    <path d="M68 57L86 39" ${S}/>
    <path d="M77 36L73 32L81 28L73 24L77 19" ${S}/>
    <rect x="100" y="36" width="26" height="26" ${BOX}/>
    <path d="M113 40C110 45 108 49 108 53A5 5 0 0 0 118 53C118 49 116 45 113 40Z" ${S}/>
  `, [
    P('p', 0, 49, 'in'),
    P('a', 150, 49, 'out')
  ], { manufacturer: 'Festo', partNumber: 'FRL-1/4-D-MINI' }),

  PNEU_THROTTLE: def('Dławik nastawialny', 'pneumatic', 60, 40, `
    <path d="M0 20H14M46 20H60M14 8V32M46 8V32" ${S}/>
    <path d="M18 32L42 8" ${S}/>
    <path d="M42 8H31M42 8V19" ${S}/>
  `, [P('in_1', 0, 20), P('out_2', 60, 20)], { manufacturer: 'Festo', partNumber: 'GRLZ-1/4' }),

  PNEU_GAUGE: def('Manometr', 'pneumatic', 50, 50, `
    <circle cx="25" cy="21" r="16" ${BOX}/>
    <path d="M25 21L33 12M25 37V50" ${S}/>
    <path d="M9 21H5M41 21H45" ${S}/>
  `, [P('in_1', 25, 50, 'in')], { manufacturer: 'Festo', partNumber: 'MA-40' }),

  /* ---------------- Elektronika ---------------- */
  EL_RESISTOR: def('Rezystor', 'electronic', 60, 24, `
    <path d="M0 12H12L18 3L24 21L30 3L36 21L42 3L48 12H60" ${S}/>
  `, [E('a', 0, 12), E('b', 60, 12)], { manufacturer: 'Vishay', partNumber: 'MRS25' }),

  EL_CAPACITOR: def('Kondensator', 'electronic', 40, 40, `
    <path d="M0 20H14M26 20H40M14 8V32M26 8V32" ${S}/>
  `, [E('a', 0, 20), E('b', 40, 20)], { manufacturer: 'KEMET', partNumber: 'C-100N' }),

  EL_DIODE: def('Dioda', 'electronic', 50, 30, `
    <path d="M0 15H15M35 15H50" ${S}/>
    <path d="M15 5L35 15L15 25Z" ${BOX}/>
    <path d="M35 5V25" ${S}/>
  `, [E('anode', 0, 15, 'in'), E('cathode', 50, 15, 'out')], { manufacturer: 'ON Semi', partNumber: '1N4148' }),

  EL_LED: def('Dioda LED', 'electronic', 54, 42, `
    <path d="M0 22H15M35 22H54" ${S}/>
    <path d="M15 12L35 22L15 32Z" ${BOX}/>
    <path d="M35 12V32" ${S}/>
    <path d="M25 16L33 8M33 8H27M33 8V14M31 21L39 13M39 13H33M39 13V19" ${S}/>
  `, [E('anode', 0, 22, 'in'), E('cathode', 54, 22, 'out')], { manufacturer: 'Kingbright', partNumber: 'L-53SRD' }),

  EL_TRANSISTOR_NPN: def('Tranzystor NPN', 'electronic', 60, 60, `
    <circle cx="34" cy="30" r="23" ${BOX}/>
    <path d="M0 30H22M22 17V43M22 23L38 11V0M22 37L38 49V60" ${S}/>
    <path d="M30 43L38 49L29 50Z" fill="#111827"/>
  `, [
    E('base', 0, 30, 'in'),
    E('collector', 38, 0, 'out'),
    E('emitter', 38, 60, 'out')
  ], { manufacturer: 'STMicroelectronics', partNumber: '2N3904' }),

  EL_TRANSISTOR_PNP: def('Tranzystor PNP', 'electronic', 60, 60, `
    <circle cx="34" cy="30" r="23" ${BOX}/>
    <path d="M0 30H22M22 17V43M22 23L38 11V0M22 37L38 49V60" ${S}/>
    <path d="M30 43L22 37L31 36Z" fill="#111827"/>
  `, [
    E('base', 0, 30, 'in'),
    E('collector', 38, 0, 'out'),
    E('emitter', 38, 60, 'out')
  ], { manufacturer: 'STMicroelectronics', partNumber: '2N3906' }),

  EL_GROUND: def('Masa', 'electronic', 40, 40, `
    <path d="M20 0V18M8 18H32M12 26H28M16 34H24" ${S}/>
  `, [E('gnd', 20, 0, 'in')]),

  EL_SWITCH: def('Przełącznik', 'electronic', 60, 30, `
    <path d="M0 15H14M46 15H60" ${S}/>
    <circle cx="16" cy="15" r="2.5" ${BOX}/>
    <circle cx="44" cy="15" r="2.5" ${BOX}/>
    <path d="M18 13L40 5" ${S}/>
  `, [E('a', 0, 15), E('b', 60, 15)], { manufacturer: 'Omron', partNumber: 'SS-5GL' }),

  EL_LAMP: def('Żarówka', 'electronic', 50, 40, `
    <circle cx="25" cy="20" r="13" ${BOX}/>
    <path d="M0 20H12M38 20H50M17 12L33 28M33 12L17 28" ${S}/>
  `, [E('a', 0, 20), E('b', 50, 20)], { manufacturer: 'Philips', partNumber: '12V/5W' }),

  EL_INDUCTOR: def('Cewka indukcyjna', 'electronic', 60, 30, `
    <path d="M0 15H12M48 15H60" ${S}/>
    <path d="M12 15A6 6 0 0 1 24 15A6 6 0 0 1 36 15A6 6 0 0 1 48 15" ${S}/>
  `, [E('a', 0, 15), E('b', 60, 15)], { manufacturer: 'Bourns', partNumber: 'SRR-100' }),

  EL_OPAMP: def('Wzmacniacz operacyjny', 'electronic', 70, 60, `
    <path d="M10 8V52L60 30Z" ${BOX}/>
    <path d="M0 22H10M0 40H10M60 30H70" ${S}/>
    ${label(17, 25, '+', 13)}
    ${label(17, 43, '−', 13)}
  `, [
    E('in_plus', 0, 22, 'in'),
    E('in_minus', 0, 40, 'in'),
    E('out', 70, 30, 'out')
  ], { manufacturer: 'Texas Instruments', partNumber: 'LM358' }),

  EL_BATTERY: def('Bateria', 'electronic', 50, 40, `
    <path d="M0 20H18M36 20H50" ${S}/>
    <path d="M18 6V34M24 13V27M30 6V34M36 13V27" ${S}/>
  `, [E('plus', 0, 20), E('minus', 50, 20)], { manufacturer: 'Duracell', partNumber: '9V' }),

  EL_MOTOR: def('Silnik DC', 'electronic', 60, 60, `
    <circle cx="30" cy="30" r="22" ${BOX}/>
    ${label(30, 30, 'M', 14)}
    <path d="M0 30H8M52 30H60" ${S}/>
  `, [E('plus', 0, 30, 'in'), E('minus', 60, 30, 'in')], { manufacturer: 'Maxon', partNumber: 'DC-24V' }),

  /* Rdzeń transformatora — bez portów, rozciągany w pionie. */
  EL_TRANSFORMER_CORE: def('Rdzeń transformatora', 'electronic', 28, 90, `
    <path d="M8 4V86M20 4V86" ${S}/>
  `, [], { stretch: { axis: 'y', min: 40, max: 600 } }),

  EL_AC_SUPPLY: def('Zasilanie AC', 'electronic', 64, 48, `
    <circle cx="32" cy="24" r="18" ${BOX}/>
    <path d="M0 24H14M50 24H64" ${S}/>
    <path d="M16 24Q20 13 24 24T32 24T40 24T48 24" ${S}/>
  `, [E('a', 0, 24, 'in'), E('b', 64, 24, 'out')]),

  EL_ZENER: def('Dioda Zenera', 'electronic', 56, 34, `
    <path d="M0 17H18M38 17H56" ${S}/>
    <path d="M18 7L38 17L18 27Z" ${BOX}/>
    <path d="M44 3H38V31H32" ${S}/>
  `, [E('anode', 0, 17, 'in'), E('cathode', 56, 17, 'out')], { manufacturer: 'ON Semi', partNumber: '1N4733' }),

  EL_CAPACITOR_POLARIZED: def('Kondensator spolaryzowany', 'electronic', 48, 44, `
    <path d="M0 22H16M32 22H48" ${S}/>
    <path d="M16 10V34" ${S}/>
    <path d="M32 10Q38 22 32 34" ${S}/>
    <path d="M22 6H30M26 2V10" ${S}/>
  `, [E('plus', 0, 22, 'in'), E('minus', 48, 22, 'out')], { manufacturer: 'Panasonic', partNumber: 'EEU-FR1V101' }),

  EL_POTENTIOMETER: def('Rezystor nastawny', 'electronic', 74, 54, `
    <path d="M0 34H10L15 26L21 42L27 26L33 42L39 26L45 42L50 34H74" ${S}/>
    <path d="M30 0V25" ${S}/>
    <path d="M30 34L25 25H35Z" fill="#111827"/>
  `, [
    E('a', 0, 34),
    E('b', 74, 34),
    E('wiper', 30, 0, 'in')
  ], { manufacturer: 'Bourns', partNumber: 'PTV09A' }),

  EL_GATE_NOT: def('Bramka NOT', 'electronic', 62, 42, `
    <path d="M0 21H12M54 21H62" ${S}/>
    <path d="M12 7V35L46 21Z" ${BOX}/>
    <circle cx="50" cy="21" r="4" ${BOX}/>
  `, [E('in_1', 0, 21, 'in'), E('out', 62, 21, 'out')]),

  EL_GATE_AND: def('Bramka AND', 'electronic', 76, 52, `
    <path d="M0 18H12M0 34H12M56 26H76" ${S}/>
    <path d="M12 8H38A18 18 0 0 1 38 44H12Z" ${BOX}/>
  `, [E('in_1', 0, 18, 'in'), E('in_2', 0, 34, 'in'), E('out', 76, 26, 'out')]),

  EL_GATE_NAND: def('Bramka NAND', 'electronic', 76, 52, `
    <path d="M0 18H12M0 34H12M64 26H76" ${S}/>
    <path d="M12 8H38A18 18 0 0 1 38 44H12Z" ${BOX}/>
    <circle cx="60" cy="26" r="4" ${BOX}/>
  `, [E('in_1', 0, 18, 'in'), E('in_2', 0, 34, 'in'), E('out', 76, 26, 'out')]),

  EL_GATE_OR: def('Bramka OR', 'electronic', 76, 52, `
    <path d="M0 16H13M0 36H13M52 26H76" ${S}/>
    <path d="M10 8Q24 26 10 44Q40 44 52 26Q40 8 10 8Z" ${BOX}/>
  `, [E('in_1', 0, 16, 'in'), E('in_2', 0, 36, 'in'), E('out', 76, 26, 'out')]),

  EL_GATE_NOR: def('Bramka NOR', 'electronic', 76, 52, `
    <path d="M0 16H13M0 36H13M60 26H76" ${S}/>
    <path d="M10 8Q24 26 10 44Q40 44 52 26Q40 8 10 8Z" ${BOX}/>
    <circle cx="56" cy="26" r="4" ${BOX}/>
  `, [E('in_1', 0, 16, 'in'), E('in_2', 0, 36, 'in'), E('out', 76, 26, 'out')]),

  EL_VOLTMETER: def('Woltomierz', 'electronic', 56, 56, `
    <circle cx="28" cy="28" r="22" ${BOX}/>
    <path d="M0 28H6M50 28H56" ${S}/>
    ${label(28, 29, 'V', 16)}
  `, [E('a', 0, 28), E('b', 56, 28)]),

  EL_AMMETER: def('Amperomierz', 'electronic', 56, 56, `
    <circle cx="28" cy="28" r="22" ${BOX}/>
    <path d="M0 28H6M50 28H56" ${S}/>
    ${label(28, 29, 'A', 16)}
  `, [E('a', 0, 28), E('b', 56, 28)]),

  EL_OHMMETER: def('Omomierz', 'electronic', 56, 56, `
    <circle cx="28" cy="28" r="22" ${BOX}/>
    <path d="M0 28H6M50 28H56" ${S}/>
    ${label(28, 29, 'Ω', 16)}
  `, [E('a', 0, 28), E('b', 56, 28)]),

  EL_ANTENNA: def('Antena', 'electronic', 64, 66, `
    <path d="M32 66V22M32 22L14 4M32 22L50 4" ${S}/>
    <circle cx="32" cy="22" r="2.5" fill="#111827"/>
  `, [E('feed', 32, 66, 'in')]),

  EL_SPEAKER: def('Głośnik', 'electronic', 68, 56, `
    <rect x="8" y="18" width="14" height="20" ${BOX}/>
    <path d="M22 18L44 6V50L22 38Z" ${BOX}/>
    <path d="M0 22H8M0 34H8" ${S}/>
    <path d="M50 16Q57 28 50 40M56 10Q65 28 56 46" ${S}/>
  `, [E('a', 0, 22, 'in'), E('b', 0, 34, 'in')]),

  EL_MICROPHONE: def('Mikrofon', 'electronic', 56, 46, `
    <circle cx="28" cy="26" r="16" ${BOX}/>
    <path d="M14 10H42" ${S}/>
    <path d="M0 26H12M44 26H56" ${S}/>
  `, [E('a', 0, 26), E('b', 56, 26)]),

  EL_PHOTODIODE: def('Fotodioda', 'electronic', 64, 46, `
    <path d="M0 26H20M44 26H64" ${S}/>
    <path d="M20 14L44 26L20 38Z" ${BOX}/>
    <path d="M44 14V38" ${S}/>
    <path d="M14 2L26 12M26 12L18.4 10.2M26 12L22.8 4.8" ${S}/>
    <path d="M30 2L42 12M42 12L34.4 10.2M42 12L38.8 4.8" ${S}/>
  `, [E('anode', 0, 26, 'in'), E('cathode', 64, 26, 'out')]),

  EL_PHOTORESISTOR: def('Fotorezystor', 'electronic', 66, 48, `
    <path d="M0 30H8L13 22L19 38L25 22L31 38L37 22L43 38L48 30H66" ${S}/>
    <path d="M14 4L26 14M26 14L18.4 12.2M26 14L22.8 6.8" ${S}/>
    <path d="M30 4L42 14M42 14L34.4 12.2M42 14L38.8 6.8" ${S}/>
  `, [E('a', 0, 30), E('b', 66, 30)]),

  EL_QUARTZ: def('Rezonator kwarcowy', 'electronic', 66, 42, `
    <path d="M0 21H16M50 21H66" ${S}/>
    <path d="M16 9V33M50 9V33" ${S}/>
    <rect x="24" y="13" width="18" height="16" ${BOX}/>
  `, [E('a', 0, 21), E('b', 66, 21)]),

  EL_THYRISTOR: def('Tyrystor', 'electronic', 72, 60, `
    <path d="M0 24H18M42 24H72" ${S}/>
    <path d="M18 12L42 24L18 36Z" ${BOX}/>
    <path d="M42 12V36" ${S}/>
    <path d="M42 34L30 60" ${S}/>
  `, [
    E('anode', 0, 24, 'in'),
    E('cathode', 72, 24, 'out'),
    E('gate', 30, 60, 'in')
  ]),

  EL_TRIAC: def('Triak', 'electronic', 68, 64, `
    <path d="M0 32H16M52 32H68" ${S}/>
    <path d="M16 8V56M52 8V56" ${S}/>
    <path d="M52 8L16 18L52 28Z" ${BOX}/>
    <path d="M16 36L52 46L16 56Z" ${BOX}/>
    <path d="M52 50L60 60H68" ${S}/>
  `, [
    E('mt2', 0, 32),
    E('mt1', 68, 32),
    E('gate', 68, 60, 'in')
  ]),

  EL_DIAC: def('Diak', 'electronic', 68, 64, `
    <path d="M0 32H16M52 32H68" ${S}/>
    <path d="M16 8V56M52 8V56" ${S}/>
    <path d="M52 8L16 18L52 28Z" ${BOX}/>
    <path d="M16 36L52 46L16 56Z" ${BOX}/>
  `, [
    E('a', 0, 32),
    E('b', 68, 32)
  ]),

  EL_CAPACITOR_VARIABLE: def('Kondensator nastawny', 'electronic', 56, 46, `
    <path d="M0 23H20M36 23H56" ${S}/>
    <path d="M20 10V36M36 10V36" ${S}/>
    <path d="M12 40L44 6M44 6L36 8M44 6L42 14" ${S}/>
  `, [E('a', 0, 23), E('b', 56, 23)]),

  EL_INDUCTOR_VARIABLE: def('Cewka nastawna', 'electronic', 66, 46, `
    <path d="M0 26H10M52 26H66" ${S}/>
    <path d="M10 26A7 7 0 0 1 24 26A7 7 0 0 1 38 26A7 7 0 0 1 52 26" ${S}/>
    <path d="M14 40L54 8M54 8L46 10M54 8L52 16" ${S}/>
  `, [E('a', 0, 26), E('b', 66, 26)]),

  EL_MOSFET_N: def('MOSFET z kanałem N', 'electronic', 56, 64, `
    <path d="M0 32H12M12 12V52" ${S}/>
    <path d="M22 12V22M22 27V37M22 42V52" ${S}/>
    <path d="M22 16H42V0M22 48H42V64" ${S}/>
    <path d="M22 32H34V48" ${S}/>
    <path d="M22 32L30 28V36Z" fill="#111827"/>
  `, [
    E('gate', 0, 32, 'in'),
    E('drain', 42, 0, 'out'),
    E('source', 42, 64, 'out')
  ]),

  EL_MOSFET_P: def('MOSFET z kanałem P', 'electronic', 56, 64, `
    <path d="M0 32H12M12 12V52" ${S}/>
    <path d="M22 12V22M22 27V37M22 42V52" ${S}/>
    <path d="M22 16H42V0M22 48H42V64" ${S}/>
    <path d="M22 32H34V48" ${S}/>
    <path d="M30 32L22 28V36Z" fill="#111827"/>
  `, [
    E('gate', 0, 32, 'in'),
    E('drain', 42, 0, 'out'),
    E('source', 42, 64, 'out')
  ]),

  /* ---------------- Elektryka ---------------- */
  ELE_CONTACT_NO: def('Styk NO', 'electrical', 60, 30, `
    <path d="M0 15H14M46 15H60" ${S}/>
    <circle cx="16" cy="15" r="2.5" ${BOX}/>
    <circle cx="44" cy="15" r="2.5" ${BOX}/>
    <path d="M18 13L42 7" ${S}/>
  `, [E('in', 0, 15, 'in'), E('out', 60, 15, 'out')], { manufacturer: 'Schneider', partNumber: 'XB4-BA31' }),

  ELE_CONTACT_NC: def('Styk NC', 'electrical', 60, 30, `
    <path d="M0 15H14M46 15H60" ${S}/>
    <circle cx="16" cy="15" r="2.5" ${BOX}/>
    <circle cx="44" cy="15" r="2.5" ${BOX}/>
    <path d="M18 15L42 15M30 8V22" ${S}/>
  `, [E('in', 0, 15, 'in'), E('out', 60, 15, 'out')], { manufacturer: 'Schneider', partNumber: 'XB4-BA42' }),

  ELE_COIL: def('Cewka stycznika', 'electrical', 60, 30, `
    <rect x="14" y="5" width="32" height="20" rx="2" ${BOX}/>
    <path d="M0 15H14M46 15H60" ${S}/>
    ${label(30, 16, 'K', 11)}
  `, [E('a1', 0, 15, 'in'), E('a2', 60, 15, 'out')], { manufacturer: 'Schneider', partNumber: 'LC1-D09' }),

  ELE_MOTOR_3PH: def('Silnik trójfazowy', 'electrical', 70, 60, `
    <circle cx="35" cy="30" r="23" ${BOX}/>
    ${label(35, 27, 'M', 14)}
    ${label(35, 39, '3~', 9)}
    <path d="M0 15H12M0 30H12M0 45H12" ${S}/>
  `, [
    E('u', 0, 15, 'in'),
    E('v', 0, 30, 'in'),
    E('w', 0, 45, 'in')
  ], { manufacturer: 'Siemens', partNumber: '1LE1' }),

  ELE_FUSE: def('Bezpiecznik', 'electrical', 60, 30, `
    <rect x="14" y="9" width="32" height="12" rx="2" ${BOX}/>
    <path d="M0 15H14M46 15H60M14 15H46" ${S}/>
  `, [E('in', 0, 15, 'in'), E('out', 60, 15, 'out')], { manufacturer: 'Littelfuse', partNumber: '5x20' }),

  ELE_MCB_1P: def('Wyłącznik nadprądowy 1P', 'electrical', 60, 40, `
    <path d="M0 20H18M18 20L36 13M37 20H60" ${S}/>
    <path d="M33.5 16.5L40.5 23.5M40.5 16.5L33.5 23.5" ${S}/>
  `, [
    E('in', 0, 20, 'in'),
    E('out', 60, 20, 'out')
  ], { manufacturer: 'Eaton', partNumber: 'FAZ-C16/1' }),

  ELE_MCB_2P: def('Wyłącznik nadprądowy 2P', 'electrical', 60, 64, `
    <path d="M0 20H18M18 20L36 13M37 20H60" ${S}/>
    <path d="M33.5 16.5L40.5 23.5M40.5 16.5L33.5 23.5" ${S}/>
    <path d="M0 48H18M18 48L36 41M37 48H60" ${S}/>
    <path d="M33.5 44.5L40.5 51.5M40.5 44.5L33.5 51.5" ${S}/>
    <path d="M28 16V44" stroke-dasharray="5 4" ${S}/>
  `, [
    E('in_1', 0, 20, 'in'),
    E('out_1', 60, 20, 'out'),
    E('in_2', 0, 48, 'in'),
    E('out_2', 60, 48, 'out')
  ], { manufacturer: 'Eaton', partNumber: 'FAZ-C16/2' }),

  ELE_MCB_3P: def('Wyłącznik nadprądowy 3P', 'electrical', 60, 92, `
    <path d="M0 20H18M18 20L36 13M37 20H60" ${S}/>
    <path d="M33.5 16.5L40.5 23.5M40.5 16.5L33.5 23.5" ${S}/>
    <path d="M0 48H18M18 48L36 41M37 48H60" ${S}/>
    <path d="M33.5 44.5L40.5 51.5M40.5 44.5L33.5 51.5" ${S}/>
    <path d="M0 76H18M18 76L36 69M37 76H60" ${S}/>
    <path d="M33.5 72.5L40.5 79.5M40.5 72.5L33.5 79.5" ${S}/>
    <path d="M28 16V72" stroke-dasharray="5 4" ${S}/>
  `, [
    E('in_1', 0, 20, 'in'),
    E('out_1', 60, 20, 'out'),
    E('in_2', 0, 48, 'in'),
    E('out_2', 60, 48, 'out'),
    E('in_3', 0, 76, 'in'),
    E('out_3', 60, 76, 'out')
  ], { manufacturer: 'Eaton', partNumber: 'FAZ-C16/3' }),

  ELE_RCD_1P: def('Wyłącznik różnicowoprądowy 1P', 'electrical', 80, 54, `
    <path d="M0 36H37.5M60.5 36H80" ${S}/>
    <circle cx="40" cy="36" r="2.5" ${BOX}/>
    <circle cx="58" cy="36" r="2.5" ${BOX}/>
    <path d="M42 34L56 28" ${S}/>
    <ellipse cx="26" cy="36" rx="9" ry="10" ${S}/>
    <rect x="20" y="6" width="12" height="10" ${BOX}/>
    ${label(26, 11.5, 'T', 8)}
    <path d="M26 16V26" stroke-dasharray="4 3" ${S}/>
  `, [
    E('in', 0, 36, 'in'),
    E('out', 80, 36, 'out')
  ], { manufacturer: 'Schneider', partNumber: 'iID-40A/30mA' }),

  ELE_RCD_2P: def('Wyłącznik różnicowoprądowy 2P', 'electrical', 80, 82, `
    <path d="M0 36H37.5M60.5 36H80" ${S}/>
    <circle cx="40" cy="36" r="2.5" ${BOX}/>
    <circle cx="58" cy="36" r="2.5" ${BOX}/>
    <path d="M42 34L56 28" ${S}/>
    <path d="M0 64H37.5M60.5 64H80" ${S}/>
    <circle cx="40" cy="64" r="2.5" ${BOX}/>
    <circle cx="58" cy="64" r="2.5" ${BOX}/>
    <path d="M42 62L56 56" ${S}/>
    <ellipse cx="26" cy="50" rx="9" ry="24" ${S}/>
    <rect x="20" y="6" width="12" height="10" ${BOX}/>
    ${label(26, 11.5, 'T', 8)}
    <path d="M26 16V26" stroke-dasharray="4 3" ${S}/>
    <path d="M49 31V59" stroke-dasharray="5 4" ${S}/>
  `, [
    E('in_1', 0, 36, 'in'),
    E('out_1', 80, 36, 'out'),
    E('in_2', 0, 64, 'in'),
    E('out_2', 80, 64, 'out')
  ], { manufacturer: 'Schneider', partNumber: 'iID-40A/30mA' }),

  ELE_RCD_3P: def('Wyłącznik różnicowoprądowy 3P', 'electrical', 80, 110, `
    <path d="M0 36H37.5M60.5 36H80" ${S}/>
    <circle cx="40" cy="36" r="2.5" ${BOX}/>
    <circle cx="58" cy="36" r="2.5" ${BOX}/>
    <path d="M42 34L56 28" ${S}/>
    <path d="M0 64H37.5M60.5 64H80" ${S}/>
    <circle cx="40" cy="64" r="2.5" ${BOX}/>
    <circle cx="58" cy="64" r="2.5" ${BOX}/>
    <path d="M42 62L56 56" ${S}/>
    <path d="M0 92H37.5M60.5 92H80" ${S}/>
    <circle cx="40" cy="92" r="2.5" ${BOX}/>
    <circle cx="58" cy="92" r="2.5" ${BOX}/>
    <path d="M42 90L56 84" ${S}/>
    <ellipse cx="26" cy="64" rx="9" ry="38" ${S}/>
    <rect x="20" y="6" width="12" height="10" ${BOX}/>
    ${label(26, 11.5, 'T', 8)}
    <path d="M26 16V26" stroke-dasharray="4 3" ${S}/>
    <path d="M49 31V87" stroke-dasharray="5 4" ${S}/>
  `, [
    E('in_1', 0, 36, 'in'),
    E('out_1', 80, 36, 'out'),
    E('in_2', 0, 64, 'in'),
    E('out_2', 80, 64, 'out'),
    E('in_3', 0, 92, 'in'),
    E('out_3', 80, 92, 'out')
  ], { manufacturer: 'Schneider', partNumber: 'iID-40A/30mA' }),

  ELE_ISOLATOR_3P: def('Rozłącznik izolacyjny 3P', 'electrical', 60, 92, `
    <path d="M0 20H14M46.5 20H60" ${S}/>
    <circle cx="16" cy="20" r="2.5" ${BOX}/>
    <circle cx="44" cy="20" r="2.5" ${BOX}/>
    <path d="M18 18L42 12" ${S}/>
    <path d="M48 15V25" ${S}/>
    <path d="M0 48H14M46.5 48H60" ${S}/>
    <circle cx="16" cy="48" r="2.5" ${BOX}/>
    <circle cx="44" cy="48" r="2.5" ${BOX}/>
    <path d="M18 46L42 40" ${S}/>
    <path d="M48 43V53" ${S}/>
    <path d="M0 76H14M46.5 76H60" ${S}/>
    <circle cx="16" cy="76" r="2.5" ${BOX}/>
    <circle cx="44" cy="76" r="2.5" ${BOX}/>
    <path d="M18 74L42 68" ${S}/>
    <path d="M48 71V81" ${S}/>
    <path d="M30 16V72" stroke-dasharray="5 4" ${S}/>
  `, [
    E('in_1', 0, 20, 'in'),
    E('out_1', 60, 20, 'out'),
    E('in_2', 0, 48, 'in'),
    E('out_2', 60, 48, 'out'),
    E('in_3', 0, 76, 'in'),
    E('out_3', 60, 76, 'out')
  ], { manufacturer: 'Eaton', partNumber: 'IS-63/3' }),

  ELE_SPD_DEHNGUARD: def('Iskrownik DEHNguard', 'electrical', 40, 76, `
    <rect x="8" y="16" width="24" height="40" ${BOX}/>
    <path d="M20 0V16M20 56V76" ${S}/>
    <path d="M12 24L20 33L28 24" ${S}/>
    <path d="M12 48L20 39L28 48" ${S}/>
  `, [
    E('l', 20, 0, 'in'),
    E('pe', 20, 76, 'out')
  ], { manufacturer: 'DEHN', partNumber: 'DG M TN 275' }),

  ELE_GROUND: def('Uziemienie', 'electrical', 40, 40, `
    <path d="M20 0V22" ${S}/>
    <path d="M7 22H33" ${S}/>
    <path d="M12 28H28" ${S}/>
    <path d="M16.5 34H23.5" ${S}/>
  `, [E('pe', 20, 0, 'in')]),

  ELE_PLC: plcSymbol(),

  /* Zasilanie trójfazowe 3L+N+PE (IEC 60617). */
  ELE_SUPPLY_3PH: def('Zasilanie trójfazowe', 'electrical', 100, 120, `
    <path d="M24 22H100M24 42H100M24 62H100M24 86H100M24 110H100" ${S}/>
    <circle cx="24" cy="22" r="2.5" fill="#111827"/>
    <circle cx="24" cy="42" r="2.5" fill="#111827"/>
    <circle cx="24" cy="62" r="2.5" fill="#111827"/>
    <circle cx="24" cy="86" r="2.5" fill="#111827"/>
    <circle cx="24" cy="110" r="2.5" fill="#111827"/>
    ${label(11, 22, 'L1', 8)}
    ${label(11, 42, 'L2', 8)}
    ${label(11, 62, 'L3', 8)}
    ${label(11, 86, 'N', 8)}
    ${label(11, 110, 'PE', 8)}
    ${label(86, 8, '3~', 9)}
  `, [
    E('l1', 100, 22, 'out'),
    E('l2', 100, 42, 'out'),
    E('l3', 100, 62, 'out'),
    E('n', 100, 86, 'out'),
    E('pe', 100, 110, 'out')
  ]),

  /* Zasilanie jednofazowe L+N+PE. */
  ELE_SUPPLY_1PH: def('Zasilanie jednofazowe', 'electrical', 84, 76, `
    <path d="M24 22H84M24 42H84M24 62H84" ${S}/>
    <circle cx="24" cy="22" r="2.5" fill="#111827"/>
    <circle cx="24" cy="42" r="2.5" fill="#111827"/>
    <circle cx="24" cy="62" r="2.5" fill="#111827"/>
    ${label(11, 22, 'L', 8)}
    ${label(11, 42, 'N', 8)}
    ${label(11, 62, 'PE', 8)}
    ${label(70, 8, '1~', 9)}
  `, [
    E('l', 84, 22, 'out'),
    E('n', 84, 42, 'out'),
    E('pe', 84, 62, 'out')
  ]),

  /* Gniazdo ze stykiem ochronnym. */
  ELE_SOCKET: def('Gniazdo', 'electrical', 72, 72, `
    <path d="M32 16A20 20 0 0 1 32 56" ${S}/>
    <path d="M32 16V56" ${S}/>
    <path d="M0 26H32M0 40H32M0 54H32" ${S}/>
    <circle cx="32" cy="26" r="2" fill="#111827"/>
    <circle cx="32" cy="40" r="2" fill="#111827"/>
    <circle cx="32" cy="54" r="2" fill="#111827"/>
    ${label(10, 22, 'L', 7)}
    ${label(10, 36, 'N', 7)}
    ${label(11, 50, 'PE', 7)}
  `, [
    E('l', 0, 26),
    E('n', 0, 40),
    E('pe', 0, 54)
  ]),

  /* ---------------- Hydraulika ---------------- */
  HYD_PRESSURE_SWITCH: def('Włącznik ciśnieniowy', 'hydraulic', 70, 40, `
    <path d="M0 20H16M44 12H70M44 28H70" ${S}/>
    <path d="M16 8C24 14 24 26 16 32Z" ${BOX}/>
    <path d="M24 20H40" ${S}/>
    <circle cx="48" cy="12" r="2.5" ${BOX}/>
    <circle cx="48" cy="28" r="2.5" ${BOX}/>
    <path d="M46 14L54 26" ${S}/>
  `, [
    H('in', 0, 20, 'in'),
    E('a', 70, 12),
    E('b', 70, 28)
  ], { manufacturer: 'Danfoss', partNumber: 'KP35' }),

  HYD_ELECTRIC_PUMP: def('Pompa elektryczna', 'hydraulic', 70, 60, `
    <circle cx="30" cy="32" r="20" ${BOX}/>
    <path d="M22 18L42 32L22 46Z" fill="#111827"/>
    <path d="M0 32H10M50 32H70" ${S}/>
    <path d="M18 16V0M42 16V0" ${S}/>
  `, [
    H('in', 0, 32, 'in'),
    H('out', 70, 32, 'out'),
    E('motor_a', 18, 0, 'in'),
    E('motor_b', 42, 0, 'in')
  ], { manufacturer: 'Bosch Rexroth', partNumber: 'A10VSO-E' }),

  HYD_DUMP_VALVE: def('Zawór upustowy', 'hydraulic', 60, 40, `
    <path d="M0 20H14" ${S}/>
    <path d="M14 10V30L30 20Z" ${BOX}/>
    <path d="M46 10V30L30 20Z" ${BOX}/>
  `, [
    H('in', 0, 20, 'in')
  ], { manufacturer: 'Bosch Rexroth', partNumber: 'DBDS' }),

  HYD_VALVE_3_2: def('Zawór trójdrożny', 'hydraulic', 60, 40, `
    <path d="M0 20H14M46 20H60" ${S}/>
    <path d="M14 10V30L30 20Z" ${BOX}/>
    <path d="M46 10V30L30 20Z" ${BOX}/>
    <path d="M22 10H38L30 20Z" ${BOX}/>
    <path d="M30 0V10" ${S}/>
  `, [
    H('in', 0, 20, 'in'),
    H('out', 60, 20, 'out'),
    H('tank', 30, 0, 'out')
  ], { manufacturer: 'Bosch Rexroth', partNumber: '3WE' }),

  HYD_SHUT_OFF: def('Zawór odcinający', 'hydraulic', 60, 40, `
    <path d="M0 20H14M46 20H60" ${S}/>
    <path d="M14 10V30L30 20Z" ${BOX}/>
    <path d="M46 10V30L30 20Z" ${BOX}/>
    <path d="M30 20V8M24 8H36" ${S}/>
  `, [
    H('in', 0, 20, 'in'),
    H('out', 60, 20, 'out')
  ], { manufacturer: 'Danfoss', partNumber: 'VF-02' }),

  HYD_CHECK_VALVE: def('Zawór zwrotny', 'hydraulic', 60, 40, `
    <path d="M0 20H14M46 20H60" ${S}/>
    <path d="M14 10V30L30 20Z" fill="#111827" stroke="#111827" stroke-width="2" stroke-linejoin="round"/>
    <path d="M46 10V30L30 20Z" ${BOX}/>
  `, [
    H('in', 0, 20, 'in'),
    H('out', 60, 20, 'out')
  ], { manufacturer: 'Bosch Rexroth', partNumber: 'Z1S' }),

  HYD_THERMOMETER: def('Termometr', 'hydraulic', 40, 40, `
    <circle cx="20" cy="24" r="10" ${BOX}/>
    ${label(20, 24.5, 'T', 12)}
    <path d="M20 34V40" ${S}/>
  `, [
    H('in', 20, 40, 'in')
  ], { manufacturer: 'WIKA', partNumber: 'SB-10' }),

  HYD_GAUGE: def('Manometr', 'hydraulic', 50, 50, `
    <circle cx="25" cy="21" r="16" ${BOX}/>
    <path d="M25 21L33 12M25 37V50" ${S}/>
    <path d="M9 21H5M41 21H45" ${S}/>
  `, [H('in_1', 25, 50, 'in')], { manufacturer: 'WIKA', partNumber: '232.50' }),

  HYD_AIR_VENT: def('Odpowietrznik', 'hydraulic', 40, 40, `
    <path d="M20 40V28" ${S}/>
    <path d="M8 28H32L20 10Z" ${BOX}/>
  `, [
    H('port', 20, 40)
  ], { manufacturer: 'Hydac', partNumber: 'BE-10' }),

  HYD_SEPARATOR: def('Zbiornik przeponowy', 'hydraulic', 60, 60, `
    <ellipse cx="30" cy="28" rx="17" ry="24" ${BOX}/>
    <path d="M30 52V60" ${S}/>
  `, [
    H('port', 30, 60)
  ], { manufacturer: 'Parker', partNumber: 'ZS-40' }),

  HYD_FLOW_METER: def('Licznik przepływowy', 'hydraulic', 70, 40, `
    <path d="M0 20H24M46 20H70" ${S}/>
    <circle cx="35" cy="20" r="11" ${BOX}/>
    <path d="M35 20L41 14" ${S}/>
    <path d="M35 9V0" ${S}/>
  `, [
    H('in', 0, 20, 'in'),
    H('out', 70, 20, 'out'),
    G('signal', 35, 0, 'out')
  ], { manufacturer: 'KROHNE', partNumber: 'OPTIFLUX' }),

  HYD_UNION: def('Śrubunek', 'hydraulic', 40, 40, `
    <path d="M0 20H40M14 8V32M26 8V32" ${S}/>
  `, [
    H('in', 0, 20, 'in'),
    H('out', 40, 20, 'out')
  ], { manufacturer: 'Swagelok', partNumber: 'SS-400-6' }),

  HYD_BUFFER_TANK: def('Zbiornik buforowy', 'hydraulic', 80, 50, `
    <rect x="6" y="10" width="68" height="30" ${BOX}/>
    <path d="M6 26H74" ${S}/>
  `, [
    H('in', 20, 10, 'in'),
    H('out', 60, 10, 'out')
  ], { manufacturer: 'Parker', partNumber: 'BT-100' }),

  HYD_BUFFER_HEATER: def('Zbiornik buforowy z grzałką elektryczną', 'hydraulic', 80, 50, `
    <rect x="6" y="10" width="68" height="30" ${BOX}/>
    <path d="M6 26H74" ${S}/>
    <path d="M20 38l5-5 5 5 5-5 5 5 5-5 5 5" ${S}/>
    <path d="M20 38V50M50 38V50" ${S}/>
  `, [
    H('in', 20, 10, 'in'),
    H('out', 60, 10, 'out'),
    E('heater_a', 20, 50),
    E('heater_b', 50, 50)
  ], { manufacturer: 'Parker', partNumber: 'BT-100H' }),

  HYD_BOILER_COIL: def('Boiler z wężownicą', 'hydraulic', 80, 60, `
    <rect x="6" y="8" width="68" height="44" ${BOX}/>
    <path d="M14 34c4-6 8-6 12 0s8 6 12 0 8-6 12 0 8 6 12 0" ${S}/>
    <path d="M14 34V52M62 34V52" ${S}/>
  `, [
    H('in', 0, 30, 'in'),
    H('out', 80, 30, 'out'),
    H('coil_in', 14, 52, 'in'),
    H('coil_out', 62, 52, 'out')
  ], { manufacturer: 'Viessmann', partNumber: 'VUW 301' }),

  HYD_BOILER_ELECTRIC: def('Boiler elektryczny', 'hydraulic', 80, 60, `
    <rect x="6" y="8" width="68" height="44" ${BOX}/>
    <path d="M16 38l6-6 6 6 6-6 6 6 6-6 6 6" ${S}/>
    <path d="M16 38V52M52 38V52" ${S}/>
  `, [
    H('in', 0, 30, 'in'),
    H('out', 80, 30, 'out'),
    E('heater_a', 16, 52),
    E('heater_b', 52, 52)
  ], { manufacturer: 'Stiebel Eltron', partNumber: 'SBB' }),

  HYD_BOILER_ELECTRIC_COIL: def('Boiler elektryczny z wężownicą', 'hydraulic', 90, 60, `
    <rect x="6" y="8" width="78" height="44" ${BOX}/>
    <path d="M14 26c4-6 8-6 12 0s8 6 12 0 8-6 12 0" ${S}/>
    <path d="M56 44l5-5 5 5 5-5 5 5" ${S}/>
    <path d="M14 26V52M50 26V52M56 44V52M76 44V52" ${S}/>
  `, [
    H('in', 0, 30, 'in'),
    H('out', 90, 30, 'out'),
    H('coil_in', 14, 52, 'in'),
    H('coil_out', 50, 52, 'out'),
    E('heater_a', 56, 52),
    E('heater_b', 76, 52)
  ], { manufacturer: 'Viessmann', partNumber: 'VUW-E' }),

  /* ---------------- Schemat blokowy ---------------- */
  BLK_BLOCK: def('Blok funkcjonalny', 'block', blockBase.width, blockBase.height, `
    <rect x="1" y="1" width="${blockBase.width - 2}" height="${blockBase.height - 2}" rx="6" ${BLOCK_BOX}/>
  `, blockBase.ports.map((p) => [p.id, p.type, p.dir, p.x, p.y]), { layout: LABEL_BLOCK_LAYOUT })
};

export function cloneDefinition(key) {
  const source = BUILTIN_DEFINITIONS[key];
  if (!source) return null;
  return JSON.parse(JSON.stringify(source));
}

/** Mały, gotowy schemat na start. */
export function createDemoDoc() {
  const doc = emptyDoc('Schemat pneumatyczny — przykład');
  const keys = ['PNEU_SUPPLY', 'PNEU_VALVE_32_NC_MONO', 'PNEU_CYLINDER_SA', 'EL_SWITCH'];
  for (const key of keys) doc.definitions[key] = cloneDefinition(key);

  doc.instances = [
    { id: 'P1', type: 'PNEU_SUPPLY', x: 60, y: 300, rot: 0, label: 'Zasilanie' },
    { id: 'V1', type: 'PNEU_VALVE_32_NC_MONO', x: 200, y: 200, rot: 0, label: 'Y1' },
    { id: 'C1', type: 'PNEU_CYLINDER_SA', x: 460, y: 110, rot: 0, label: 'Siłownik' },
    { id: 'S1', type: 'EL_SWITCH', x: 310, y: 55, rot: 0, label: 'Przycisk' }
  ];

  doc.connections = [
    { id: 'c_demo_1', from: 'P1.out_1', to: 'V1.p', medium: 'pneumatic', label: '' },
    { id: 'c_demo_2', from: 'V1.a', to: 'C1.a', medium: 'pneumatic', label: '' },
    { id: 'c_demo_3', from: 'S1.a', to: 'V1.y1_a', medium: 'electric', label: '' },
    { id: 'c_demo_4', from: 'S1.b', to: 'V1.y1_b', medium: 'electric', label: '' }
  ];
  return doc;
}
