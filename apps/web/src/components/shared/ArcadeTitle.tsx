import { motion, useReducedMotion } from 'framer-motion';

const WORDS = [
  [
    { letter: 'a', rotate: -7, lift: 0.04 },
    { letter: 'M', rotate: 3, lift: -0.04 },
    { letter: 'u', rotate: -4, lift: 0.07 },
    { letter: 's', rotate: 5, lift: -0.01 },
    { letter: 'e', rotate: -3, lift: 0.04 },
  ],
  [
    { letter: 'U', rotate: 4, lift: -0.03 },
    { letter: 's', rotate: -6, lift: 0.06 },
  ],
];

function Lettering() {
  return <span className="inline-flex items-center gap-[0.24em]">
    {WORDS.map((word, index) => <span key={index} className="inline-flex -space-x-[0.075em]">
      {word.map((character, letterIndex) => <span key={letterIndex} className="relative inline-block origin-bottom text-[#FFF0C4] [-webkit-text-stroke:0.065em_#11172F] [paint-order:stroke_fill] [text-shadow:0.035em_0.035em_0_#FF8B92,0.075em_0.075em_0_#16244B,0.12em_0.12em_0_#080E24]" style={{ transform: `translateY(${character.lift}em) rotate(${character.rotate}deg) scaleY(1.12)` }}>{character.letter}</span>)}
    </span>)}
  </span>;
}

/** Cream arcade lettering with coral edging and deep navy cast shadows. */
export default function ArcadeTitle() {
  const reduceMotion = !!useReducedMotion();
  return <h1 id="entry-title" aria-label="aMuse Us" className="relative mb-3 inline-block select-none whitespace-nowrap px-[0.16em] pb-[0.22em] pt-[0.1em] text-center font-pixel text-[clamp(1.75rem,11.5vw,5.25rem)] font-black leading-none tracking-normal">
    <span aria-hidden="true"><Lettering /></span>
    <motion.span aria-hidden="true" className="pointer-events-none absolute inset-0 px-[0.16em] pb-[0.22em] pt-[0.1em]" initial={false} animate={reduceMotion ? { opacity: 0 } : {
      x: [0, 0, -3, 4, -1, 0],
      y: [0, 0, 1, -1, 0, 0],
      opacity: [0, 0, 0.9, 0.8, 0.75, 0],
      clipPath: ['inset(20% 0 55% 0)', 'inset(20% 0 55% 0)', 'inset(15% 0 60% 0)', 'inset(60% 0 12% 0)', 'inset(35% 0 38% 0)', 'inset(20% 0 55% 0)'],
    }} transition={{ duration: 5.8, times: [0, 0.82, 0.85, 0.88, 0.91, 1], repeat: Infinity, ease: 'linear' }}><Lettering /></motion.span>
  </h1>;
}
