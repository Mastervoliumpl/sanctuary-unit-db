// Steam sign-in. Steam still speaks OpenID 2.0 — not OAuth or OIDC, which is
// why no auth library or Supabase provider covers it — but the whole protocol
// surface we need is two URLs: send the player to Steam with checkid_setup,
// then round-trip the returned params with check_authentication so Steam
// itself confirms it issued them (and consumes the nonce, killing replays).

import { siteUrl } from './db';

const STEAM_OPENID = 'https://steamcommunity.com/openid/login';
const OPENID_NS = 'http://specs.openid.net/auth/2.0';
const IDENTIFIER_SELECT = 'http://specs.openid.net/auth/2.0/identifier_select';

export function steamLoginUrl(): string {
  const params = new URLSearchParams({
    'openid.ns': OPENID_NS,
    'openid.mode': 'checkid_setup',
    'openid.claimed_id': IDENTIFIER_SELECT,
    'openid.identity': IDENTIFIER_SELECT,
    'openid.return_to': `${siteUrl()}/api/auth/steam/callback`,
    'openid.realm': siteUrl(),
  });
  return `${STEAM_OPENID}?${params}`;
}

// Returns the verified 64-bit SteamID, or null if the assertion is invalid.
export async function verifySteamCallback(callbackUrl: URL): Promise<string | null> {
  const params = new URLSearchParams();
  for (const [key, value] of callbackUrl.searchParams) {
    if (key.startsWith('openid.')) params.set(key, value);
  }
  if (params.get('openid.mode') !== 'id_res') return null;

  params.set('openid.mode', 'check_authentication');
  const res = await fetch(STEAM_OPENID, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  if (!res.ok || !/is_valid\s*:\s*true/.test(await res.text())) return null;

  // Only the claimed_id carries the identity, and only in this exact shape.
  const match = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/.exec(
    params.get('openid.claimed_id') ?? '',
  );
  return match ? match[1] : null;
}

// App ids this ladder accepts web-API tickets from: the Playtest today, the
// full game so nothing breaks at launch. Constants mirrored from the game's
// EM.Network.SteamManager/SteamAppIDs.
const APP_IDS = [4511930, 1699050];

// Verifies a GetAuthTicketForWebApi ticket with Steam itself and returns the
// SteamID it belongs to, or null. The identity string must match what the
// mod passed when minting (LadderReporter's TicketIdentity).
export async function verifyWebApiTicket(ticketHex: string, identity: string): Promise<string | null> {
  const key = process.env.STEAM_API_KEY;
  if (!key || !/^[0-9a-fA-F]{40,5200}$/.test(ticketHex)) return null;
  for (const appId of APP_IDS) {
    try {
      const res = await fetch(
        'https://api.steampowered.com/ISteamUserAuth/AuthenticateUserTicket/v1/' +
          `?key=${key}&appid=${appId}&ticket=${ticketHex}&identity=${encodeURIComponent(identity)}`,
      );
      if (!res.ok) continue;
      const body: { response?: { params?: { result?: string; steamid?: string } } } = await res.json();
      const params = body.response?.params;
      if (params?.result === 'OK' && params.steamid && /^\d{17}$/.test(params.steamid)) {
        return params.steamid;
      }
    } catch {
      // Steam hiccup on this appid — try the next, or fail closed.
    }
  }
  return null;
}

export interface SteamPersona {
  personaName: string;
  avatarUrl: string | null;
}

// Display name + avatar from the Steam Web API. Decoration — any failure
// falls back to a placeholder name rather than blocking sign-in.
export async function fetchPersona(steamId: string): Promise<SteamPersona> {
  const fallback = { personaName: `Player ${steamId.slice(-4)}`, avatarUrl: null };
  const key = process.env.STEAM_API_KEY;
  if (!key) return fallback;
  try {
    const res = await fetch(
      `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${key}&steamids=${steamId}`,
    );
    if (!res.ok) return fallback;
    const body: { response?: { players?: { personaname?: string; avatarfull?: string }[] } } =
      await res.json();
    const player = body.response?.players?.[0];
    if (!player?.personaname) return fallback;
    return { personaName: player.personaname, avatarUrl: player.avatarfull ?? null };
  } catch {
    return fallback;
  }
}
