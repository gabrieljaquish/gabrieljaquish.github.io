import { useState } from 'react';

// Example interactive island. Rendered from MDX with `client:visible`, so its JavaScript
// only loads on pages that use it. Styling uses classes (not style attributes) to stay CSP-safe.

const ITEMS = [
  'Static output only: nothing runs on the server',
  'Strict Content-Security-Policy with hashed scripts and styles',
  'Security headers set at Cloudflare',
  'No third-party scripts, fonts, or trackers',
  'GitHub Actions pinned to commit SHAs',
  'Photo metadata stripped at build time',
];

export default function HardeningChecklist() {
  const [done, setDone] = useState<boolean[]>(() => ITEMS.map(() => false));
  const count = done.filter(Boolean).length;

  return (
    <fieldset className="checklist">
      <legend>
        Hardening checklist: {count}/{ITEMS.length}
      </legend>
      {ITEMS.map((item, i) => (
        <label key={item} className={done[i] ? 'checked' : undefined}>
          <input
            type="checkbox"
            checked={done[i]}
            onChange={() => setDone((prev) => prev.map((v, j) => (j === i ? !v : v)))}
          />
          {item}
        </label>
      ))}
    </fieldset>
  );
}
