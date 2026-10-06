export type GateRun = string | { text: string; href: string } | { strong: string };
export type GatePara = string | GateRun[];

export interface GateCopy {
  markAlt: string;
  heading: string;
  paras: GatePara[];
  over: string;
  under: string;
  leftHeading: string;
  leftParas: GatePara[];
}

const HELP: GateRun[] = [
  'If gambling is causing you problems, visit ',
  { text: 'BeGambleAware.org', href: 'https://www.begambleaware.org/' },
  ' or call ',
  { strong: '0808 8020 133' },
  '.',
];

export const GATE_COPY: GateCopy = {
  markAlt: '18+',
  heading: '18+ · Simulated gambling',
  paras: [
    'Fruitulator is an adult-only (18+) fruit machine emulator created for historical preservation and entertainment.',
    'It does not include game ROMs or system files. You must provide your own files and ensure that you have the legal right to use them.',
    'All money shown in the emulator is entirely fictional. No real money can be wagered, and no real money or prizes can be won. Gameplay and outcomes in the emulator should not be taken as an indication of what you might win on a real, cash-paying machine.',
    HELP,
  ],
  over: 'I am over 18',
  under: 'I am under 18',
  leftHeading: 'Sorry - Fruitulator is for adults only.',
  leftParas: ['Come back when you\u2019re 18.', HELP],
};
