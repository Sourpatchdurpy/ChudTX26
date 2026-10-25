import { motion, useReducedMotion } from 'framer-motion';

const STARS = Array.from({ length: 20 }, (_, index) => ({
  left: `${(index * 37 + 3) % 98}%`,
  top: `${(index * 29 + 4) % 96}%`,
  size: index % 4 === 0 ? 16 : index % 3 === 0 ? 10 : 6,
  delay: index * 0.23,
  duration: 2 + (index % 5) * 0.4,
}));
function CloudLayer({ foreground, isDarkMode }: { foreground: boolean; isDarkMode: boolean }) {
  const reduceMotion = useReducedMotion();
  const positions = foreground
    ? [{ left: '4%', top: '12%', width: 'min(38%, 380px)' }, { left: '56%', top: '58%', width: 'min(38%, 380px)' }]
    : [{ left: '3%', top: '12%', width: 'min(24%, 230px)' }, { left: '37%', top: '36%', width: 'min(24%, 230px)' }, { left: '71%', top: '4%', width: 'min(24%, 230px)' }];

  return <div className={`absolute inset-x-0 overflow-hidden ${foreground ? 'bottom-0 h-1/2' : 'top-0 h-1/3'}`}>
    {/* Two identical viewport-wide tiles meet at the same position each loop. */}
    <motion.div className={`absolute inset-y-0 left-0 flex w-[200%] ${isDarkMode ? 'opacity-85' : 'opacity-90'}`} initial={false} animate={reduceMotion ? { x: 0 } : { x: foreground ? ['-50%', '0%'] : ['0%', '-50%'] }} transition={{ duration: foreground ? 22 : 35, repeat: Infinity, ease: 'linear' }}>
      {[0, 1].map(tile => <div key={tile} className="relative h-full w-1/2 shrink-0">
        {positions.map((cloud, index) => <svg key={index} viewBox="0 0 200 64" shapeRendering="crispEdges" className="absolute drop-shadow-[0_4px_0_rgba(0,0,0,0.25)]" style={cloud}>
          <g transform={index % 2 ? 'translate(200 0) scale(-1 1)' : undefined}>
            {/* Hard-edged shade bands sculpt separate billows without blurring the pixels. */}
            <path d="M0 60H8V56H20V48H28V40H40V32H52V40H60V24H72V16H84V8H104V16H116V32H128V24H140V32H152V44H164V48H176V56H192V60H200V64H0Z" fill="#FFFFFF" />
            <path d="M60 40H68V28H80V20H88V12H104V16H116V32H108V28H100V24H88V28H80V40H72V48H60Z" fill={isDarkMode ? '#E3F2FF' : '#FFF0E2'} />
            <path d="M116 40H128V32H136V28H140V32H152V44H164V48H152V52H140V44H132V40H124V48H112Z" fill={isDarkMode ? '#D6E9FA' : '#F8E3D9'} />
            <path d="M20 52H28V44H36V36H44V40H52V48H44V44H36V52H28V56H20Z" fill={isDarkMode ? '#E3F2FF' : '#FFF0E2'} />
            <path d="M8 60H24V56H40V52H56V56H76V48H88V40H100V36H108V40H116V48H128V52H148V48H160V52H176V56H192V60H200V64H0V60Z" fill={isDarkMode ? '#BCD5EF' : '#C6D9E5'} />
            <path d="M0 60H36V56H56V60H84V56H108V52H124V56H156V60H200V64H0Z" fill={isDarkMode ? '#91B3D7' : '#A5BFCE'} />
            <path d="M76 20H84V16H100V20H88V24H76ZM32 40H40V36H48V40ZM128 32H136V28H140V32Z" fill="#FFFFFF" />
            <path d="M84 48H92V44H104V48H96V52H84ZM48 52H56V48H64V52Z" fill={isDarkMode ? '#F0F8FF' : '#FFF8F0'} />
          </g>
        </svg>)}
      </div>)}
    </motion.div>
  </div>;
}

export default function PixelSky({ clouds = true, isDarkMode = true }: { clouds?: boolean; isDarkMode?: boolean }) {
  const reduceMotion = useReducedMotion();
  return <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
    <motion.div className="absolute inset-0 origin-bottom bg-[repeating-conic-gradient(from_-35deg_at_50%_100%,transparent_0deg_12deg,#FFF1C9_12deg_22deg,transparent_22deg_34deg)]" initial={false} animate={{ opacity: isDarkMode ? 0 : 0.18, y: reduceMotion ? 0 : [12, -12, 12] }} transition={{ opacity: { duration: 0.3 }, y: { duration: 24, repeat: Infinity, ease: 'easeInOut' } }} />
    <motion.div className="absolute bottom-[-8rem] left-1/2 h-80 w-80 -translate-x-1/2 rounded-full bg-[#FFF3CD]/60 blur-3xl" initial={false} animate={{ opacity: isDarkMode ? 0 : 0.65, y: reduceMotion ? 0 : [20, -20, 20] }} transition={{ opacity: { duration: 0.3 }, y: { duration: 30, repeat: Infinity, ease: 'easeInOut' } }} />
    {clouds && <>
      <CloudLayer foreground={false} isDarkMode={isDarkMode} />
      <CloudLayer foreground isDarkMode={isDarkMode} />
    </>}
    {STARS.map((star, index) => <motion.span key={index} className={`absolute ${isDarkMode ? 'bg-[#88F6FF] shadow-[0_0_14px_4px_#0088FF]' : 'bg-[#0064E0]/40'}`} style={{ left: star.left, top: star.top, width: star.size, height: star.size, clipPath: 'polygon(40% 0,60% 0,60% 30%,70% 30%,70% 40%,100% 40%,100% 60%,70% 60%,70% 70%,60% 70%,60% 100%,40% 100%,40% 70%,30% 70%,30% 60%,0 60%,0 40%,30% 40%,30% 30%,40% 30%)' }} initial={false} animate={reduceMotion ? { opacity: 0.7, scale: 1 } : { opacity: [0.25, 1, 0.25], scale: [0.7, 1.3, 0.7] }} transition={{ duration: star.duration, delay: star.delay, repeat: Infinity, ease: 'easeInOut' }} />)}
    {STARS.map((star, index) => <span key={`spark-${index}`} className={`absolute h-0.5 w-0.5 ${isDarkMode ? (index % 3 === 0 ? 'bg-[#FF8CA4]' : 'bg-[#2E75FF]') : 'bg-[#0064E0]/30'}`} style={{ left: `${(index * 17 + 12) % 99}%`, top: star.top }} />)}
  </div>;
}

