const RELEASES_API = 'https://api.github.com/repos/ItsDeimox/PentaMark/releases/latest';

function versionParts(value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(value);
  return match ? match.slice(1).map(Number) : null;
}

function isNewer(candidate, current) {
  const a = versionParts(candidate), b = versionParts(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

async function checkForUpdates(current, fetchImpl = fetch) {
  try {
    const response = await fetchImpl(RELEASES_API, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'PentaMark' },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return { status: 'unavailable' };
    const release = await response.json();
    if (release.draft || release.prerelease || !versionParts(release.tag_name)) return { status: 'unavailable' };
    if (!isNewer(release.tag_name, current)) return { status: 'current' };
    const version = release.tag_name.replace(/^v/, '');
    const asset = release.assets?.find(item => item.name === `PentaMark-Desktop-${version}-Windows.exe`);
    if (!asset) return { status: 'unavailable' };
    return {
      status: 'available', version,
      url: `https://github.com/ItsDeimox/PentaMark/releases/tag/${encodeURIComponent(release.tag_name)}`,
    };
  } catch {
    // Offline, timeout e limites do GitHub nunca impedem a abertura do cofre.
    return { status: 'unavailable' };
  }
}

module.exports = { checkForUpdates, isNewer };
