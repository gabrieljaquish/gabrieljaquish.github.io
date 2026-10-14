// Easter egg for anyone who opens the developer console. Bundled by Astro into an
// external, hashed script so it works under the CSP.

const banner = String.raw`
   ____   _
  / ___| | |
 | |  _  | |   You found the console.
 | |_| |_| |   Curious people make good security engineers.
  \____\___/
`;

console.log(`%c${banner}`, 'font-family: monospace; color: #3b82f6');
console.log('Next clue: polite robots read the rules before they visit.');
