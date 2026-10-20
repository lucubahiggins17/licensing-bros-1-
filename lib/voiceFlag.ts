// Whether an admin switched on Bro's studio voice (site setting "voice"). Kept in a tiny module so the sign-in
// layer can set it without loading the whole voice engine.
let studio = false;
export const siteStudioVoice = () => studio;
export function setSiteStudioVoice(on: boolean) { studio = !!on; }
