const REPOSITORY = 'aephiaviktor/my-star-atlas-c4';
const LATEST_RELEASE_API = `https://api.github.com/repos/${REPOSITORY}/releases/latest`;
const LATEST_RELEASE_PAGE = `https://github.com/${REPOSITORY}/releases/latest`;

function parseVersion(tag) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/i.exec(String(tag).trim());
  if (!match) throw new Error('Expected a version such as v0.1.3.');
  return { label: match.slice(1).join('.'), parts: match.slice(1).map(BigInt) };
}

async function checkForC4Updates(currentVersion, request = fetch) {
  const state = { currentVersion, latestVersion: null, updateAvailable: false, opensReleasePage: true };
  try {
    const response = await request(LATEST_RELEASE_API, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'my-star-atlas-c4' },
      signal: AbortSignal.timeout(10000),
    });
    if (response.status === 404) return state;
    if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}.`);

    const release = await response.json();
    const latest = parseVersion(release.tag_name);
    const current = parseVersion(currentVersion);
    const firstDifference = latest.parts.findIndex((part, index) => part !== current.parts[index]);
    return {
      ...state,
      latestVersion: latest.label,
      updateAvailable: firstDifference !== -1 && latest.parts[firstDifference] > current.parts[firstDifference],
    };
  } catch (error) {
    return { ...state, checkError: error.message || String(error) };
  }
}

module.exports = { checkForC4Updates, LATEST_RELEASE_PAGE };
