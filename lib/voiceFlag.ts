// Whether an admin switched on Bro's studio voice (site setting "voice"). Kept in a tiny module so the sign-in
// layer can set it without loading the whole voice engine.
let studio = false;
export const siteStudioVoice = () => studio;
export function setSiteStudioVoice(on: boolean) { studio = !!on; }

let ears = false;
/** An admin switched on clear-voice listening (the voice server transcribes, with noise filtering). */
export const siteClearVoice = () => ears;
export function setSiteClearVoice(on: boolean) { ears = !!on; }
