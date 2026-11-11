// Mobile Task Force units. An agent belongs to the same unit everywhere
// (personnel file, pane header, dossier), chosen from its address.
export const MTF = [
  ["E-11", "Epsilon-11", "Nine-Tailed Fox"], ["NU-7", "Nu-7", "Hammer Down"],
  ["A-1", "Alpha-1", "Red Right Hand"], ["T-5", "Tau-5", "Samsara"],
  ["M-4", "Mu-4", "Debuggers"], ["L-5", "Lambda-5", "White Rabbits"],
  ["H-10", "Eta-10", "See No Evil"], ["G-5", "Gamma-5", "Red Herrings"],
  ["B-7", "Beta-7", "Maz Hatters"], ["Z-9", "Zeta-9", "Mole Rats"],
  ["O-7", "Omega-7", "Pandora's Box"], ["P-1", "Pi-1", "City Slickers"],
];

export function unitOf(address) {
  let h = 0;
  for (const ch of String(address)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const [code, full, nick] = MTF[h % MTF.length];
  return { code, full, nick };
}
