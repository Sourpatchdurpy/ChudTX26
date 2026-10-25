import { useState } from 'react';
import { ExternalLink } from 'lucide-react';

const DEVICES = [
  { name: 'Small phone', width: 320, height: 568 },
  { name: 'Phone', width: 390, height: 844 },
  { name: 'Landscape phone', width: 844, height: 390 },
  { name: 'Tablet', width: 768, height: 1024 },
];

/** An isolated viewport uses the same responsive app as a real mobile browser. */
export default function MobilePreview() {
  const [deviceIndex, setDeviceIndex] = useState(1);
  const device = DEVICES[deviceIndex];
  const source = new URL(window.location.href);
  source.searchParams.delete('device');

  return (
    <main className="flex min-h-[100dvh] flex-col items-center gap-4 bg-[#020617] px-3 py-6 font-sans text-white">
      <div style={{ maxWidth: device.width + 8 }} className="flex w-full flex-wrap items-center justify-between gap-3 text-xs text-slate-300">
        <label className="flex items-center gap-2">Viewport
          <select value={deviceIndex} onChange={event => setDeviceIndex(Number(event.target.value))} className="min-h-11 rounded-lg border border-slate-600 bg-slate-900 px-2 text-white focus:outline-2 focus:outline-cyan-300">
            {DEVICES.map((preset, index) => <option key={preset.name} value={index}>{preset.name} · {preset.width} × {preset.height}</option>)}
          </select>
        </label>
        <a href={source.href} className="flex min-h-11 items-center gap-1.5 rounded-lg px-2 hover:text-white focus-visible:outline-2 focus-visible:outline-cyan-300">Full screen <ExternalLink size={13} aria-hidden="true" /></a>
      </div>
      <div style={{ maxWidth: device.width + 8 }} className="w-full shrink-0 overflow-hidden rounded-[2rem] border-4 border-slate-700 bg-[#060B28] shadow-2xl">
        <iframe title="aMuse Us mobile viewport" src={source.href} style={{ height: device.height }} className="block w-full border-0" />
      </div>
    </main>
  );
}
