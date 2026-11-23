export const STORE_UNREACHABLE = 'This page could not reach its film. Open it again from your agent.';
export const LIVE_SYNC_UNAVAILABLE = 'Live sync is unavailable here. Reload to retry.';
export const ASSET_UNREACHABLE = (name: string): string => `The asset ${name} could not be loaded.`;
export const READ_ONLY_VIEWER = 'You can watch and comment on this animation, but not change it.';
/** Why an inline page (`#view-inline`) is read-only. */
export const EDITING_UNAVAILABLE = 'Editing isn’t available in this view.';
/** What a write from an inline page is refused with. */
export const EMBEDDED_VIEW_ONLY = 'This embedded animation is view-only.';
