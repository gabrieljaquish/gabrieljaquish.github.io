// Site-wide settings. Never add a phone number, email address, or street address here:
// this site intentionally publishes no direct contact details.

export const SITE_TITLE = 'Gabriel Jaquish';
export const SITE_DESCRIPTION =
  "Small business owner, community organizer, and information security professional. Co-owner of Bridgeview Harbour Marina and founder of the Port Henry Waterfront Farmers' Market.";

// How Gabriel describes himself, in his words. Set under his name in the home-page cartouche.
export const HEADLINE: string | null =
  'Small business owner, community organizer, and information security professional.';

export const SOCIAL_LINKS = [
  { label: 'LinkedIn', href: 'https://www.linkedin.com/in/gabrieljaquish/' },
  { label: 'GitHub', href: 'https://github.com/gabrieljaquish' },
  { label: 'The Ship’s Log (marina blog)', href: 'https://www.bridgeviewharbour.com/blogs/ships-log' },
];

// Built but never listed in the sitemap (the easter-egg step). Kept in a plain .mjs so the
// Astro config and scripts/check-dist.mjs read the same list.
export { HIDDEN_PATHS } from './lib/hidden-paths.mjs';
